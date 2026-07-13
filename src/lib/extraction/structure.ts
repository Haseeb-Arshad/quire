// Browser-safe port of the text-structuring pipeline that used to live in
// server/extractors.ts. Everything here is pure string work — no DOM, no Node —
// so it runs identically on the main thread and inside structure.worker.ts.

import type { BookDocument, BookSection, CoverTint, SourceKind } from "../types";

export interface ExtractedText {
  text: string;
  title?: string;
  author?: string;
  language?: string;
  pageCount?: number;
  sourceKind: SourceKind;
  warnings: string[];
}

export interface BuildInput {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  extracted: ExtractedText;
  hasOriginal: boolean;
}

const HEADING_WORDS = /^(chapter|book|part|section|preface|contents|introduction|appendix|volume|memoirs|letter|prologue|epilogue)\b/i;
const STRUCTURAL_OPENING_WORDS = /^(chapter|book|part|section|preface|contents|introduction|appendix|volume|letter|prologue|epilogue|foreword)\b/i;

const COVER_TINTS: CoverTint[] = ["peach", "sage", "sky", "lilac", "butter"];

/**
 * Bump when extraction output improves enough that stored books should be
 * rebuilt from their original bytes (PDFs keep the original in IndexedDB).
 * v2: layout-aware PDF extraction — real paragraphs, headings, lists, tables.
 */
export const STRUCTURE_VERSION = 2;

export function buildBookDocument(input: BuildInput): BookDocument {
  const { extracted } = input;
  const normalizedText = normalizeText(extracted.text);
  const blocks = createReadableBlocks(normalizedText);
  const inferredTitle = extracted.title || inferTitle(blocks, input.fileName);
  const sections = createSections(blocks, inferredTitle);
  const allParagraphs = sections.flatMap((section) => section.paragraphs);
  const joined = allParagraphs.join(" ");

  return {
    id: input.id,
    fileName: input.fileName,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    uploadedAt: input.uploadedAt,
    sourceKind: extracted.sourceKind,
    title: cleanDisplayText(inferredTitle),
    author: extracted.author ? cleanDisplayText(extracted.author) : undefined,
    language: extracted.language,
    pageCount: extracted.pageCount,
    characterCount: joined.length,
    wordCount: countWords(joined),
    paragraphCount: allParagraphs.length,
    sectionCount: sections.length,
    rawSample: normalizedText.slice(0, 1800),
    warnings: extracted.warnings,
    sections,
    hasOriginal: input.hasOriginal,
    coverTint: pickCoverTint(input.id),
    structureVersion: STRUCTURE_VERSION
  };
}

export function pickCoverTint(id: string): CoverTint {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return COVER_TINTS[hash % COVER_TINTS.length];
}

export function detectSourceKind(fileName: string, mimeType: string): SourceKind {
  const extension = extnameOf(fileName);
  const mime = mimeType.toLowerCase();
  if (extension === ".pdf" || mime.includes("pdf")) return "pdf";
  if (extension === ".epub" || mime.includes("epub")) return "epub";
  if ([".html", ".htm"].includes(extension) || mime.includes("html")) return "html";
  if ([".md", ".markdown"].includes(extension)) return "markdown";
  if ([".txt", ".text"].includes(extension) || mime.startsWith("text/")) return "text";
  return "unknown";
}

export function extractPlainFormats(text: string, sourceKind: SourceKind): ExtractedText {
  const warnings: string[] = [];

  if (sourceKind === "html") {
    const converted = htmlToText(text);
    const metadata = plainTextMetadata(converted);
    return {
      text: converted,
      title: findTagText(text, "title") || findTagText(text, "h1") || metadata.title,
      author: metadata.author,
      language: metadata.language,
      sourceKind,
      warnings
    };
  }

  if (sourceKind === "markdown") {
    const metadata = plainTextMetadata(text);
    return {
      text: markdownToText(text),
      title: inferMarkdownTitle(text) || metadata.title,
      author: metadata.author,
      language: metadata.language,
      sourceKind,
      warnings
    };
  }

  const metadata = plainTextMetadata(text);
  return {
    text,
    title: metadata.title,
    author: metadata.author,
    language: metadata.language,
    sourceKind,
    warnings
  };
}

/* ------------------------------------------------------------------ */
/* EPUB helpers (jszip itself is driven by the worker)                 */
/* ------------------------------------------------------------------ */

