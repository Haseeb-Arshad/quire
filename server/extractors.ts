import path from "node:path";
import JSZip from "jszip";
import pdfParse from "pdf-parse";
import type { BookDocument, BookSection, SourceKind } from "./bookTypes";

type ExtractionResult = {
  text: string;
  title?: string;
  author?: string;
  language?: string;
  pageCount?: number;
  sourceKind: SourceKind;
  warnings: string[];
};

const HEADING_WORDS = /^(chapter|book|part|section|preface|contents|introduction|appendix|volume|memoirs|letter|prologue|epilogue)\b/i;
const STRUCTURAL_OPENING_WORDS = /^(chapter|book|part|section|preface|contents|introduction|appendix|volume|letter|prologue|epilogue|foreword)\b/i;

export async function extractBookDocument(input: {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  buffer: Buffer;
  storedFile?: string;
}): Promise<BookDocument> {
  const extracted = await extractText(input.fileName, input.mimeType, input.buffer);
  const normalizedText = normalizeText(extracted.text);
  const blocks = createReadableBlocks(normalizedText);
  const inferredTitle = extracted.title || inferTitle(blocks, input.fileName);
  const sections = createSections(blocks, inferredTitle);
  const allParagraphs = sections.flatMap((section) => section.paragraphs);
  const joined = allParagraphs.join(" ");
  const wordCount = countWords(joined);

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
    wordCount,
    paragraphCount: allParagraphs.length,
    sectionCount: sections.length,
    rawSample: normalizedText.slice(0, 1800),
    warnings: extracted.warnings,
    sections,
    storedFile: input.storedFile,
    hasOriginal: extracted.sourceKind === "pdf" && Boolean(input.storedFile)
  };
}

async function extractText(fileName: string, mimeType: string, buffer: Buffer): Promise<ExtractionResult> {
  const extension = path.extname(fileName).toLowerCase();
  const sourceKind = detectSourceKind(extension, mimeType);
  const warnings: string[] = [];

  if (sourceKind === "pdf") {
    const result = await pdfParse(buffer);
    const info = result.info as Record<string, unknown> | undefined;
    if (!result.text.trim()) {
      warnings.push("No selectable text was found. This PDF may be scanned or image-only.");
    }
    return {
      text: result.text,
      title: asString(info?.Title),
      author: asString(info?.Author),
      pageCount: result.numpages,
      sourceKind,
      warnings
    };
  }

  if (sourceKind === "epub") {
    return extractEpub(buffer, warnings);
  }

  const text = buffer.toString("utf8");
  if (sourceKind === "html") {
    const metadata = plainTextMetadata(htmlToText(text));
    return {
      text: htmlToText(text),
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

function detectSourceKind(extension: string, mimeType: string): SourceKind {
  const mime = mimeType.toLowerCase();
  if (extension === ".pdf" || mime.includes("pdf")) return "pdf";
  if (extension === ".epub" || mime.includes("epub")) return "epub";
  if ([".html", ".htm"].includes(extension) || mime.includes("html")) return "html";
  if ([".md", ".markdown"].includes(extension)) return "markdown";
  if ([".txt", ".text"].includes(extension) || mime.startsWith("text/")) return "text";
  return "unknown";
}

async function extractEpub(buffer: Buffer, warnings: string[]): Promise<ExtractionResult> {
  const zip = await JSZip.loadAsync(buffer);
  const container = await zip.file("META-INF/container.xml")?.async("string");
  const rootfile = container?.match(/full-path=["']([^"']+)["']/i)?.[1];
  if (!rootfile) {
    warnings.push("EPUB package metadata was not found. Reading all XHTML files instead.");
  }

  const opfText = rootfile ? await zip.file(rootfile)?.async("string") : undefined;
  const baseDir = rootfile ? path.posix.dirname(rootfile) : "";
  const title = opfText ? decodeEntities(stripTags(findXmlText(opfText, "dc:title") || "")) : undefined;
  const author = opfText ? decodeEntities(stripTags(findXmlText(opfText, "dc:creator") || "")) : undefined;
  const language = opfText ? decodeEntities(stripTags(findXmlText(opfText, "dc:language") || "")) : undefined;
  const orderedFiles = opfText ? getEpubSpineFiles(opfText, baseDir) : [];
  const fallbackFiles = Object.keys(zip.files).filter((name) => /\.(xhtml|html|htm)$/i.test(name));
  const files = orderedFiles.length ? orderedFiles : fallbackFiles;
  const parts: string[] = [];

  for (const filePath of files) {
    const entry = zip.file(filePath);
    if (!entry) continue;
    const html = await entry.async("string");
    parts.push(htmlToText(html));
  }

  if (!parts.length) {
    warnings.push("No readable EPUB spine files were found.");
  }

  return {
    text: parts.join("\n\n"),
    title,
    author,
    language,
    sourceKind: "epub",
    warnings
  };
}

function getEpubSpineFiles(opfText: string, baseDir: string): string[] {
  const manifest = new Map<string, string>();
  for (const item of opfText.matchAll(/<item\b[^>]*>/gi)) {
    const tag = item[0];
    const id = attr(tag, "id");
    const href = attr(tag, "href");
    if (id && href) {
      manifest.set(id, path.posix.normalize(path.posix.join(baseDir, href)));
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

function normalizeText(text: string): string {
  return text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
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
  return path.basename(fileName, path.extname(fileName)).replace(/[-_]+/g, " ");
}

function cleanDisplayText(text: string): string {
  return decodeEntities(text)
    .replace(/\s+/g, " ")
    .replace(/[|]{2,}/g, "|")
    .trim();
}

function normalizedForMatch(text: string): string {
  return cleanDisplayText(text).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function htmlToText(html: string): string {
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

function findXmlText(xml: string, tagName: string): string | undefined {
  return xml.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"))?.[1]?.trim();
}

function stripTags(text: string): string {
  return text.replace(/<[^>]+>/g, " ");
}

function attr(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`\\b${name}=["']([^"']+)["']`, "i"))?.[1];
}

function decodeEntities(text: string): string {
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

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "section";
}

function countWords(text: string): number {
  return text.match(/\b[\w']+\b/g)?.length || 0;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
