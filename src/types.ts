export type SourceKind = "pdf" | "epub" | "text" | "html" | "markdown" | "unknown";

export interface BookSection {
  id: string;
  title: string;
  level: number;
  paragraphs: string[];
  wordCount: number;
}

export interface BookDocument {
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
  rawSample: string;
  warnings: string[];
  sections: BookSection[];
  storedFile?: string;
  hasOriginal?: boolean;
}

export type BookSummary = Omit<BookDocument, "sections" | "rawSample">;
