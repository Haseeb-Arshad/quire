// In-book search: a lowercase index built once per book, scanned per query.

import type { BookDocument } from "./types";

export interface SearchMatch {
  sectionId: string;
  paraIndex: number;
  start: number;
  end: number;
}

interface IndexEntry {
  sectionId: string;
  paraIndex: number;
  lower: string;
}

export const MATCH_CAP = 500;

const indexCache = new WeakMap<BookDocument, IndexEntry[]>();

export function buildIndex(book: BookDocument): IndexEntry[] {
  const cached = indexCache.get(book);
  if (cached) return cached;
  const entries: IndexEntry[] = [];
  for (const section of book.sections) {
    section.paragraphs.forEach((paragraph, paraIndex) => {
      entries.push({ sectionId: section.id, paraIndex, lower: paragraph.toLowerCase() });
    });
  }
  indexCache.set(book, entries);
  return entries;
}

export function runSearch(book: BookDocument | undefined, query: string): SearchMatch[] {
  const needle = query.trim().toLowerCase();
  if (!book || needle.length < 2) return [];
  const index = buildIndex(book);
  const matches: SearchMatch[] = [];
  for (const entry of index) {
    let from = 0;
    while (matches.length < MATCH_CAP) {
      const at = entry.lower.indexOf(needle, from);
      if (at === -1) break;
      matches.push({
        sectionId: entry.sectionId,
        paraIndex: entry.paraIndex,
        start: at,
        end: at + needle.length
      });
      from = at + needle.length;
    }
    if (matches.length >= MATCH_CAP) break;
  }
  return matches;
}
