// PDF → BookDocument. Layout extraction (pdfLayout.ts) yields typed blocks —
// paragraphs, headings, list items, code, tables — and this module folds them
// into sections using the PDF outline when one exists, or detected headings
// otherwise. The old flatten-to-string path is gone: block text is canonical
// and search/highlights anchor to it directly.

import { pdfjsLib, type PDFDocumentProxy } from "../pdf";
import type { BookDocument, BookSection, ContentBlock } from "../types";
import {
  STRUCTURE_VERSION,
  asString,
  cleanDisplayText,
  countWords,
  pickCoverTint,
  slugify
} from "./structure";
import { extractPdfLayout, type PdfBlock, type PdfOutlineEntry } from "./pdfLayout";

export interface PdfImportBase {
  bookId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
}

export interface PdfBookResult {
  book: BookDocument;
  /** Still-open document so the caller can render a cover from page 1. Caller must destroy(). */
  doc: PDFDocumentProxy;
}

export async function extractPdfBook(data: ArrayBuffer, base: PdfImportBase): Promise<PdfBookResult> {
  const doc = await pdfjsLib.getDocument({ data }).promise;
  const layout = await extractPdfLayout(doc);

  let title: string | undefined;
  let author: string | undefined;
  try {
    const metadata = await doc.getMetadata();
    const info = metadata.info as Record<string, unknown> | undefined;
    title = asString(info?.Title);
    author = asString(info?.Author);
  } catch {
    /* metadata is optional */
  }

  const blocks = cleanBlocks(layout.blocks);
  const inferredTitle = title || inferTitleFromBlocks(blocks) || fileNameTitle(base.fileName);
  const sections = blocks.length
    ? buildSections(blocks, layout.outline, inferredTitle)
    : [
        {
          id: "section-1",
          title: inferredTitle || "Untitled book",
          level: 1,
          paragraphs: ["No readable text was extracted."],
          blocks: [{ kind: "paragraph", text: "No readable text was extracted." } as ContentBlock],
          wordCount: 5
        }
      ];

  const allParagraphs = sections.flatMap((section) => section.paragraphs);
  const joined = allParagraphs.join(" ");

  const book: BookDocument = {
    id: base.bookId,
    fileName: base.fileName,
    mimeType: base.mimeType,
    sizeBytes: base.sizeBytes,
    uploadedAt: base.uploadedAt,
    sourceKind: "pdf",
    title: cleanDisplayText(inferredTitle),
    author: author ? cleanDisplayText(author) : undefined,
    pageCount: doc.numPages,
    characterCount: joined.length,
    wordCount: countWords(joined),
    paragraphCount: allParagraphs.length,
    sectionCount: sections.length,
    rawSample: joined.slice(0, 1800),
    warnings: layout.warnings,
    sections,
    hasOriginal: true,
    coverTint: pickCoverTint(base.bookId),
    structureVersion: STRUCTURE_VERSION
  };

  return { book, doc };
}

/* ------------------------------------------------------------------ */
/* Block cleanup                                                       */
/* ------------------------------------------------------------------ */

function cleanBlocks(blocks: PdfBlock[]): PdfBlock[] {
  const cleaned: PdfBlock[] = [];
  for (const entry of blocks) {
    const block = entry.block;
    if (block.kind === "code" || block.kind === "table") {
      // Newlines are structural here; cells were cleaned during assembly.
      if (block.text.trim().length > 1) cleaned.push(entry);
      continue;
    }
    const text = cleanDisplayText(block.text);
    if (text.length <= 1) continue;
    cleaned.push({ ...entry, block: { ...block, text } });
  }
  return cleaned;
}

/* ------------------------------------------------------------------ */
/* Sections                                                            */
/* ------------------------------------------------------------------ */

function buildSections(blocks: PdfBlock[], outline: PdfOutlineEntry[], title: string): BookSection[] {
  const boundaries = outline.length >= 2 ? outlineBoundaries(blocks, outline) : headingBoundaries(blocks);

  if (!boundaries.length) {
    return chunkByWords(blocks, title);
  }

  const sections: BookSection[] = [];
  if (boundaries[0].index > 0) {
    sections.push(makeSection(sections.length, "Front matter", 1, blocks.slice(0, boundaries[0].index)));
  }

  boundaries.forEach((boundary, i) => {
    const end = i + 1 < boundaries.length ? boundaries[i + 1].index : blocks.length;
    let body = blocks.slice(boundary.index, end);
    // When the section opens with the heading that named it, the heading is
    // the section title — do not repeat it in the body.
    if (body.length && body[0].block.kind === "heading" && matchesTitle(body[0].block.text, boundary.title)) {
      body = body.slice(1);
    }
    if (!body.length && i + 1 < boundaries.length) return;
    sections.push(makeSection(sections.length, boundary.title, 2, body));
  });

  const populated = sections.filter((section) => section.paragraphs.length);
  return populated.length ? populated : chunkByWords(blocks, title);
}

