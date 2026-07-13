export type SourceKind = "pdf" | "epub" | "text" | "html" | "markdown" | "unknown";

export type CoverTint = "peach" | "sage" | "sky" | "lilac" | "butter";

/**
 * One rendered unit of a section. `text` always equals the matching entry in
 * BookSection.paragraphs — search, highlights and bookmarks all anchor to that
 * string, so every block kind must round-trip through it (tables flatten to
 * cells joined with " · " and rows joined with "\n").
 */
export type ContentBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "heading"; text: string; level: 1 | 2 | 3 }
  | { kind: "list-item"; text: string; marker: string }
  | { kind: "code"; text: string }
  | { kind: "quote"; text: string }
  | { kind: "table"; text: string; rows: string[][]; headerRow: boolean };

export interface BookSection {
  id: string;
  title: string;
  level: number;
  paragraphs: string[];
  /** Parallel to paragraphs (blocks[i].text === paragraphs[i]). Absent on books imported before layout-aware extraction. */
  blocks?: ContentBlock[];
  wordCount: number;
}

export interface BookSummary {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  sourceKind: SourceKind;
  title: string;
  author?: string;
  language?: string;
  pageCount?: number;
  characterCount: number;
  wordCount: number;
  paragraphCount: number;
  sectionCount: number;
  warnings: string[];
  hasOriginal: boolean;
  coverTint: CoverTint;
  /** Bumped when the extraction pipeline improves; old PDFs are re-structured from the stored original on next open. */
  structureVersion?: number;
}

export interface BookDocument extends BookSummary {
  rawSample: string;
  sections: BookSection[];
}

export type HighlightColor = "amber" | "sage" | "sky" | "rose";

export interface Highlight {
  kind: "highlight";
  id: string;
  bookId: string;
  sectionId: string;
  paraIndex: number;
  start: number;
  end: number;
  quote: string;
  color: HighlightColor;
  note?: string;
  createdAt: number;
}

export interface Bookmark {
  kind: "bookmark";
  id: string;
  bookId: string;
  sectionId: string;
  paraIndex: number;
  label: string;
  createdAt: number;
}

export type Annotation = Highlight | Bookmark;
