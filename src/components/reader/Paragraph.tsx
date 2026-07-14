import { memo } from "react";
import type { ContentBlock } from "../../lib/types";
import { segmentText, type Decoration } from "../../lib/anchors";
import { FigureImage } from "./FigureImage";

export const EMPTY_DECORATIONS: Decoration[] = [];

// Renders one content block of a section. Layout-aware sources (PDFs) supply
// a typed block — paragraph, heading, list item, code, table — while older
// books fall back to plain paragraphs with a code-shape heuristic.
//
// Decorations (search marks, highlights) are character offsets into the
// block's canonical text (paragraphs[paraIndex]); every branch here renders
// exactly that text so the offsets line up. Tables are the one exception with
// extra DOM structure, so cell decorations are re-derived from the flattened
// text layout ("cell · cell\n…") and tables opt out of selection anchoring
// via data-block (see anchors.ts).
export const Paragraph = memo(function Paragraph({
  text,
  block,
  sectionId,
  paraIndex,
  decorations
}: {
  text: string;
  block?: ContentBlock;
  sectionId: string;
  paraIndex: number;
  decorations: Decoration[];
}) {
  const anchor = { "data-section-id": sectionId, "data-para": paraIndex };

  if (block?.kind === "table") {
    return <TableBlock block={block} decorations={decorations} anchor={anchor} />;
  }

  const content = renderRuns(text, decorations);

  if (block?.kind === "figure") {
    // The figcaption carries the canonical block text (caption or placeholder)
    // so search marks and highlights anchor exactly; the img contributes no
    // text content, keeping the DOM text equal to paragraphs[paraIndex].
    return (
      <figure className="book-figure" {...anchor}>
        <FigureImage imageId={block.imageId} width={block.width} height={block.height} alt={text} />
        <figcaption className={block.caption ? "figure-caption" : "figure-plate-label"}>
          {content}
        </figcaption>
      </figure>
    );
  }

  if (block?.kind === "heading") {
    if (block.level === 1) return <h3 className="book-h1" {...anchor}>{content}</h3>;
    if (block.level === 2) return <h4 className="book-h2" {...anchor}>{content}</h4>;
    return <h5 className="book-h3" {...anchor}>{content}</h5>;
  }

  if (block?.kind === "list-item") {
    return (
      <p className="book-li" data-marker={block.marker} {...anchor}>
        {content}
      </p>
    );
  }

  if (block?.kind === "quote") {
    return (
      <blockquote className="book-quote" {...anchor}>
        {content}
      </blockquote>
    );
  }

  if (block?.kind === "code" || (!block && looksLikeCode(text))) {
    return (
      <pre className="code-block" {...anchor}>
        {content}
      </pre>
    );
  }

  return (
    <p className="book-para" {...anchor}>
      {content}
    </p>
  );
});

function renderRuns(text: string, decorations: Decoration[]): React.ReactNode {
  if (!decorations.length) return text;
  return segmentText(text, decorations).map((segment, index) =>
    segment.kinds.length ? (
      <mark
        key={index}
        className={segment.kinds.map((kind) => `deco-${kind}`).join(" ")}
        data-annotation-id={segment.ids[0]}
      >
        {segment.text}
      </mark>
    ) : (
      segment.text
    )
  );
}

/* ------------------------------------------------------------------ */
/* Tables                                                              */
/* ------------------------------------------------------------------ */

function TableBlock({
  block,
  decorations,
  anchor
}: {
  block: Extract<ContentBlock, { kind: "table" }>;
  decorations: Decoration[];
  anchor: Record<string, string | number>;
}) {
  // Recreate the flattened-text offsets (non-empty cells joined with " · ",
  // rows joined with "\n") so search/highlight marks land inside the right cell.
  let pos = 0;
  const rows = block.rows.map((row, rowIndex) => {
    if (rowIndex > 0) pos += 1; // "\n"
    let first = true;
    return row.map((cell) => {
      if (!cell) return { cell, decorations: EMPTY_DECORATIONS };
      if (!first) pos += 3; // " · "
      first = false;
      const start = pos;
      pos += cell.length;
      const covering = decorations
        .filter((d) => d.start < start + cell.length && d.end > start)
        .map((d) => ({ ...d, start: Math.max(0, d.start - start), end: Math.min(cell.length, d.end - start) }));
      return { cell, decorations: covering };
    });
  });

  const headerCells = block.headerRow ? rows[0] : null;
  const bodyRows = block.headerRow ? rows.slice(1) : rows;

  return (
    <div className="book-table-wrap" data-block="table" {...anchor}>
      <table className="book-table">
        {headerCells ? (
          <thead>
            <tr>
              {headerCells.map((cell, i) => (
                <th key={i} scope="col">
                  {renderRuns(cell.cell, cell.decorations)}
                </th>
              ))}
            </tr>
          </thead>
        ) : null}
        <tbody>
          {bodyRows.map((row, rowIndex) => {
            // A row whose only content sits in the first cell reads as a
            // full-width spanning row (group header / wrapped remainder).
            const spanning = row.length > 1 && row[0].cell && row.slice(1).every((c) => !c.cell);
            return (
              <tr key={rowIndex}>
                {spanning ? (
                  <td colSpan={row.length} className="book-table-span">
                    {renderRuns(row[0].cell, row[0].decorations)}
                  </td>
                ) : (
                  row.map((cell, cellIndex) => (
                    <td key={cellIndex}>{renderRuns(cell.cell, cell.decorations)}</td>
                  ))
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function looksLikeCode(text: string): boolean {
  if (text.length > 600) return false;
  const symbols = (text.match(/[{}();#\\/*=<>\[\]|~%]/g) || []).length;
  const density = symbols / Math.max(text.length, 1);
  const codeHints = /(printf|char\s+s\s*\[|main\s*\(|return\s*\(|for\s*\(|if\s*\()/.test(text);
  return density > 0.06 && (codeHints || density > 0.12);
}
