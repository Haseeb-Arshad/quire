// IndexedDB layer. Book metadata and content live in separate stores so the
// library list never deserializes megabytes of paragraphs.

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Annotation, BookSection, BookSummary } from "./types";

export interface BookContents {
  id: string;
  sections: BookSection[];
  rawSample: string;
}

export interface StoredFile {
  id: string;
  name: string;
  type: string;
  blob: Blob;
}

export interface StoredCover {
  id: string;
  blob: Blob;
}

interface QuireDB extends DBSchema {
  books: {
    key: string;
    value: BookSummary;
    indexes: { "by-uploadedAt": string };
  };
  contents: {
    key: string;
    value: BookContents;
  };
  files: {
    key: string;
    value: StoredFile;
  };
  covers: {
    key: string;
    value: StoredCover;
  };
  annotations: {
    key: string;
    value: Annotation;
    indexes: { "by-bookId": string };
  };
}

export type Database = IDBPDatabase<QuireDB>;

let dbPromise: Promise<Database> | null = null;

export function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = openDB<QuireDB>("quire", 1, {
      upgrade(db) {
        const books = db.createObjectStore("books", { keyPath: "id" });
        books.createIndex("by-uploadedAt", "uploadedAt");
        db.createObjectStore("contents", { keyPath: "id" });
        db.createObjectStore("files", { keyPath: "id" });
        db.createObjectStore("covers", { keyPath: "id" });
        const annotations = db.createObjectStore("annotations", { keyPath: "id" });
        annotations.createIndex("by-bookId", "bookId");
      }
    });
  }
  return dbPromise;
}
