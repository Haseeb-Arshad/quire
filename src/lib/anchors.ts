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
