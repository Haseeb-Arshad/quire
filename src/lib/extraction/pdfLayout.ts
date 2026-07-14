// Layout-aware PDF reading. Instead of flattening pdf.js text items into a
// newline-soup string (which shredded paragraphs and dissolved tables), this
// module keeps the geometry of every text run and rebuilds the document the
// way a typesetter would read it:
//
//   items → lines (baseline clustering)
//         → page furniture removal (running heads, page numbers)
//         → column regions (recursive gutter detection, up to 4 columns)
//         → embedded figures (CTM-tracked image placements, cropped + stored)
//         → blocks: headings, list items, code, tables, figures, paragraphs
//         → cross-page paragraph stitching
//
// Everything below `extractPdfLayout` is pure geometry/string work so it can
// be unit-tested without pdf.js.

import { OPS, Util } from "../pdf";
import type { PDFDocumentProxy, PDFPageProxy } from "../pdf";
import type { ContentBlock } from "../types";
import { canvasToBlob } from "./covers";

/* ------------------------------------------------------------------ */
/* Public shapes                                                       */
/* ------------------------------------------------------------------ */

export interface PdfBlock {
  block: ContentBlock;
  /** 0-based page the block starts on. */
  page: number;
  /** Font size of the source line — used to tier heading levels doc-wide. */
  size: number;
}

export interface PdfOutlineEntry {
  title: string;
  page: number;
}

/** A cropped, encoded figure ready for the images store (key is book-relative). */
export interface ExtractedFigure {
  key: string;
  page: number;
  blob: Blob;
  width: number;
  height: number;
}

export interface PdfLayoutResult {
  blocks: PdfBlock[];
  outline: PdfOutlineEntry[];
  figures: ExtractedFigure[];
  warnings: string[];
}

/* ------------------------------------------------------------------ */
/* Internal shapes                                                     */
/* ------------------------------------------------------------------ */

export interface Span {
  text: string;
  x: number;
  x1: number;
  y: number;
  size: number;
  mono: boolean;
}

interface Chunk {
  x0: number;
  x1: number;
  text: string;
}

export interface Line {
  page: number;
  y: number;
  x0: number;
  x1: number;
  size: number;
  mono: boolean;
  text: string;
  /** Runs separated by column-sized horizontal gaps — table cell candidates. */
  chunks: Chunk[];
}

interface PageGeometry {
  width: number;
  height: number;
}

/* ------------------------------------------------------------------ */
/* Driver                                                              */
/* ------------------------------------------------------------------ */

export async function extractPdfLayout(doc: PDFDocumentProxy): Promise<PdfLayoutResult> {
  const warnings: string[] = [];
  const pageLines: Line[][] = [];
  const geometries: PageGeometry[] = [];
  const pagePlacements: ImagePlacement[][] = [];

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();

    const spans: Span[] = [];
    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      const style = content.styles[item.fontName];
      if (style?.vertical) continue;
      const size = item.height || Math.hypot(item.transform[2], item.transform[3]) || 10;
      spans.push({
        text: item.str,
        x: item.transform[4],
        x1: item.transform[4] + (item.width || 0),
        y: item.transform[5],
        size,
        mono: /mono/i.test(style?.fontFamily || "")
      });
    }

    pageLines.push(buildLines(spans, pageNumber - 1));
    geometries.push({ width: viewport.width, height: viewport.height });
    pagePlacements.push(await collectImagePlacements(page, viewport));
    page.cleanup();
  }

  stripPageFurniture(pageLines, geometries);

  const bodySize = findBodySize(pageLines.flat());
  const { figures, pageFigures } = await harvestFigures(doc, pagePlacements, geometries, warnings);
  detectCaptions(pageLines, pageFigures, bodySize);

  const blocks: PdfBlock[] = [];
  for (let pageIndex = 0; pageIndex < pageLines.length; pageIndex += 1) {
    const regions = splitColumns(pageLines[pageIndex], geometries[pageIndex].width);
    const assigned = assignFiguresToRegions(regions, pageFigures.get(pageIndex) || [], bodySize);
    appendBlocks(blocks, assigned.leading);
    for (let r = 0; r < regions.length; r += 1) {
      appendBlocks(blocks, buildBlocks(regions[r], bodySize, assigned.perRegion[r]));
    }
  }

  assignHeadingLevels(blocks, bodySize);

  const outline = await resolveOutline(doc);
  if (!blocks.length) {
    warnings.push("No selectable text was found. This PDF may be scanned or image-only.");
  }

  return { blocks, outline, figures, warnings };
}

/* ------------------------------------------------------------------ */
/* Items → lines                                                       */
/* ------------------------------------------------------------------ */

/** Horizontal gap big enough to read as a table column boundary. */
function chunkGap(size: number): number {
  return Math.max(size * 1.9, 9);
}

/** Horizontal gap big enough to need a space glyph inserted. */
function wordGap(size: number): number {
  return Math.max(size * 0.19, 1.2);
}

export function buildLines(spans: Span[], page: number): Line[] {
  const sorted = [...spans].sort((a, b) => b.y - a.y || a.x - b.x);
  const groups: Span[][] = [];

  for (const span of sorted) {
    const group = groups[groups.length - 1];
    if (group) {
      const reference = group[0];
      const tolerance = Math.max(2, Math.min(reference.size, span.size) * 0.42);
      if (Math.abs(span.y - reference.y) <= tolerance) {
        group.push(span);
        continue;
      }
    }
    groups.push([span]);
  }

  return groups.map((group) => {
    group.sort((a, b) => a.x - b.x);
    const size = dominantSize(group);
    const chunks: Chunk[] = [];
    let text = "";

    for (const span of group) {
      const last = chunks[chunks.length - 1];
      const gap = last ? span.x - last.x1 : 0;
      if (!last || gap > chunkGap(size)) {
        chunks.push({ x0: span.x, x1: span.x1, text: span.text.trim() });
        text = text ? `${text} ${span.text}` : span.text;
        continue;
      }
      const needsSpace = gap > wordGap(span.size) && !/\s$/.test(last.text) && !/^\s/.test(span.text);
      last.text += (needsSpace ? " " : "") + span.text.trim();
      last.x1 = Math.max(last.x1, span.x1);
      text += (needsSpace && !/\s$/.test(text) ? " " : "") + span.text;
    }

    return {
      page,
      y: group[0].y,
      x0: group[0].x,
      x1: Math.max(...group.map((span) => span.x1)),
      size,
      mono: group.filter((span) => span.mono).length > group.length / 2,
      text: text.replace(/\s+/g, " ").trim(),
      chunks: chunks.filter((chunk) => chunk.text)
    };
  }).filter((line) => line.text);
}

