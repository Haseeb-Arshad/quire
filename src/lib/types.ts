export type SourceKind = "pdf" | "epub" | "text" | "html" | "markdown" | "unknown";

export type CoverTint = "peach" | "sage" | "sky" | "lilac" | "butter";

export interface BookSection {
  id: string;
  title: string;
  level: number;
  paragraphs: string[];
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
