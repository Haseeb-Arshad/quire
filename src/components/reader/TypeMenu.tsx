import { READING_FONTS } from "../../lib/fonts";
import type { WidthMode } from "../../lib/preferences";
import { Segmented } from "../ui/Segmented";

// Presentational panel — the font/size/width controls, embedded directly in
// the sidebar's Appearance tab (no popover chrome of its own).
export function TypePanel(props: {
  fontId: string;
  fontSize: number;
  widthMode: WidthMode;
  onFontId: (value: string) => void;
  onFontSize: (value: number) => void;
  onWidthMode: (value: WidthMode) => void;
}) {
  const categories = ["Classic", "Magazine", "Modern", "Sans"] as const;

  return (
    <>
      <div className="type-section">
        <div className="type-label">Reading font</div>
        <div className="font-grid">
          {categories.map((category) => (
            <div key={category} className="font-group">
              <span className="font-group-label">{category}</span>
              {READING_FONTS.filter((font) => font.category === category).map((font) => (
                <button
                  key={font.id}
                  type="button"
                  className={"font-option" + (font.id === props.fontId ? " active" : "")}
                  onClick={() => props.onFontId(font.id)}
                >
                  <span className="font-preview" style={{ fontFamily: font.stack }}>
                    Ag
                  </span>
                  <span className="font-name" style={{ fontFamily: font.stack }}>
                    {font.label}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="type-section">
        <div className="type-label">Text size · {props.fontSize}px</div>
        <input
          type="range"
          min="15"
          max="26"
          value={props.fontSize}
          aria-label="Text size"
          onChange={(event) => props.onFontSize(Number(event.target.value))}
        />
      </div>

      <div className="type-section">
        <div className="type-label">Width</div>
        <Segmented<WidthMode>
          label="Width"
          value={props.widthMode}
          options={[
            ["narrow", "Narrow"],
            ["standard", "Standard"],
            ["wide", "Wide"]
          ]}
          onChange={props.onWidthMode}
        />
      </div>
    </>
  );
}
