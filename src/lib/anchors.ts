// Text decoration + selection anchoring utilities for the reflowed reader.
//
// Anchors are paragraph-relative character offsets: extracted paragraph
// strings are immutable, so an anchor stays valid for the life of the book.

export interface Decoration {
  start: number;
  end: number;
  kind: string; // e.g. "search", "search-active", "hl-amber"
  id?: string; // annotation id, when applicable
}

export interface Segment {
  text: string;
  kinds: string[];
  ids: string[];
}

/** Split text into segments so overlapping decorations can nest as <mark>s. */
export function segmentText(text: string, decorations: Decoration[]): Segment[] {
  if (!decorations.length) return [{ text, kinds: [], ids: [] }];

  const points = new Set<number>([0, text.length]);
  for (const decoration of decorations) {
    points.add(clamp(decoration.start, text.length));
    points.add(clamp(decoration.end, text.length));
  }
  const sorted = Array.from(points).sort((a, b) => a - b);

  const segments: Segment[] = [];
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const from = sorted[i];
    const to = sorted[i + 1];
    if (from === to) continue;
    const covering = decorations.filter((d) => d.start <= from && d.end >= to);
    segments.push({
      text: text.slice(from, to),
      kinds: covering.map((d) => d.kind),
      ids: covering.flatMap((d) => (d.id ? [d.id] : []))
    });
  }
  return segments;
}

function clamp(value: number, max: number): number {
  return Math.max(0, Math.min(value, max));
}

export interface SelectionDraft {
  sectionId: string;
  paraIndex: number;
  start: number;
  end: number;
  quote: string;
}

/**
 * Convert the current DOM selection into paragraph-relative drafts, one per
 * paragraph touched. Offsets are computed by measuring Range text length from
 * the paragraph start, which stays correct even when the paragraph is split
 * into multiple <mark> nodes.
 */
export function selectionToDrafts(root: HTMLElement): SelectionDraft[] {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return [];
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return [];

  const drafts: SelectionDraft[] = [];
  const paragraphs = root.querySelectorAll<HTMLElement>("[data-para]");
  paragraphs.forEach((element) => {
    if (!range.intersectsNode(element)) return;
    // Tables render extra DOM (cells, separators are CSS-only), so their
    // textContent no longer matches the stored block text — offsets computed
    // here would corrupt the anchor. Skip them; cells are still copyable.
    if (element.dataset.block === "table") return;
    const sectionId = element.dataset.sectionId;
    const paraIndex = Number(element.dataset.para);
    const text = element.textContent || "";
    if (!sectionId || Number.isNaN(paraIndex) || !text) return;

    let start = 0;
    let end = text.length;
    if (element.contains(range.startContainer)) {
      const lead = document.createRange();
      lead.selectNodeContents(element);
      lead.setEnd(range.startContainer, range.startOffset);
      start = lead.toString().length;
    }
    if (element.contains(range.endContainer)) {
      const lead = document.createRange();
      lead.selectNodeContents(element);
      lead.setEnd(range.endContainer, range.endOffset);
      end = lead.toString().length;
    }
    if (end - start < 1) return;

    drafts.push({ sectionId, paraIndex, start, end, quote: text.slice(start, end) });
  });
  return drafts;
}

/* ------------------------------------------------------------------ */
/* Original-pages view: selection → page-fraction rects                 */
/* ------------------------------------------------------------------ */

export interface PageSelectionDraft {
  /** 1-based page number. */
  page: number;
  /** [x, y, w, h] as fractions of the page box — zoom/resize independent. */
  rects: [number, number, number, number][];
  quote: string;
}

/**
 * Convert the current DOM selection over pdf.js text layers into one draft
 * per page touched. Rects are normalized against each page's canvas wrap so
 * they can be re-projected at any render size.
 */
export function pageSelectionToDrafts(root: HTMLElement): PageSelectionDraft[] {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return [];
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return [];

  const drafts: PageSelectionDraft[] = [];
  const holders = root.querySelectorAll<HTMLElement>("[data-page]");
  holders.forEach((holder) => {
    if (!range.intersectsNode(holder)) return;
    const page = Number(holder.dataset.page);
    const wrap = holder.querySelector<HTMLElement>(".pdf-canvas-wrap");
    const textLayer = holder.querySelector<HTMLElement>(".pdf-text-layer");
    if (!wrap || !textLayer || Number.isNaN(page)) return;

    // Clip the selection to this page's text layer.
    const sub = document.createRange();
    sub.selectNodeContents(textLayer);
    if (textLayer.contains(range.startContainer)) {
      sub.setStart(range.startContainer, range.startOffset);
    }
    if (textLayer.contains(range.endContainer)) {
      sub.setEnd(range.endContainer, range.endOffset);
    }
    const quote = sub.toString().replace(/\s+/g, " ").trim();
    if (!quote) return;

    const box = wrap.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) return;

    const clientRects = Array.from(sub.getClientRects()).filter(
      (rect) => rect.width > 1 && rect.height > 1
    );
    if (!clientRects.length) return;
    // Chrome sometimes emits a rect spanning the whole container — drop rects
    // far taller than the median line height.
    const heights = clientRects.map((rect) => rect.height).sort((a, b) => a - b);
    const medianHeight = heights[Math.floor(heights.length / 2)];
    const lineRects = clientRects.filter((rect) => rect.height <= medianHeight * 1.5);

    const fractions: [number, number, number, number][] = [];
    for (const rect of lineRects) {
      const next: [number, number, number, number] = [
        (rect.left - box.left) / box.width,
        (rect.top - box.top) / box.height,
        rect.width / box.width,
        rect.height / box.height
      ];
      // Merge same-baseline neighbours with sub-0.5%-width gaps.
      const last = fractions[fractions.length - 1];
      if (last && Math.abs(last[1] - next[1]) < 0.004 && next[0] - (last[0] + last[2]) < 0.005) {
        last[2] = next[0] + next[2] - last[0];
        last[3] = Math.max(last[3], next[3]);
      } else {
        fractions.push(next);
      }
    }
    if (!fractions.length) return;

    drafts.push({ page, rects: fractions, quote });
  });
  return drafts;
}
