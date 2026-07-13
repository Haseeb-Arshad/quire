// Entry point for turning a File into a structured BookDocument plus its
// stored artifacts (original bytes for PDFs, cover thumbnail). PDF text is
// pulled on the main thread (pdf.js runs its own worker); all regex-heavy
// structuring happens in structure.worker.ts.

import type { BookDocument } from "../types";
import { detectSourceKind, pickCoverTint } from "./structure";
import { generateTypographicCover, renderPdfCover } from "./covers";
import type { ExtractRequest, WorkerResponse } from "../../workers/structure.worker";

export interface ImportResult {
  book: BookDocument;
  /** Original file bytes worth keeping (PDFs, for the page view). */
  original?: Blob;
  cover?: Blob;
}

export async function extractFromFile(file: File, id: string, uploadedAt: string): Promise<ImportResult> {
  const sourceKind = detectSourceKind(file.name, file.type);
  const base = {
    bookId: id,
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    sizeBytes: file.size,
    uploadedAt
  };

  if (sourceKind === "pdf") {
    const { extractPdfBook } = await import("./pdfText");
    // pdf.js transfers (detaches) the buffer it is given, so hand it a copy;
    // the File blob itself is stored untouched in IndexedDB.
    const { book, doc } = await extractPdfBook(await file.arrayBuffer(), base);
    const cover = await renderPdfCover(doc);
    void doc.destroy();
    return { book, original: file, cover: cover || undefined };
  }

  const bytes = await file.arrayBuffer();
  const response = await callWorker({ ...base, kind: "extract", bytes }, [bytes]);
  let cover: Blob | undefined;
  if (response.cover) {
    cover = new Blob([response.cover.bytes], { type: response.cover.type });
  } else {
    cover =
      (await generateTypographicCover(response.book.title, response.book.author, pickCoverTint(id))) || undefined;
  }
  return { book: response.book, cover };
}

/* ------------------------------------------------------------------ */
/* Worker RPC                                                          */
/* ------------------------------------------------------------------ */

type SuccessResponse = Extract<WorkerResponse, { ok: true }>;

let worker: Worker | null = null;
let nextRequestId = 1;
const pending = new Map<number, { resolve: (value: SuccessResponse) => void; reject: (error: Error) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("../../workers/structure.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const response = event.data;
    const entry = pending.get(response.id);
    if (!entry) return;
    pending.delete(response.id);
    if (response.ok) {
      entry.resolve(response);
    } else {
      entry.reject(new Error(response.error));
    }
  };
  worker.onerror = () => {
    const error = new Error("The file reader crashed. Try the file again.");
    pending.forEach((entry) => entry.reject(error));
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

function callWorker(
  request: Omit<ExtractRequest, "id">,
  transfer: Transferable[] = []
): Promise<SuccessResponse> {
  const id = nextRequestId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ ...request, id }, transfer);
  });
}
