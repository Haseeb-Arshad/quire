import { Copy } from "lucide-react";
import type { HighlightColor } from "../../lib/types";

const COLORS: HighlightColor[] = ["amber", "sage", "sky", "rose"];

export function HighlightPopover(props: {
  x: number;
  y: number;
  onPick: (color: HighlightColor) => void;
  onCopy: () => void;
}) {
  return (
    <div
      className="highlight-popover"
      style={{ left: props.x, top: props.y }}
      role="toolbar"
      aria-label="Highlight selection"
      // Keep the text selection alive while clicking the popover, and stop
      // the press from reaching the stage (which would dismiss the popover).
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onMouseUp={(event) => event.stopPropagation()}
    >
      {COLORS.map((color) => (
        <button
          key={color}
          type="button"
          className={`hl-dot hl-dot-${color}`}
          title={`Highlight ${color}`}
          aria-label={`Highlight ${color}`}
          onClick={() => props.onPick(color)}
        />
      ))}
      <span className="hl-divider" aria-hidden />
      <button type="button" className="hl-copy" title="Copy text" aria-label="Copy text" onClick={props.onCopy}>
        <Copy size={13} />
      </button>
    </div>
  );
}
