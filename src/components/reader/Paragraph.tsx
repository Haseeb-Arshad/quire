import { memo } from "react";
import { segmentText, type Decoration } from "../../lib/anchors";

export const EMPTY_DECORATIONS: Decoration[] = [];

// Renders one extracted paragraph. Code-like blocks (indented listings,
// symbol soup) go in a monospace box so the reflow stops mangling source
// listings into prose. Decorations (search marks, highlights) may overlap;
// segmentText splits the text so each run carries all covering kinds.
export const Paragraph = memo(function Paragraph({
  text,
  sectionId,
  paraIndex,
  decorations
}: {
  text: string;
  sectionId: string;
  paraIndex: number;
  decorations: Decoration[];
}) {
  const content = decorations.length
    ? segmentText(text, decorations).map((segment, index) =>
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
      )
    : text;

  if (looksLikeCode(text)) {
    return (
      <pre className="code-block" data-section-id={sectionId} data-para={paraIndex}>
        {content}
      </pre>
    );
  }
  return (
    <p data-section-id={sectionId} data-para={paraIndex}>
      {content}
    </p>
  );
});

function looksLikeCode(text: string): boolean {
  if (text.length > 600) return false;
  const symbols = (text.match(/[{}();#\\/*=<>\[\]|~%]/g) || []).length;
  const density = symbols / Math.max(text.length, 1);
  const codeHints = /(printf|char\s+s\s*\[|main\s*\(|return\s*\(|for\s*\(|if\s*\()/.test(text);
  return density > 0.06 && (codeHints || density > 0.12);
}
