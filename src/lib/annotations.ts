// Highlight + bookmark persistence (IndexedDB `annotations` store).

import type {
  Annotation,
  Bookmark,
  Highlight,
  HighlightColor,
  PageBookmark,
  PageHighlight
} from "./types";
import { getDb } from "./db";
import type { PageSelectionDraft, SelectionDraft } from "./anchors";

export async function getAnnotations(bookId: string): Promise<Annotation[]> {
  const db = await getDb();
  const annotations = await db.getAllFromIndex("annotations", "by-bookId", bookId);
  return annotations.sort((a, b) => a.createdAt - b.createdAt);
}

export async function addHighlights(
  bookId: string,
  drafts: SelectionDraft[],
  color: HighlightColor
): Promise<Highlight[]> {
  const db = await getDb();
  const created = drafts.map<Highlight>((draft) => ({
    kind: "highlight",
    id: crypto.randomUUID(),
    bookId,
    sectionId: draft.sectionId,
    paraIndex: draft.paraIndex,
    start: draft.start,
    end: draft.end,
    quote: draft.quote,
    color,
    createdAt: Date.now()
  }));
  const tx = db.transaction("annotations", "readwrite");
  await Promise.all(created.map((highlight) => tx.store.put(highlight)));
  await tx.done;
  return created;
}

export async function addBookmark(
  bookId: string,
  sectionId: string,
  paraIndex: number,
  label: string
): Promise<Bookmark> {
  const db = await getDb();
  const bookmark: Bookmark = {
    kind: "bookmark",
    id: crypto.randomUUID(),
    bookId,
    sectionId,
    paraIndex,
    label,
    createdAt: Date.now()
  };
  await db.put("annotations", bookmark);
  return bookmark;
}

export async function addPageHighlights(
  bookId: string,
  drafts: PageSelectionDraft[],
  color: HighlightColor
): Promise<PageHighlight[]> {
  const db = await getDb();
  const created = drafts.map<PageHighlight>((draft) => ({
    kind: "page-highlight",
    id: crypto.randomUUID(),
    bookId,
    page: draft.page,
    rects: draft.rects,
    quote: draft.quote,
    color,
    createdAt: Date.now()
  }));
  const tx = db.transaction("annotations", "readwrite");
  await Promise.all(created.map((highlight) => tx.store.put(highlight)));
  await tx.done;
  return created;
}

export async function addPageBookmark(bookId: string, page: number, label: string): Promise<PageBookmark> {
  const db = await getDb();
  const bookmark: PageBookmark = {
    kind: "page-bookmark",
    id: crypto.randomUUID(),
    bookId,
    page,
    label,
    createdAt: Date.now()
  };
  await db.put("annotations", bookmark);
  return bookmark;
}

export async function updateAnnotationNote(id: string, note: string): Promise<void> {
  const db = await getDb();
  const annotation = await db.get("annotations", id);
  if (!annotation || (annotation.kind !== "highlight" && annotation.kind !== "page-highlight")) return;
  await db.put("annotations", { ...annotation, note: note.trim() || undefined });
}

export async function deleteAnnotation(id: string): Promise<void> {
  const db = await getDb();
  await db.delete("annotations", id);
}

/** Re-anchor a highlight whose paragraph text no longer matches its offsets. */
export function resolveHighlightRange(
  highlight: Highlight,
  paragraph: string
): { start: number; end: number } | null {
  if (paragraph.slice(highlight.start, highlight.end) === highlight.quote) {
    return { start: highlight.start, end: highlight.end };
  }
  const at = paragraph.indexOf(highlight.quote);
  if (at === -1) return null;
  return { start: at, end: at + highlight.quote.length };
}
