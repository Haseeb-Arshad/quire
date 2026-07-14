// Cover thumbnails for the library grid: real page-1 renders for PDFs, the
// embedded cover image for EPUBs, and a generated typographic card for plain
// text formats.

import type { PDFDocumentProxy } from "../pdf";
import type { CoverTint } from "../types";

export const COVER_WIDTH = 480;

const TINT_FILL: Record<CoverTint, { bg: string; ink: string }> = {
  peach: { bg: "#f6e3d7", ink: "#9a5b3c" },
  sage: { bg: "#e2ead9", ink: "#5c7050" },
  sky: { bg: "#dde8ee", ink: "#4a6b7e" },
  lilac: { bg: "#e8e2ef", ink: "#6b5c85" },
  butter: { bg: "#f5ecd3", ink: "#8a7638" }
};

export async function renderPdfCover(doc: PDFDocumentProxy): Promise<Blob | null> {
  try {
    const page = await doc.getPage(1);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = COVER_WIDTH / baseViewport.width;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const context = canvas.getContext("2d");
    if (!context) return null;
    await page.render({ canvasContext: context, viewport }).promise;
    page.cleanup();
    return await canvasToBlob(canvas);
  } catch {
    return null;
  }
}

export async function generateTypographicCover(
  title: string,
  author: string | undefined,
  tint: CoverTint
): Promise<Blob | null> {
  const { bg, ink } = TINT_FILL[tint];
  const width = COVER_WIDTH;
  const height = Math.round(width * 1.4);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;

  context.fillStyle = bg;
  context.fillRect(0, 0, width, height);

  // Hairline frame, like a printed book board.
  context.strokeStyle = ink;
  context.globalAlpha = 0.25;
  context.lineWidth = 2;
  context.strokeRect(28, 28, width - 56, height - 56);
  context.globalAlpha = 1;

  context.fillStyle = ink;
  context.textAlign = "center";
  context.font = `600 34px "New York", "Iowan Old Style", Georgia, serif`;
  wrapText(context, title, width / 2, height * 0.34, width - 120, 44, 6);

  if (author) {
    context.globalAlpha = 0.75;
    context.font = `400 22px "New York", "Iowan Old Style", Georgia, serif`;
    wrapText(context, author, width / 2, height * 0.78, width - 140, 30, 2);
    context.globalAlpha = 1;
  }

  return canvasToBlob(canvas);
}

function wrapText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number
) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (context.measureText(candidate).width > maxWidth && line) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines - 1) break;
    } else {
      line = candidate;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && words.join(" ") !== lines.join(" ")) {
    lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, "…");
  }
  lines.forEach((entry, index) => context.fillText(entry, x, y + index * lineHeight, maxWidth));
}

export function canvasToBlob(canvas: HTMLCanvasElement, quality = 0.82): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(
      (webp) => {
        if (webp && webp.type === "image/webp") {
          resolve(webp);
          return;
        }
        // Safari < 17 has no WebP encoder — fall back to JPEG.
        canvas.toBlob((jpeg) => resolve(jpeg), "image/jpeg", 0.85);
      },
      "image/webp",
      quality
    );
  });
}