interface Boundary {
  index: number;
  title: string;
}

function outlineBoundaries(blocks: PdfBlock[], outline: PdfOutlineEntry[]): Boundary[] {
  const boundaries: Boundary[] = [];
  for (const entry of outline) {
    let index = blocks.findIndex((block) => block.page >= entry.page);
    if (index === -1) continue;
    // Prefer the matching heading on that page (outline dests can point
    // mid-page); otherwise start at the page's first block.
    for (let i = index; i < blocks.length && blocks[i].page <= entry.page + 1; i += 1) {
      if (blocks[i].block.kind === "heading" && matchesTitle(blocks[i].block.text, entry.title)) {
        index = i;
        break;
      }
    }
    const previous = boundaries[boundaries.length - 1];
    if (previous && index <= previous.index) continue;
    boundaries.push({ index, title: cleanDisplayText(entry.title) });
  }
  return boundaries.length >= 2 ? boundaries : [];
}

function headingBoundaries(blocks: PdfBlock[]): Boundary[] {
  for (const maxLevel of [1, 2, 3]) {
    const boundaries: Boundary[] = [];
    blocks.forEach((entry, index) => {
      if (entry.block.kind === "heading" && entry.block.level <= maxLevel) {
        boundaries.push({ index, title: entry.block.text });
      }
    });
    if (boundaries.length >= 2 && boundaries.length <= 140) return boundaries;
  }
  return [];
}

function matchesTitle(a: string, b: string): boolean {
  const na = normalizedForMatch(a);
  const nb = normalizedForMatch(b);
  if (!na || !nb) return false;
  return na.includes(nb) || nb.includes(na);
}

function normalizedForMatch(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function chunkByWords(blocks: PdfBlock[], title: string): BookSection[] {
  const sections: BookSection[] = [];
  let bucket: PdfBlock[] = [];
  let words = 0;

  const flush = () => {
    if (!bucket.length) return;
    const index = sections.length + 1;
    sections.push(makeSection(sections.length, `${title || "Book"} — Part ${index}`, 2, bucket));
    bucket = [];
    words = 0;
  };

  for (const entry of blocks) {
    bucket.push(entry);
    words += countWords(entry.block.text);
    if (words > 1400) flush();
  }
  flush();

  if (sections.length === 1) {
    sections[0] = { ...sections[0], title: title || "Book", level: 1 };
    sections[0].id = slugify(`1-${sections[0].title}`);
  }
  return sections;
}

function makeSection(position: number, title: string, level: number, entries: PdfBlock[]): BookSection {
  const blocks = entries.map((entry) => entry.block);
  const paragraphs = blocks.map((block) => block.text);
  return {
    id: slugify(`${position + 1}-${title}`),
    title: cleanDisplayText(title),
    level,
    paragraphs,
    blocks,
    wordCount: countWords(paragraphs.join(" "))
  };
}

/* ------------------------------------------------------------------ */
/* Title inference                                                     */
/* ------------------------------------------------------------------ */

function inferTitleFromBlocks(blocks: PdfBlock[]): string | undefined {
  const early = blocks.slice(0, 12);
  const heading = early.find(
    (entry) => entry.block.kind === "heading" && entry.block.text.length >= 4 && entry.block.text.length <= 120
  );
  if (heading) return heading.block.text;
  const paragraph = early.find(
    (entry) => entry.block.kind === "paragraph" && entry.block.text.length >= 4 && entry.block.text.length <= 110
  );
  return paragraph?.block.text;
}

function fileNameTitle(fileName: string): string {
  const base = fileName.slice(Math.max(fileName.lastIndexOf("/"), fileName.lastIndexOf("\\")) + 1);
  const dot = base.lastIndexOf(".");
  return (dot > 0 ? base.slice(0, dot) : base).replace(/[-_]+/g, " ").trim();
}