function dominantSize(spans: Span[]): number {
  const weights = new Map<number, number>();
  for (const span of spans) {
    const key = Math.round(span.size * 2) / 2;
    weights.set(key, (weights.get(key) || 0) + span.text.length);
  }
  let best = spans[0]?.size || 10;
  let bestWeight = -1;
  for (const [size, weight] of weights) {
    if (weight > bestWeight) {
      best = size;
      bestWeight = weight;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Page furniture: running heads, folios                               */
/* ------------------------------------------------------------------ */

function stripPageFurniture(pageLines: Line[][], geometries: PageGeometry[]): void {
  const pageCount = pageLines.length;
  if (!pageCount) return;

  const zoneOf = (line: Line, geometry: PageGeometry): "top" | "bottom" | null => {
    const margin = geometry.height * 0.08;
    if (line.y >= geometry.height - margin) return "top";
    if (line.y <= margin) return "bottom";
    return null;
  };

  const seenOn = new Map<string, Set<number>>();
  pageLines.forEach((lines, pageIndex) => {
    for (const line of lines) {
      const zone = zoneOf(line, geometries[pageIndex]);
      if (!zone) continue;
      const key = `${zone}|${furnitureKey(line.text)}`;
      let pages = seenOn.get(key);
      if (!pages) seenOn.set(key, (pages = new Set()));
      pages.add(pageIndex);
    }
  });

  const repeatThreshold = Math.max(3, Math.ceil(pageCount * 0.35));
  pageLines.forEach((lines, pageIndex) => {
    pageLines[pageIndex] = lines.filter((line) => {
      const zone = zoneOf(line, geometries[pageIndex]);
      if (!zone) return true;
      if (isFolio(line.text)) return false;
      const pages = seenOn.get(`${zone}|${furnitureKey(line.text)}`);
      return !pages || pages.size < repeatThreshold;
    });
  });
}

function furnitureKey(text: string): string {
  return text.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
}

function isFolio(text: string): boolean {
  const t = text.trim();
  return /^\d{1,4}$/.test(t) || /^[ivxlcdm]{1,7}$/i.test(t) || /^page\s+\d+(\s+of\s+\d+)?$/i.test(t);
}

/* ------------------------------------------------------------------ */
/* Column regions                                                      */
/* ------------------------------------------------------------------ */

/**
 * Detect multi-column layouts by hunting for vertical gutters that almost no
 * text CHUNK crosses, recursively: find the cleanest gutter, split, then try
 * again inside each half (up to four columns — newspaper pages). Chunks, not
 * lines: baseline clustering merges side-by-side column text at the same y
 * into one line, so line extents always span the gutter. Straddling lines are
 * split into per-column lines; only chunks that physically cross a gutter
 * (spanning headlines, abstracts) force a line into that level's full-width
 * region. Returns reading-ordered regions: spanning material first, then
 * columns left to right.
 */
export function splitColumns(lines: Line[], pageWidth: number): Line[][] {
  return splitRegion(lines, 0, pageWidth, pageWidth, 0);
}

function splitRegion(
  lines: Line[],
  regionX0: number,
  regionX1: number,
  pageWidth: number,
  depth: number
): Line[][] {
  if (depth >= 2) return [lines]; // two splits max → up to 4 columns
  if (lines.length < 8) return [lines];
  const regionWidth = regionX1 - regionX0;
  // Both halves must clear the minimum column width (0.18 × page).
  if (regionWidth < pageWidth * 0.36) return [lines];

  const chunks = lines.flatMap((line) => line.chunks);
  if (chunks.length < 8) return [lines];

  const minColumn = pageWidth * 0.18;
  const samples = 48;
  let bestX = -1;
  let bestCrossings = Number.POSITIVE_INFINITY;

  for (let step = 0; step <= samples; step += 1) {
    const x = regionX0 + regionWidth * (0.3 + (0.4 * step) / samples);
    if (x - regionX0 < minColumn || regionX1 - x < minColumn) continue;
    let crossings = 0;
    let left = 0;
    let right = 0;
    for (const chunk of chunks) {
      if (chunk.x0 < x - 2 && chunk.x1 > x + 2) crossings += 1;
      else if (chunk.x1 <= x) left += 1;
      else right += 1;
    }
    const balanced = left >= chunks.length * 0.28 && right >= chunks.length * 0.28;
    if (balanced && crossings < bestCrossings) {
      bestCrossings = crossings;
      bestX = x;
    }
  }

  if (bestX < 0 || bestCrossings > chunks.length * 0.08) return [lines];

  // A page dominated by a wide table also exposes low-crossing gutters. Two
  // tells separate real column layouts from tables, applied PER SIDE of the
  // candidate gutter (a doc-wide "≥3 left margins" test would veto genuine
  // 3+-column pages, whose margins are legitimate column starts): a side
  // massing chunk starts at 3+ margins is a table, and both sides must hold
  // prose-length runs rather than clipped cells. Two strong clusters on a
  // side are legal — that side may itself be two columns; recursion decides.
  const tolerance = Math.max(pageWidth * 0.015, 8);
  const strongClustersOn = (side: (chunk: Chunk) => boolean): number => {
    const starts = chunks.filter(side).map((chunk) => chunk.x0).sort((a, b) => a - b);
    const clusters: { x: number; count: number }[] = [];
    for (const x of starts) {
      const cluster = clusters[clusters.length - 1];
      if (cluster && x - cluster.x <= tolerance) {
        cluster.x = (cluster.x * cluster.count + x) / (cluster.count + 1);
        cluster.count += 1;
      } else {
        clusters.push({ x, count: 1 });
      }
    }
    return clusters.filter((cluster) => cluster.count >= Math.max(3, lines.length * 0.15)).length;
  };
  if (strongClustersOn((chunk) => chunk.x1 <= bestX) >= 3) return [lines];
  if (strongClustersOn((chunk) => chunk.x0 >= bestX) >= 3) return [lines];

  const sideLengths = (side: (chunk: Chunk) => boolean): number => {
    const lengths = chunks.filter(side).map((chunk) => chunk.text.length).sort((a, b) => a - b);
    return lengths.length ? lengths[Math.floor(lengths.length / 2)] : 0;
  };
  const leftMedian = sideLengths((chunk) => chunk.x1 <= bestX);
  const rightMedian = sideLengths((chunk) => chunk.x0 >= bestX);
  if (leftMedian < 25 || rightMedian < 25) return [lines];

  const left: Line[] = [];
  const right: Line[] = [];
  const full: Line[] = [];
  for (const line of lines) {
    if (line.chunks.some((chunk) => chunk.x0 < bestX - 2 && chunk.x1 > bestX + 2)) {
      full.push(line);
      continue;
    }
    const leftChunks = line.chunks.filter((chunk) => chunk.x1 <= bestX);
    const rightChunks = line.chunks.filter((chunk) => chunk.x1 > bestX);
    if (leftChunks.length && rightChunks.length) {
      left.push(lineFromChunks(line, leftChunks));
      right.push(lineFromChunks(line, rightChunks));
    } else if (leftChunks.length) {
      left.push(line);
    } else {
      right.push(line);
    }
  }

  // Spanning lines (headlines, abstracts) read first, then each column
  // subtree left to right — each half may split again (3rd/4th column).
  const regions = [
    ...(full.length ? [full] : []),
    ...splitRegion(left, regionX0, bestX, pageWidth, depth + 1),
    ...splitRegion(right, bestX, regionX1, pageWidth, depth + 1)
  ].filter((region) => region.length > 0);
  return regions.length > 1 ? regions : [lines];
}

function lineFromChunks(line: Line, chunks: Chunk[]): Line {
  return {
    ...line,
    x0: chunks[0].x0,
    x1: chunks[chunks.length - 1].x1,
    text: chunks.map((chunk) => chunk.text).join(" "),
    chunks
  };
}

/* ------------------------------------------------------------------ */
/* Document metrics                                                    */
/* ------------------------------------------------------------------ */

export function findBodySize(lines: Line[]): number {
  // Weigh only single-chunk lines: in table-heavy documents the (often
  // smaller) table face would otherwise win and body prose would read as
  // oversized "headings".
  const prose = lines.filter((line) => line.chunks.length === 1);
  const sample = prose.length >= lines.length * 0.2 ? prose : lines;
  const weights = new Map<number, number>();
  for (const line of sample) {
    const key = Math.round(line.size * 2) / 2;
    weights.set(key, (weights.get(key) || 0) + line.text.length);
  }
  let best = 10;
  let bestWeight = -1;
  for (const [size, weight] of weights) {
    if (weight > bestWeight) {
      best = size;
      bestWeight = weight;
    }
  }
  return best;
}

function medianLineGap(lines: Line[], bodySize: number): number {
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const gap = lines[i - 1].y - lines[i].y;
    if (gap > 0.5 && gap < bodySize * 3) gaps.push(gap);
  }
  if (!gaps.length) return bodySize * 1.25;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

function dominantLeftMargin(lines: Line[]): number {
  const weights = new Map<number, number>();
  for (const line of lines) {
    const key = Math.round(line.x0 / 2) * 2;
    weights.set(key, (weights.get(key) || 0) + 1);
  }
  let best = lines[0]?.x0 || 0;
  let bestWeight = -1;
  for (const [x, weight] of weights) {
    if (weight > bestWeight) {
      best = x;
      bestWeight = weight;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Embedded figures                                                    */
/* ------------------------------------------------------------------ */

/**
 * Where an image lands on its page, in two coordinate spaces: PDF user space
 * (y-up, shared with Line.y — used for caption matching and reading order)
 * and scale-1 viewport space (y-down — scales linearly with render scale, so
 * crop rects are just multiplied). Images paint the CTM-mapped unit square.
 */
interface ImagePlacement {
  objId: string | null;
  ux0: number;
  ux1: number;
  /** User-space bottom edge (min y). */
  uy0: number;
  /** User-space top edge (max y). */
  uy1: number;
  dx0: number;
  dy0: number;
  dx1: number;
  dy1: number;
}

/** A figure that survived filtering, positioned for caption/order passes. */
interface PageFigure {
  key: string;
  page: number;
  ux0: number;
  ux1: number;
  uy0: number;
  uy1: number;
  width: number;
  height: number;
  caption?: string;
}

interface RegionFigure {
  /** Flush the figure block before this line index of its region. */
  insertBefore: number;
  block: PdfBlock;
}

const UNIT_CORNERS: [number, number][] = [[0, 0], [1, 0], [0, 1], [1, 1]];
const FIGURE_MAX_EDGE = 1600;
const FIGURE_BYTE_BUDGET = 40 * 1024 * 1024;
const FIGURE_COUNT_BUDGET = 250;

/**
 * Walk the page's operator list with a minimal graphics-state interpreter —
 * save/restore/transform plus form-XObject nesting — to recover the CTM at
 * every raster image paint. Deliberately ignored: image masks (decorative
 * stencils painted in the fill colour), repeated placements (tiling by
 * construction), transparency groups (wrapped in their own save/restore, so
 * the CTM stays balanced).
 */
async function collectImagePlacements(
  page: PDFPageProxy,
  viewport: { transform: number[]; width: number; height: number }
): Promise<ImagePlacement[]> {
  let opList: { fnArray: number[]; argsArray: unknown[] };
  try {
    opList = await page.getOperatorList();
  } catch {
    return [];
  }

  const placements: ImagePlacement[] = [];
  let ctm: number[] = [1, 0, 0, 1, 0, 0];
  const stack: number[][] = [];

  for (let i = 0; i < opList.fnArray.length; i += 1) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i] as unknown[] | null;
    switch (fn) {
      case OPS.save:
        stack.push(ctm);
        break;
      case OPS.restore:
        ctm = stack.pop() ?? ctm;
        break;
      case OPS.transform:
        ctm = Util.transform(ctm, args as number[]);
        break;
      case OPS.paintFormXObjectBegin:
        // pdf.js emits this as an implicit save + matrix concat.
        stack.push(ctm);
        if (Array.isArray(args?.[0])) ctm = Util.transform(ctm, args[0] as number[]);
        break;
      case OPS.paintFormXObjectEnd:
        ctm = stack.pop() ?? ctm;
        break;
      case OPS.paintImageXObject:
        placements.push(placeUnitSquare(typeof args?.[0] === "string" ? args[0] : null, ctm, viewport));
        break;
      case OPS.paintInlineImageXObject:
        placements.push(placeUnitSquare(null, ctm, viewport));
        break;
      default:
        break;
    }
  }
  return placements;
}

function placeUnitSquare(
  objId: string | null,
  ctm: number[],
  viewport: { transform: number[] }
): ImagePlacement {
  const device = Util.transform(viewport.transform, ctm);
  const user = UNIT_CORNERS.map((p) => Util.applyTransform([p[0], p[1]], ctm));
  const dev = UNIT_CORNERS.map((p) => Util.applyTransform([p[0], p[1]], device));
  return {
    objId,
    ux0: Math.min(...user.map((p) => p[0])),
    ux1: Math.max(...user.map((p) => p[0])),
    uy0: Math.min(...user.map((p) => p[1])),
    uy1: Math.max(...user.map((p) => p[1])),
    dx0: Math.min(...dev.map((p) => p[0])),
    dy0: Math.min(...dev.map((p) => p[1])),
    dx1: Math.max(...dev.map((p) => p[0])),
    dy1: Math.max(...dev.map((p) => p[1]))
  };
}

/**
 * Filter placements down to real figures, render their pages once each, crop
 * and encode the survivors, and dedup repeated artwork (logos, watermarks).
 */
async function harvestFigures(
  doc: PDFDocumentProxy,
  pagePlacements: ImagePlacement[][],
  geometries: PageGeometry[],
  warnings: string[]
): Promise<{ figures: ExtractedFigure[]; pageFigures: Map<number, PageFigure[]> }> {
  const pageCount = pagePlacements.length;

  // Shared XObjects reused across pages resolve to the same object id — an
  // id showing up on 3+ pages is chrome (logo, watermark), not content.
  const objIdPages = new Map<string, Set<number>>();
  pagePlacements.forEach((placements, pageIndex) => {
    for (const placement of placements) {
      if (!placement.objId) continue;
      let pages = objIdPages.get(placement.objId);
      if (!pages) objIdPages.set(placement.objId, (pages = new Set()));
      pages.add(pageIndex);
    }
  });
  // "Repeated" needs a floor of 3 pages — a bare percentage would call every
  // image in a short document a logo.
  const repeatThreshold = Math.max(3, Math.ceil(pageCount * 0.3));
  const repeatedIds = new Set(
    [...objIdPages.entries()]
      .filter(([, pages]) => pages.size >= repeatThreshold)
      .map(([objId]) => objId)
  );

  const kept: { placement: ImagePlacement; pageIndex: number }[] = [];
  pagePlacements.forEach((placements, pageIndex) => {
    const geometry = geometries[pageIndex];
    const pageArea = geometry.width * geometry.height;
    const candidates = placements
      .map((placement) => clampPlacement(placement, geometry))
      .filter((placement): placement is ImagePlacement => {
        if (!placement) return false;
        if (placement.objId && repeatedIds.has(placement.objId)) return false;
        const w = placement.dx1 - placement.dx0;
        const h = placement.dy1 - placement.dy0;
        const area = w * h;
        if (Math.min(w, h) < 32) return false;
        if (area < pageArea * 0.015) return false;
        if (area > pageArea * 0.85) return false;
        return true;
      })
      .sort((a, b) => area(b) - area(a))
      .slice(0, 4);
    for (const placement of candidates) kept.push({ placement, pageIndex });
  });

  const figures: ExtractedFigure[] = [];
  const pageFigures = new Map<number, PageFigure[]>();
  const hashed: { hash: string; page: number; figureIndex: number }[] = [];
  let totalBytes = 0;
  let skipped = false;

  const byPage = new Map<number, ImagePlacement[]>();
  for (const { placement, pageIndex } of kept) {
    const list = byPage.get(pageIndex);
    if (list) list.push(placement);
    else byPage.set(pageIndex, [placement]);
  }

  for (const [pageIndex, placements] of byPage) {
    if (skipped) break;
    let pageCanvas: HTMLCanvasElement | null = null;
    let scale = 1;
    try {
      const page = await doc.getPage(pageIndex + 1);
      const geometry = geometries[pageIndex];
      const largestEdge = Math.max(...placements.map((p) => Math.max(p.dx1 - p.dx0, p.dy1 - p.dy0)));
      scale = Math.min(
        Math.max(1, FIGURE_MAX_EDGE / Math.max(largestEdge, 1)),
        2.5,
        4096 / Math.max(geometry.width, geometry.height)
      );
      const viewport = page.getViewport({ scale });
      pageCanvas = document.createElement("canvas");
      pageCanvas.width = Math.round(viewport.width);
      pageCanvas.height = Math.round(viewport.height);
      const context = pageCanvas.getContext("2d");
      if (!context) continue;
      await page.render({ canvasContext: context, viewport }).promise;
      page.cleanup();
    } catch {
      continue;
    }

    let n = 0;
    for (const placement of placements) {
      if (figures.length >= FIGURE_COUNT_BUDGET || totalBytes >= FIGURE_BYTE_BUDGET) {
        skipped = true;
        break;
      }
      const sx = placement.dx0 * scale;
      const sy = placement.dy0 * scale;
      const sw = (placement.dx1 - placement.dx0) * scale;
      const sh = (placement.dy1 - placement.dy0) * scale;
      const shrink = Math.min(1, FIGURE_MAX_EDGE / Math.max(sw, sh));
      const dw = Math.max(1, Math.round(sw * shrink));
      const dh = Math.max(1, Math.round(sh * shrink));

      const crop = document.createElement("canvas");
      crop.width = dw;
      crop.height = dh;
      const cropContext = crop.getContext("2d");
      if (!cropContext) continue;
      cropContext.drawImage(pageCanvas, sx, sy, sw, sh, 0, 0, dw, dh);

      const blob = await canvasToBlob(crop, 0.85);
      if (!blob) continue;
      totalBytes += blob.size;

      const key = `fig:${pageIndex}:${n}`;
      n += 1;
      hashed.push({ hash: averageHash(cropContext, dw, dh), page: pageIndex, figureIndex: figures.length });
      figures.push({ key, page: pageIndex, blob, width: dw, height: dh });

      const list = pageFigures.get(pageIndex) || [];
      list.push({
        key,
        page: pageIndex,
        ux0: placement.ux0,
        ux1: placement.ux1,
        uy0: placement.uy0,
        uy1: placement.uy1,
        width: dw,
        height: dh
      });
      pageFigures.set(pageIndex, list);
    }
    pageCanvas.width = 0;
    pageCanvas.height = 0;
  }

  // Tier-2 dedup: visually identical crops on 3+ pages are decorations that
  // slipped past objId sharing (regenerated per page by some producers).
  const hashPages = new Map<string, Set<number>>();
  for (const entry of hashed) {
    let pages = hashPages.get(entry.hash);
    if (!pages) hashPages.set(entry.hash, (pages = new Set()));
    pages.add(entry.page);
  }
  const dropKeys = new Set<string>();
  for (const entry of hashed) {
    if ((hashPages.get(entry.hash)?.size ?? 0) >= 3) dropKeys.add(figures[entry.figureIndex].key);
  }
  const keptFigures = figures.filter((figure) => !dropKeys.has(figure.key));
  if (dropKeys.size) {
    for (const [pageIndex, list] of pageFigures) {
      pageFigures.set(pageIndex, list.filter((figure) => !dropKeys.has(figure.key)));
    }
  }

  if (skipped) {
    warnings.push("Some figures were skipped to keep this book compact.");
  }
  return { figures: keptFigures, pageFigures };
}

function clampPlacement(placement: ImagePlacement, geometry: PageGeometry): ImagePlacement | null {
  const rawArea = area(placement);
  if (rawArea <= 0) return null;
  const clamped: ImagePlacement = {
    ...placement,
    dx0: Math.max(0, placement.dx0),
    dy0: Math.max(0, placement.dy0),
    dx1: Math.min(geometry.width, placement.dx1),
    dy1: Math.min(geometry.height, placement.dy1)
  };
  if (clamped.dx1 <= clamped.dx0 || clamped.dy1 <= clamped.dy0) return null;
  // Mostly off-page placements are bleed art, not content.
  if (area(clamped) < rawArea * 0.6) return null;
  return clamped;
}

function area(placement: ImagePlacement): number {
  return Math.max(0, placement.dx1 - placement.dx0) * Math.max(0, placement.dy1 - placement.dy0);
}

/** 256-bit mean-threshold hash of the crop, for cross-page duplicate detection. */
function averageHash(context: CanvasRenderingContext2D, width: number, height: number): string {
  const tiny = document.createElement("canvas");
  tiny.width = 16;
  tiny.height = 16;
  const tinyContext = tiny.getContext("2d");
  if (!tinyContext) return Math.random().toString(36);
  tinyContext.drawImage(context.canvas, 0, 0, width, height, 0, 0, 16, 16);
  const data = tinyContext.getImageData(0, 0, 16, 16).data;
  const gray: number[] = [];
  for (let i = 0; i < data.length; i += 4) {
    gray.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
  }
  const mean = gray.reduce((sum, value) => sum + value, 0) / gray.length;
  let hash = "";
  for (let i = 0; i < gray.length; i += 4) {
    let nibble = 0;
    for (let bit = 0; bit < 4; bit += 1) {
      nibble = (nibble << 1) | (gray[i + bit] > mean ? 1 : 0);
    }
    hash += nibble.toString(16);
  }
  return hash;
}

const CAPTION_PATTERN = /^(fig(ure)?\.?|plate|chart|exhibit|illustration)\s*\d/i;

/**
 * Pair figures with nearby caption lines (small type or "Figure N …" starts,
 * directly below — or above as a fallback — and horizontally aligned).
 * Consumed lines leave the text flow so they don't double as paragraphs.
 */
function detectCaptions(
  pageLines: Line[][],
  pageFigures: Map<number, PageFigure[]>,
  bodySize: number
): void {
  for (const [pageIndex, figuresOnPage] of pageFigures) {
    let lines = pageLines[pageIndex];
    for (const figure of figuresOnPage) {
      const figWidth = figure.ux1 - figure.ux0;
      const overlaps = (line: Line) =>
        Math.min(line.x1, figure.ux1) - Math.max(line.x0, figure.ux0) >= figWidth * 0.5;
      const looksCaption = (line: Line) =>
        CAPTION_PATTERN.test(line.text) || line.size <= bodySize * 0.92;

      let start = -1;
      let below = true;
      let bestGap = Number.POSITIVE_INFINITY;
      lines.forEach((line, index) => {
        if (!overlaps(line) || !looksCaption(line)) return;
        const gapBelow = figure.uy0 - line.y;
        if (gapBelow > 0 && gapBelow <= bodySize * 2.5 + line.size && gapBelow < bestGap) {
          start = index;
          below = true;
          bestGap = gapBelow;
        }
      });
      if (start < 0) {
        lines.forEach((line, index) => {
          if (!overlaps(line) || !looksCaption(line)) return;
          const gapAbove = line.y - figure.uy1;
          if (gapAbove > 0 && gapAbove <= bodySize * 2.5 && gapAbove < bestGap) {
            start = index;
            below = false;
            bestGap = gapAbove;
          }
        });
      }
      if (start < 0) continue;

      const first = lines[start];
      const captionLines = [first];
      let end = start + 1;
      let totalLength = first.text.length;
      while (
        end < lines.length &&
        captionLines.length < 3 &&
        Math.abs(lines[end].size - first.size) < 0.6 &&
        lines[end - 1].y - lines[end].y < first.size * 1.6 &&
        totalLength + lines[end].text.length <= 300 &&
        (below || lines[end].y > figure.uy1)
      ) {
        captionLines.push(lines[end]);
        totalLength += lines[end].text.length;
        end += 1;
      }

      figure.caption = captionLines
        .map((line) => line.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      lines = lines.filter((_, index) => index < start || index >= end);
    }
    pageLines[pageIndex] = lines;
  }
}

/**
 * Slot each figure into the column region it visually belongs to, precomputing
 * the line index it should flush before. Figures spanning multiple columns
 * (or matching none) read first, like spanning headlines.
 */
function assignFiguresToRegions(
  regions: Line[][],
  figuresOnPage: PageFigure[],
  bodySize: number
): { perRegion: RegionFigure[][]; leading: PdfBlock[] } {
  const perRegion: RegionFigure[][] = regions.map(() => []);
  const leading: PdfBlock[] = [];

  for (const figure of figuresOnPage) {
    const block: PdfBlock = {
      block: {
        kind: "figure",
        text: figure.caption || `[Figure — page ${figure.page + 1}]`,
        imageId: figure.key,
        width: figure.width,
        height: figure.height,
        ...(figure.caption ? { caption: figure.caption } : {})
      },
      page: figure.page,
      size: bodySize
    };

    if (regions.length === 1) {
      perRegion[0].push({ insertBefore: insertionIndex(regions[0], figure), block });
      continue;
    }

    const figWidth = figure.ux1 - figure.ux0;
    const matching: number[] = [];
    regions.forEach((region, index) => {
      if (!region.length) return;
      const rx0 = Math.min(...region.map((line) => line.x0));
      const rx1 = Math.max(...region.map((line) => line.x1));
      const overlap = Math.min(rx1, figure.ux1) - Math.max(rx0, figure.ux0);
      if (overlap >= figWidth * 0.4) matching.push(index);
    });

    if (matching.length === 1) {
      const index = matching[0];
      perRegion[index].push({ insertBefore: insertionIndex(regions[index], figure), block });
    } else {
      leading.push(block);
    }
  }

  for (const list of perRegion) list.sort((a, b) => a.insertBefore - b.insertBefore);
  return { perRegion, leading };
}

/** First line of the region that sits below the figure (lines are y-descending). */
function insertionIndex(region: Line[], figure: PageFigure): number {
  for (let index = 0; index < region.length; index += 1) {
    if (region[index].y < figure.uy0) return index;
  }
  return region.length;
}

/* ------------------------------------------------------------------ */
/* Lines → blocks                                                      */
/* ------------------------------------------------------------------ */

const TERMINAL_PUNCTUATION = /[.!?:;'"’”)\]]$/;
const LIST_MARKER = /^([•▪◦‣∙·*]|\(?\d{1,3}[.)]|\(?[a-z][.)])\s+(\S.*)$/i;

export function buildBlocks(lines: Line[], bodySize: number, figures: RegionFigure[] = []): PdfBlock[] {
  if (!lines.length) return figures.map((figure) => figure.block);
  const gap = medianLineGap(lines, bodySize);
  const margin = dominantLeftMargin(lines);
  const rightEdge = Math.max(...lines.map((line) => line.x1));
  const blocks: PdfBlock[] = [];

  // Figures flush at block boundaries once the scan reaches their position —
  // they sit between paragraphs vertically, never inside a line run.
  let figureCursor = 0;
  const flushFigures = (uptoLine: number) => {
    while (figureCursor < figures.length && figures[figureCursor].insertBefore <= uptoLine) {
      blocks.push(figures[figureCursor].block);
      figureCursor += 1;
    }
  };

  let index = 0;
  while (index < lines.length) {
    flushFigures(index);
    const table = tryTable(lines, index, bodySize, gap);
    if (table) {
      blocks.push(table.block);
      index = table.nextIndex;
      continue;
    }

    const line = lines[index];

    if (line.mono) {
      const codeLines: string[] = [];
      let cursor = index;
      while (cursor < lines.length && lines[cursor].mono) {
        codeLines.push(lines[cursor].text);
        cursor += 1;
      }
      blocks.push({ block: { kind: "code", text: codeLines.join("\n") }, page: line.page, size: line.size });
      index = cursor;
      continue;
    }

    if (isHeadingLine(line, bodySize)) {
      // Consecutive same-size heading lines are one wrapped title.
      let cursor = index + 1;
      let text = line.text;
      while (
        cursor < lines.length &&
        isHeadingLine(lines[cursor], bodySize) &&
        Math.abs(lines[cursor].size - line.size) < 0.6 &&
        line.y - lines[cursor].y < line.size * 2.6 * (cursor - index)
      ) {
        text += ` ${lines[cursor].text}`;
        cursor += 1;
      }
      blocks.push({ block: { kind: "heading", text, level: 2 }, page: line.page, size: line.size });
      index = cursor;
      continue;
    }

    const listMatch = line.text.match(LIST_MARKER);
    if (listMatch) {
      let text = listMatch[2];
      let cursor = index + 1;
      while (
        cursor < lines.length &&
        !lines[cursor].mono &&
        !LIST_MARKER.test(lines[cursor].text) &&
        !isHeadingLine(lines[cursor], bodySize) &&
        lines[cursor].x0 > margin + bodySize * 0.4 &&
        lines[cursor - 1].y - lines[cursor].y < gap * 1.45 &&
        lines[cursor].chunks.length < 2
      ) {
        text = joinWrapped(text, lines[cursor].text);
        cursor += 1;
      }
      blocks.push({
        block: { kind: "list-item", text, marker: normalizeMarker(listMatch[1]) },
        page: line.page,
        size: line.size
      });
      index = cursor;
      continue;
    }

    // Paragraph: accumulate until a break signal.
    let text = line.text;
    let cursor = index + 1;
    while (cursor < lines.length) {
      const prev = lines[cursor - 1];
      const next = lines[cursor];
      if (next.mono || isHeadingLine(next, bodySize) || LIST_MARKER.test(next.text)) break;
      if (tableStartsAt(lines, cursor, bodySize, gap)) break;
      if (prev.y - next.y > gap * 1.5) break;
      if (Math.abs(next.size - prev.size) > 1.2) break;
      // First-line indent on the next line means this paragraph is done.
      if (next.x0 - margin > bodySize * 0.85 && prev.x0 - margin < bodySize * 0.4) break;
      // A visibly short line ending a sentence closes the paragraph.
      if (prev.x1 < rightEdge - bodySize * 3 && TERMINAL_PUNCTUATION.test(prev.text)) break;
      text = joinWrapped(text, next.text);
      cursor += 1;
    }
    blocks.push({ block: { kind: "paragraph", text }, page: line.page, size: line.size });
    index = cursor;
  }

  flushFigures(lines.length);
  return blocks;
}

function joinWrapped(text: string, next: string): string {
  if (/[a-zA-Z]{2}-$/.test(text) && /^[a-z]/.test(next)) return text.slice(0, -1) + next;
  return `${text} ${next}`;
}

function normalizeMarker(raw: string): string {
  const marker = raw.trim();
  if (/^[•▪◦‣∙·*]$/.test(marker)) return "•";
  return marker.replace(/^\(/, "");
}

function isHeadingLine(line: Line, bodySize: number): boolean {
  const text = line.text;
  if (text.length > 110 || line.chunks.length >= 3) return false;
  // Headings don't start lowercase — that's a wrapped sentence fragment.
  if (/^[a-z]/.test(text)) return false;
  if (/[.,;]$/.test(text) && line.size < bodySize * 1.3) return false;
  if (line.size >= bodySize * 1.16) return true;
  const letters = text.replace(/[^a-z]/gi, "");
  if (
    letters.length >= 4 &&
    text.length <= 72 &&
    letters === letters.toUpperCase() &&
    line.size >= bodySize * 0.95
  ) {
    return true;
  }
  // Numbered headings ("3.2 Results") must be visibly larger than body text,
  // or TOC lines and numbered list items masquerade as headings.
  return /^\d+(\.\d+)*\.?\s+\S/.test(text) && line.size >= bodySize * 1.12 && text.length <= 90;
}

/* ------------------------------------------------------------------ */
/* Tables                                                              */
/* ------------------------------------------------------------------ */

interface TableScan {
  block: PdfBlock;
  nextIndex: number;
}

function tableStartsAt(lines: Line[], index: number, bodySize: number, gap: number): boolean {
  return (
    lines[index].chunks.length >= 2 &&
    index + 1 < lines.length &&
    (lines[index + 1].chunks.length >= 2 || (index + 2 < lines.length && lines[index + 2].chunks.length >= 2))
  );
}

/**
 * Try to read a table starting at `index`: a run of lines whose chunk starts
 * cluster into 2+ stable columns. Returns null when the shape isn't table-like
 * (so the caller falls back to paragraph flow).
 */
function tryTable(lines: Line[], index: number, bodySize: number, gap: number): TableScan | null {
  if (!tableStartsAt(lines, index, bodySize, gap)) return null;

  // Collect the run: tabular lines plus single-chunk continuations of
  // wrapped cells. A plain line belongs to the table when it starts at a
  // known column position — cells can wrap over many lines, so alignment,
  // not a fixed lookahead, decides membership. Lines aligned with the FIRST
  // column are ambiguous (any paragraph starts there), so they only count
  // when more tabular lines follow shortly.
  const columnTolerance = Math.max(bodySize * 0.9, 7);
  const columnStarts: number[] = [];
  const noteColumns = (line: Line) => {
    for (const chunk of line.chunks) {
      if (!columnStarts.some((x) => Math.abs(x - chunk.x0) <= columnTolerance)) {
        columnStarts.push(chunk.x0);
      }
    }
  };

  let end = index;
  let lastAnchored = index - 1;
  const runLimitGap = gap * 2.6;
  while (end < lines.length) {
    const line = lines[end];
    if (end > index && lines[end - 1].y - line.y > runLimitGap) break;
    if (line.mono || isHeadingLine(line, bodySize)) break;
    if (line.chunks.length >= 2) {
      noteColumns(line);
      lastAnchored = end;
      end += 1;
      continue;
    }
    const x0 = line.chunks[0]?.x0 ?? line.x0;
    const firstColumn = Math.min(...columnStarts);
    const alignsColumn = columnStarts.some((x) => Math.abs(x - x0) <= columnTolerance);
    const alignsLater = alignsColumn && x0 > firstColumn + columnTolerance;
    if (alignsLater) {
      // Continuation of a non-first cell — always part of the table.
      lastAnchored = end;
      end += 1;
      continue;
    }
    if (
      alignsColumn &&
      ((end + 1 < lines.length && lines[end + 1].chunks.length >= 2) ||
        (end + 2 < lines.length && lines[end + 2].chunks.length >= 2))
    ) {
      end += 1;
      continue;
    }
    break;
  }
  end = lastAnchored + 1;

  const run = lines.slice(index, end);
  const tabular = run.filter((line) => line.chunks.length >= 2);
  if (tabular.length < 2) return null;

  const columns = clusterColumns(run, bodySize);
  if (columns.length < 2) return null;

  // Guard against justified prose that happened to split once: real table
  // cells are short and the column pattern repeats.
  const cellLengths = tabular.flatMap((line) => line.chunks.map((chunk) => chunk.text.length));
  cellLengths.sort((a, b) => a - b);
  const medianCell = cellLengths[Math.floor(cellLengths.length / 2)] || 0;
  if (columns.length === 2 && (tabular.length < 3 || medianCell > 60)) return null;

  const rows = buildRows(run, columns);
  if (rows.length < 2) return null;

  const cells = rows.map((row) => row.map((cell) => cell.replace(/\s+/g, " ").trim()));
  return {
    block: {
      block: { kind: "table", text: flattenTable(cells), rows: cells, headerRow: looksLikeHeaderRow(cells) },
      page: run[0].page,
      size: run[0].size
    },
    nextIndex: end
  };
}

function clusterColumns(run: Line[], bodySize: number): number[] {
  const starts = run
    .flatMap((line) => line.chunks.map((chunk) => chunk.x0))
    .sort((a, b) => a - b);
  const tolerance = Math.max(bodySize * 0.9, 7);
  const clusters: { x: number; count: number }[] = [];
  for (const x of starts) {
    const cluster = clusters[clusters.length - 1];
    if (cluster && x - cluster.x <= tolerance) {
      cluster.x = (cluster.x * cluster.count + x) / (cluster.count + 1);
      cluster.count += 1;
    } else {
      clusters.push({ x, count: 1 });
    }
  }
  return clusters.filter((cluster) => cluster.count >= 2).map((cluster) => cluster.x);
}

function buildRows(run: Line[], columns: number[]): string[][] {
  const columnOf = (x0: number): number => {
    let best = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    columns.forEach((column, columnIndex) => {
      const distance = Math.abs(x0 - column);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = columnIndex;
      }
    });
    return best;
  };

  // Row boundaries: when line spacing inside the run is bimodal (rows have
  // padding, wrapped cell lines sit tight), the larger gaps mark rows and the
  // first-column rule must be ignored — a row where every cell wraps puts
  // text in column 0 on continuation lines too. With uniform spacing there is
  // no wrapping signal, so a busy first column starts a new row.
  const gaps: number[] = [];
  for (let i = 1; i < run.length; i += 1) {
    const g = run[i - 1].y - run[i].y;
    if (g > 0.5) gaps.push(g);
  }
  gaps.sort((a, b) => a - b);
  let gapThreshold = Number.POSITIVE_INFINITY;
  let bestJump = 1.35;
  for (let i = 1; i < gaps.length; i += 1) {
    const jump = gaps[i] / gaps[i - 1];
    if (jump > bestJump) {
      bestJump = jump;
      gapThreshold = (gaps[i - 1] + gaps[i]) / 2;
    }
  }
  const useGaps = Number.isFinite(gapThreshold);

  const rows: string[][] = [];
  let current: string[] | null = null;

  for (let i = 0; i < run.length; i += 1) {
    const line = run[i];
    const lineGap = i > 0 ? run[i - 1].y - line.y : 0;
    const hasFirstColumn = line.chunks.some((chunk) => columnOf(chunk.x0) === 0);
    const firstColumnBusy = current !== null && current[0] !== "";
    const breaks = useGaps ? lineGap > gapThreshold : hasFirstColumn && firstColumnBusy;

    if (!current || breaks) {
      current = columns.map(() => "");
      rows.push(current);
    }

    for (const chunk of line.chunks) {
      const column = columnOf(chunk.x0);
      current[column] = current[column] ? joinWrapped(current[column], chunk.text) : chunk.text;
    }
  }

  // A row holding only first-column text that starts lowercase is a wrapped
  // cell from the row above, not a real row.
  const merged: string[][] = [];
  for (const row of rows) {
    const onlyFirst = row[0] && row.slice(1).every((cell) => !cell);
    const previous = merged[merged.length - 1];
    if (onlyFirst && previous && /^[a-z]/.test(row[0]) && previous.slice(1).some(Boolean)) {
      previous[0] = joinWrapped(previous[0], row[0]);
      continue;
    }
    merged.push(row);
  }
  return merged.filter((row) => row.some((cell) => cell.trim()));
}

function looksLikeHeaderRow(rows: string[][]): boolean {
  if (rows.length < 2) return false;
  const header = rows[0];
  const filled = header.filter(Boolean);
  if (filled.length < 2) return false;
  const avg = filled.reduce((sum, cell) => sum + cell.length, 0) / filled.length;
  return avg <= 32 && filled.every((cell) => !/[.!?]$/.test(cell));
}

/* ------------------------------------------------------------------ */
/* Block post-processing                                               */
/* ------------------------------------------------------------------ */

/** Append page blocks, stitching paragraphs and tables that flow across the boundary. */
function appendBlocks(target: PdfBlock[], incoming: PdfBlock[]): void {
  if (!incoming.length) {
    return;
  }
  const last = target[target.length - 1];
  const first = incoming[0];

  if (
    last &&
    last.block.kind === "paragraph" &&
    first.block.kind === "paragraph" &&
    last.block.text.length > 40 &&
    (!TERMINAL_PUNCTUATION.test(last.block.text) || /^[a-z]/.test(first.block.text)) &&
    Math.abs(last.size - first.size) < 1.2
  ) {
    last.block.text = joinWrapped(last.block.text, first.block.text);
    target.push(...incoming.slice(1));
    return;
  }

  // A table continuing on the next page keeps its column count; some
  // generators repeat the header row — drop the duplicate.
  if (
    last &&
    last.block.kind === "table" &&
    first.block.kind === "table" &&
    last.block.rows[0]?.length === first.block.rows[0]?.length
  ) {
    let extraRows = first.block.rows;
    if (last.block.headerRow && sameRow(extraRows[0], last.block.rows[0])) {
      extraRows = extraRows.slice(1);
    }
    if (extraRows.length) {
      last.block.rows = [...last.block.rows, ...extraRows];
      last.block.text = flattenTable(last.block.rows);
    }
    target.push(...incoming.slice(1));
    return;
  }

  target.push(...incoming);
}

function sameRow(a: string[] | undefined, b: string[] | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false;
  return a.every((cell, i) => cell.toLowerCase() === b[i].toLowerCase());
}

export function flattenTable(rows: string[][]): string {
  return rows.map((row) => row.filter(Boolean).join(" · ")).join("\n");
}

/** Map raw heading sizes onto levels 1..3 across the whole document. */
function assignHeadingLevels(blocks: PdfBlock[], bodySize: number): void {
  const sizes = Array.from(
    new Set(
      blocks
        .filter((entry) => entry.block.kind === "heading")
        .map((entry) => Math.round(entry.size * 2) / 2)
    )
  ).sort((a, b) => b - a);

  for (const entry of blocks) {
    if (entry.block.kind !== "heading") continue;
    const tier = sizes.indexOf(Math.round(entry.size * 2) / 2);
    entry.block.level = (Math.min(Math.max(tier, 0), 2) + 1) as 1 | 2 | 3;
    // All-caps body-size headings never outrank truly larger type.
    if (entry.size < bodySize * 1.1 && entry.block.level === 1 && sizes.length > 1) {
      entry.block.level = 2;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Outline                                                             */
/* ------------------------------------------------------------------ */

async function resolveOutline(doc: PDFDocumentProxy): Promise<PdfOutlineEntry[]> {
  try {
    const outline = await doc.getOutline();
    if (!outline?.length) return [];
    const entries: PdfOutlineEntry[] = [];
    for (const item of outline) {
      if (!item.title?.trim()) continue;
      try {
        const dest = typeof item.dest === "string" ? await doc.getDestination(item.dest) : item.dest;
        const ref = dest?.[0];
        if (ref == null) continue;
        const page = await doc.getPageIndex(ref);
        entries.push({ title: item.title.trim(), page });
      } catch {
        /* skip unresolvable destinations */
      }
    }
    entries.sort((a, b) => a.page - b.page);
    return entries;
  } catch {
    return [];
  }
}
