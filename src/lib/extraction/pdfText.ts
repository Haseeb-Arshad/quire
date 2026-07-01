// Client-side replacement for the old server's pdf-parse step: pull the text
// out of a PDF with pdf.js, reconstructing line breaks so the downstream
// heading heuristics (which expect newline-separated lines) keep working.

import { pdfjsLib, type PDFDocumentProxy } from "../pdf";
import { asString, type ExtractedText } from "./structure";

export interface PdfExtraction {
  extracted: ExtractedText;
  /** Still-open document so the caller can render a cover from page 1. Caller must destroy(). */
  doc: PDFDocumentProxy;
}

export async function extractPdfText(data: ArrayBuffer): Promise<PdfExtraction> {
  const doc = await pdfjsLib.getDocument({ data }).promise;
  const warnings: string[] = [];
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    let pageText = "";
    let lastY: number | null = null;

    for (const item of content.items) {
      if (!("str" in item)) continue;
      const y = item.transform[5] as number;
      // pdf.js reports explicit line ends; the y-delta check catches layouts
      // where hasEOL is missing (multi-column, unusual generators).
      if (lastY !== null && Math.abs(y - lastY) > 2 && pageText && !pageText.endsWith("\n")) {
        pageText += "\n";
      }
      pageText += item.str;
      if (item.hasEOL) pageText += "\n";
      lastY = y;
    }

    pages.push(pageText);
    page.cleanup();
  }

  const text = pages.join("\n\n");
  if (!text.trim()) {
    warnings.push("No selectable text was found. This PDF may be scanned or image-only.");
  }

  let title: string | undefined;
  let author: string | undefined;
  try {
    const metadata = await doc.getMetadata();
    const info = metadata.info as Record<string, unknown> | undefined;
    title = asString(info?.Title);
    author = asString(info?.Author);
  } catch {
    /* metadata is optional */
  }

  return {
    extracted: {
      text,
      title,
      author,
      pageCount: doc.numPages,
      sourceKind: "pdf",
      warnings
    },
    doc
  };
}
