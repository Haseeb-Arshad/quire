// Single place that wires the pdf.js worker for Vite. Import pdf.js through
// this module everywhere so GlobalWorkerOptions is configured exactly once.

import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export { pdfjsLib };
export const { OPS, Util, TextLayer } = pdfjsLib;
export type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
