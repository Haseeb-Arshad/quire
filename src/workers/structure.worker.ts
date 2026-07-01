// Structuring worker: runs the heavy regex/string passes off the main thread.
// Non-PDF formats are handled end-to-end here (jszip works in workers); PDFs
// extract text on the main thread (pdf.js has its own worker — nesting workers
// is a Safari/bundler footgun) and only the sectioning pass happens here.

import JSZip from "jszip";
import {
  buildBookDocument,
  detectSourceKind,
  decodeEntities,
  extractPlainFormats,
  findEpubCoverHref,
  findXmlText,
  getEpubSpineFiles,
  htmlToText,
  posixDirname,
  stripTags,
  type ExtractedText
} from "../lib/extraction/structure";
import type { BookDocument } from "../lib/types";

export interface ExtractRequest {
  id: number;
  kind: "extract";
  bookId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  bytes: ArrayBuffer;
}

export interface StructurePdfRequest {
  id: number;
  kind: "structure-pdf";
  bookId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  extracted: ExtractedText;
}

export type WorkerRequest = ExtractRequest | StructurePdfRequest;

export type WorkerResponse =
  | { id: number; ok: true; book: BookDocument; cover?: { bytes: ArrayBuffer; type: string } }
  | { id: number; ok: false; error: string };

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    const response = await handle(request);
    const transfer = response.ok && response.cover ? [response.cover.bytes] : [];
    (self as unknown as Worker).postMessage(response, transfer);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read this file.";
    (self as unknown as Worker).postMessage({ id: request.id, ok: false, error: message } satisfies WorkerResponse);
  }
};

async function handle(request: WorkerRequest): Promise<WorkerResponse> {
  if (request.kind === "structure-pdf") {
    const book = buildBookDocument({
      id: request.bookId,
      fileName: request.fileName,
      mimeType: request.mimeType,
      sizeBytes: request.sizeBytes,
      uploadedAt: request.uploadedAt,
      extracted: request.extracted,
      hasOriginal: true
    });
    return { id: request.id, ok: true, book };
  }

  const sourceKind = detectSourceKind(request.fileName, request.mimeType);
  let extracted: ExtractedText;
  let cover: { bytes: ArrayBuffer; type: string } | undefined;

  if (sourceKind === "epub") {
    const epub = await extractEpub(request.bytes);
    extracted = epub.extracted;
    cover = epub.cover;
  } else {
    const text = new TextDecoder("utf-8").decode(request.bytes);
    extracted = extractPlainFormats(text, sourceKind);
  }

  const book = buildBookDocument({
    id: request.bookId,
    fileName: request.fileName,
    mimeType: request.mimeType,
    sizeBytes: request.sizeBytes,
    uploadedAt: request.uploadedAt,
    extracted,
    hasOriginal: false
  });
  return { id: request.id, ok: true, book, cover };
}

async function extractEpub(
  bytes: ArrayBuffer
): Promise<{ extracted: ExtractedText; cover?: { bytes: ArrayBuffer; type: string } }> {
  const warnings: string[] = [];
  const zip = await JSZip.loadAsync(bytes);
  const container = await zip.file("META-INF/container.xml")?.async("string");
  const rootfile = container?.match(/full-path=["']([^"']+)["']/i)?.[1];
  if (!rootfile) {
    warnings.push("EPUB package metadata was not found. Reading all XHTML files instead.");
  }

  const opfText = rootfile ? await zip.file(rootfile)?.async("string") : undefined;
  const baseDir = rootfile ? posixDirname(rootfile) : "";
  const title = opfText ? decodeEntities(stripTags(findXmlText(opfText, "dc:title") || "")) : undefined;
  const author = opfText ? decodeEntities(stripTags(findXmlText(opfText, "dc:creator") || "")) : undefined;
  const language = opfText ? decodeEntities(stripTags(findXmlText(opfText, "dc:language") || "")) : undefined;
  const orderedFiles = opfText ? getEpubSpineFiles(opfText, baseDir) : [];
  const fallbackFiles = Object.keys(zip.files).filter((name) => /\.(xhtml|html|htm)$/i.test(name));
  const files = orderedFiles.length ? orderedFiles : fallbackFiles;
  const parts: string[] = [];

  for (const filePath of files) {
    const entry = zip.file(filePath);
    if (!entry) continue;
    const html = await entry.async("string");
    parts.push(htmlToText(html));
  }

  if (!parts.length) {
    warnings.push("No readable EPUB spine files were found.");
  }

  let cover: { bytes: ArrayBuffer; type: string } | undefined;
  const coverHref = opfText ? findEpubCoverHref(opfText, baseDir) : undefined;
  if (coverHref) {
    const entry = zip.file(coverHref);
    if (entry) {
      const coverBytes = await entry.async("arraybuffer");
      const extension = coverHref.slice(coverHref.lastIndexOf(".") + 1).toLowerCase();
      const type = extension === "png" ? "image/png" : extension === "gif" ? "image/gif" : "image/jpeg";
      cover = { bytes: coverBytes, type };
    }
  }

  return {
    extracted: {
      text: parts.join("\n\n"),
      title: title || undefined,
      author: author || undefined,
      language: language || undefined,
      sourceKind: "epub",
      warnings
    },
    cover
  };
}