export function getEpubSpineFiles(opfText: string, baseDir: string): string[] {
  const manifest = new Map<string, string>();
  for (const item of opfText.matchAll(/<item\b[^>]*>/gi)) {
    const tag = item[0];
    const id = attr(tag, "id");
    const href = attr(tag, "href");
    if (id && href) {
      manifest.set(id, posixNormalize(posixJoin(baseDir, href)));
    }
  }

  const files: string[] = [];
  for (const itemref of opfText.matchAll(/<itemref\b[^>]*>/gi)) {
    const idref = attr(itemref[0], "idref");
    const href = idref ? manifest.get(idref) : undefined;
    if (href) files.push(href);
  }
  return files;
}

export function findEpubCoverHref(opfText: string, baseDir: string): string | undefined {
  const coverId =
    opfText.match(/<meta\b[^>]*name=["']cover["'][^>]*>/i)?.[0].match(/content=["']([^"']+)["']/i)?.[1];
  for (const item of opfText.matchAll(/<item\b[^>]*>/gi)) {
    const tag = item[0];
    const id = attr(tag, "id");
    const href = attr(tag, "href");
    const mediaType = attr(tag, "media-type") || "";
    const properties = attr(tag, "properties") || "";
    if (!href || !mediaType.startsWith("image/")) continue;
    if ((coverId && id === coverId) || /cover-image/.test(properties) || /cover/i.test(href)) {
      return posixNormalize(posixJoin(baseDir, href));
    }
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/* Structuring pipeline                                                */
/* ------------------------------------------------------------------ */

export function normalizeText(text: string): string {
  return text
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function createReadableBlocks(text: string): string[] {
  const lines = text.split("\n").map((line) => line.trim());
  const blocks: string[] = [];
  let buffer: string[] = [];

  const flush = () => {
    if (!buffer.length) return;
    blocks.push(joinLines(buffer));
    buffer = [];
  };

  for (const line of lines) {
    if (!line) {
      flush();
      continue;
    }

    if (isHeadingLine(line)) {
      flush();
      blocks.push(cleanDisplayText(line));
      continue;
    }

    buffer.push(line);
  }

  flush();
  return blocks.map(cleanDisplayText).filter((block) => block.length > 1);
}

function joinLines(lines: string[]): string {
  let result = "";
  for (const line of lines) {
    if (!result) {
      result = line;
    } else if (result.endsWith("-")) {
      result = result.slice(0, -1) + line;
    } else {
      result += " " + line;
    }
  }
  return result;
}

function createSections(blocks: string[], title: string): BookSection[] {
  if (!blocks.length) {
    return [makeSection("section-1", title || "Untitled book", 1, ["No readable text was extracted."])];
  }

  const sections: BookSection[] = [];
  let currentTitle = "Front Matter";
  let paragraphs: string[] = [];

  const flush = () => {
    if (!paragraphs.length && sections.length) return;
    const id = slugify(`${sections.length + 1}-${currentTitle}`);
    sections.push(makeSection(id, currentTitle, currentTitle === "Front Matter" ? 1 : 2, paragraphs));
    paragraphs = [];
  };

  for (const block of blocks) {
    if (!sections.length && currentTitle === "Front Matter" && isTitlePageFragment(block, title, paragraphs.length)) {
      paragraphs.push(block);
      continue;
    }

    if (isSectionHeading(block)) {
      if (!paragraphs.length && !sections.length) {
        currentTitle = block;
        continue;
      }

      flush();
      currentTitle = block;
      continue;
    }
    paragraphs.push(block);
  }
  flush();

  if (sections.length <= 1 && sections[0]?.paragraphs.length > 14) {
    return splitLargeSection(sections[0], title);
  }

  return sections;
}

function splitLargeSection(section: BookSection, title: string): BookSection[] {
  const chunks: BookSection[] = [];
  let paragraphs: string[] = [];
  let words = 0;

  for (const paragraph of section.paragraphs) {
    paragraphs.push(paragraph);
    words += countWords(paragraph);
    if (words > 1200) {
      const index = chunks.length + 1;
      chunks.push(makeSection(`part-${index}`, `${title || "Book"} - Part ${index}`, 2, paragraphs));
      paragraphs = [];
      words = 0;
    }
  }

  if (paragraphs.length) {
    const index = chunks.length + 1;
    chunks.push(makeSection(`part-${index}`, `${title || "Book"} - Part ${index}`, 2, paragraphs));
  }

  return chunks;
}

function makeSection(id: string, title: string, level: number, paragraphs: string[]): BookSection {
  return {
    id,
    title: cleanDisplayText(title),
    level,
    paragraphs,
    wordCount: countWords(paragraphs.join(" "))
  };
}

function isHeadingLine(line: string): boolean {
  const trimmed = cleanDisplayText(line);
  if (trimmed.length > 120 || trimmed.length < 3) return false;
  if (HEADING_WORDS.test(trimmed)) return true;
  const letters = trimmed.replace(/[^a-z]/gi, "");
  if (letters.length < 5) return false;
  const uppercaseLetters = letters.replace(/[^A-Z]/g, "");
  const uppercaseRatio = uppercaseLetters.length / letters.length;
  const punctuationLight = !/[.!?;,]$/.test(trimmed);
  return uppercaseRatio > 0.72 && punctuationLight;
}

function isSectionHeading(block: string): boolean {
  if (HEADING_WORDS.test(block)) return true;
  if (block.length < 90 && isHeadingLine(block)) return true;
  return /^#{1,3}\s+/.test(block);
}

function isTitlePageFragment(block: string, title: string, frontMatterParagraphCount: number): boolean {
  const clean = cleanDisplayText(block);
  if (frontMatterParagraphCount > 10 || !isSectionHeading(clean) || STRUCTURAL_OPENING_WORDS.test(clean)) {
    return false;
  }

  if (normalizedForMatch(title).includes(normalizedForMatch(clean))) {
    return true;
  }

  const words = countWords(clean);
  const letters = clean.replace(/[^a-z]/gi, "");
  const punctuationLight = !/[.!?;,]$/.test(clean);
  const allCaps = letters.length > 0 && letters === letters.toUpperCase();
  return words <= 6 && allCaps && punctuationLight;
}

function inferTitle(blocks: string[], fileName: string): string {
  const firstStrongBlock = blocks.find((block) => {
    const clean = cleanDisplayText(block);
    return clean.length >= 4 && clean.length <= 110 && !/^project gutenberg/i.test(clean);
  });

  if (firstStrongBlock) return firstStrongBlock.replace(/^#+\s*/, "");
  return basenameWithoutExt(fileName).replace(/[-_]+/g, " ");
}

export function cleanDisplayText(text: string): string {
  return decodeEntities(text)
    .replace(/\s+/g, " ")
    .replace(/[|]{2,}/g, "|")
    .trim();
}

function normalizedForMatch(text: string): string {
  return cleanDisplayText(text).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/* ------------------------------------------------------------------ */
/* Format converters                                                   */
/* ------------------------------------------------------------------ */

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<(h[1-6]|title)[^>]*>([\s\S]*?)<\/\1>/gi, "\n\n$2\n\n")
      .replace(/<(p|div|section|article|br|li|tr|blockquote)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  );
}

function markdownToText(markdown: string): string {
  return markdown
    .replace(/^```[\s\S]*?```/gm, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/[*_`>]+/g, "");
}

function inferMarkdownTitle(markdown: string): string | undefined {
  return markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
}

function plainTextMetadata(text: string) {
  return {
    title: text.match(/^Title:\s*(.+)$/im)?.[1]?.trim(),
    author: text.match(/^Author:\s*(.+)$/im)?.[1]?.trim(),
    language: text.match(/^Language:\s*(.+)$/im)?.[1]?.trim()
  };
}

function findTagText(html: string, tagName: string): string | undefined {
  return html.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"))?.[1]?.replace(/<[^>]+>/g, " ").trim();
}

export function findXmlText(xml: string, tagName: string): string | undefined {
  return xml.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"))?.[1]?.trim();
}

export function stripTags(text: string): string {
  return text.replace(/<[^>]+>/g, " ");
}

function attr(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`\\b${name}=["']([^"']+)["']`, "i"))?.[1];
}

export function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: "\"",
    apos: "'",
    nbsp: " "
  };
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_match, entity: string) => {
    if (entity[0] === "#") {
      const isHex = entity[1]?.toLowerCase() === "x";
      const code = Number.parseInt(entity.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    }
    return named[entity.toLowerCase()] || "";
  });
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "section";
}

export function countWords(text: string): number {
  return text.match(/\b[\w']+\b/g)?.length || 0;
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/* ------------------------------------------------------------------ */
/* Tiny path helpers (replace node:path for EPUB internal hrefs)       */
/* ------------------------------------------------------------------ */

function extnameOf(fileName: string): string {
  const base = fileName.slice(fileName.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot).toLowerCase() : "";
}

function basenameWithoutExt(fileName: string): string {
  const base = fileName.slice(Math.max(fileName.lastIndexOf("/"), fileName.lastIndexOf("\\")) + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

export function posixDirname(p: string): string {
  const index = p.lastIndexOf("/");
  return index === -1 ? "" : p.slice(0, index);
}

function posixJoin(...parts: string[]): string {
  return parts.filter(Boolean).join("/");
}

function posixNormalize(p: string): string {
  const output: string[] = [];
  for (const segment of p.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      output.pop();
    } else {
      output.push(segment);
    }
  }
  return output.join("/");
}
