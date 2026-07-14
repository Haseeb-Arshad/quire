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

/** Figure bitmap cropped from a source page. id = `${bookId}:fig:${page}:${n}`. */
export interface StoredImage {
  id: string;
  bookId: string;
  blob: Blob;
  width: number;
  height: number;
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
  images: {
    key: string;
    value: StoredImage;
    indexes: { "by-bookId": string };
  };
}

export type Database = IDBPDatabase<QuireDB>;

let dbPromise: Promise<Database> | null = null;

export function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = openDB<QuireDB>("quire", 2, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const books = db.createObjectStore("books", { keyPath: "id" });
          books.createIndex("by-uploadedAt", "uploadedAt");
          db.createObjectStore("contents", { keyPath: "id" });
          db.createObjectStore("files", { keyPath: "id" });
          db.createObjectStore("covers", { keyPath: "id" });
          const annotations = db.createObjectStore("annotations", { keyPath: "id" });
          annotations.createIndex("by-bookId", "bookId");
        }
        if (oldVersion < 2) {
          const images = db.createObjectStore("images", { keyPath: "id" });
          images.createIndex("by-bookId", "bookId");
        }
      }
    });
  }
  return dbPromise;
}
