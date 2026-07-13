// Local-first replacement for the old fetch API: every book lives in
// IndexedDB. Function shapes match the old src/api.ts so query call sites
// stay familiar.

import type { BookDocument, BookSummary } from "./types";
import { getDb, type Database } from "./db";
import { extractFromFile } from "./extraction";
import { STRUCTURE_VERSION } from "./extraction/structure";
import { removeBookPrefs } from "./preferences";
import { removeStats } from "./readingStats";

export async function getBooks(): Promise<BookSummary[]> {
  const db = await getDb();
  const books = await db.getAll("books");
  return books.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}

export async function getBook(id: string): Promise<BookDocument> {
  const db = await getDb();
  const [summary, contents] = await Promise.all([db.get("books", id), db.get("contents", id)]);
  if (!summary || !contents) {
    throw new Error("This book is no longer in your library.");
  }

  // PDFs imported before layout-aware extraction keep their original bytes, so
  // rebuild them once with the current pipeline (real paragraphs, tables, TOC).
  if (summary.sourceKind === "pdf" && (summary.structureVersion ?? 1) < STRUCTURE_VERSION) {
    const rebuilt = await restructureBook(db, summary);
    if (rebuilt) return rebuilt;
  }

  return { ...summary, sections: contents.sections, rawSample: contents.rawSample };
}

async function restructureBook(db: Database, summary: BookSummary): Promise<BookDocument | null> {
  try {
    const stored = await db.get("files", summary.id);
    if (!stored) return null;
    const file = new File([stored.blob], stored.name || summary.fileName, {
      type: stored.type || "application/pdf"
    });
    const { book, cover } = await extractFromFile(file, summary.id, summary.uploadedAt);
    // Preserve a user-chosen title over the re-inferred one.
    const kept: BookDocument = { ...book, title: summary.title || book.title };
    const tx = db.transaction(["books", "contents", "covers"], "readwrite");
    await Promise.all([
      tx.objectStore("books").put(summarize(kept)),
      tx.objectStore("contents").put({ id: kept.id, sections: kept.sections, rawSample: kept.rawSample }),
      cover ? tx.objectStore("covers").put({ id: kept.id, blob: cover }) : Promise.resolve(undefined)
    ]);
    await tx.done;
    return kept;
  } catch {
    // Never block reading on a failed rebuild — the stored structure still works.
    return null;
  }
}

export async function importBook(file: File): Promise<BookDocument> {
  const id = crypto.randomUUID();
  const uploadedAt = new Date().toISOString();
  const { book, original, cover } = await extractFromFile(file, id, uploadedAt);

  const db = await getDb();
  const tx = db.transaction(["books", "contents", "files", "covers"], "readwrite");
  const summary = summarize(book);
  await Promise.all([
    tx.objectStore("books").put(summary),
    tx.objectStore("contents").put({ id, sections: book.sections, rawSample: book.rawSample }),
    original
      ? tx.objectStore("files").put({ id, name: file.name, type: file.type || "application/pdf", blob: original })
      : Promise.resolve(undefined),
    cover ? tx.objectStore("covers").put({ id, blob: cover }) : Promise.resolve(undefined)
  ]);
  await tx.done;
  return book;
}

export async function deleteBook(id: string): Promise<void> {
  const db = await getDb();
  const annotationKeys = await db.getAllKeysFromIndex("annotations", "by-bookId", id);
  const tx = db.transaction(["books", "contents", "files", "covers", "annotations"], "readwrite");
  await Promise.all([
    tx.objectStore("books").delete(id),
    tx.objectStore("contents").delete(id),
    tx.objectStore("files").delete(id),
    tx.objectStore("covers").delete(id),
    ...annotationKeys.map((key) => tx.objectStore("annotations").delete(key))
  ]);
  await tx.done;
  removeStats(id);
  removeBookPrefs(id);
}

export async function renameBook(id: string, title: string): Promise<void> {
  const db = await getDb();
  const summary = await db.get("books", id);
  if (!summary) return;
  await db.put("books", { ...summary, title: title.trim() || summary.title });
}

export async function getFileBlob(id: string): Promise<Blob | undefined> {
  const db = await getDb();
  const stored = await db.get("files", id);
  return stored?.blob;
}

export async function getCoverBlob(id: string): Promise<Blob | undefined> {
  const db = await getDb();
  const stored = await db.get("covers", id);
  return stored?.blob;
}

export async function createDemoBook(): Promise<BookDocument> {
  const file = new File([DEMO_BOOK_TEXT], "memoirs-demo.txt", { type: "text/plain" });
  return importBook(file);
}

function summarize(book: BookDocument): BookSummary {
  const { sections: _sections, rawSample: _rawSample, ...summary } = book;
  return summary;
}

const DEMO_BOOK_TEXT = `The Project Gutenberg eBook of Memoirs of Extraordinary Popular Delusions and the Madness of Crowds

Title: Memoirs of Extraordinary Popular Delusions and the Madness of Crowds
Author: Charles Mackay
Language: English

MEMOIRS

OF

EXTRAORDINARY POPULAR DELUSIONS

AND THE

MADNESS OF CROWDS

PREFACE

In reading the history of nations, we find that, like individuals, they have their whims and their peculiarities, their seasons of excitement and recklessness, when they care not what they do.

Men, it has been well said, think in herds. It will be seen that they go mad in herds, while they only recover their senses slowly, and one by one.

THE MISSISSIPPI SCHEME

The personal character and career of one man are so intimately connected with the great scheme which bears the name of the Mississippi, that a history of the madness of the people would be incomplete without him.

The people, eager for sudden wealth, forgot the slow processes by which prosperity is commonly achieved. Every rumor became a promise, and every promise became a market.

THE SOUTH SEA BUBBLE

Another delusion, no less remarkable, seized upon England at a time when speculation had become the fashion of the day.

The street, the coffee-house, and the exchange were filled with projects. Some were impossible, some were fraudulent, and some were only dreams dressed in the language of commerce.`;
