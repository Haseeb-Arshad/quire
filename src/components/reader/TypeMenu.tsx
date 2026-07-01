import { useEffect, useRef, useState } from "react";
import { ChevronDown, Type } from "lucide-react";
import { READING_FONTS } from "../../lib/fonts";
import type { WidthMode } from "../../lib/preferences";
import { Segmented } from "../ui/Segmented";

export function TypeMenu(props: {
  fontId: string;
  fontSize: number;
  widthMode: WidthMode;
  onFontId: (value: string) => void;
  onFontSize: (value: number) => void;
  onWidthMode: (value: WidthMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const activeFont = READING_FONTS.find((font) => font.id === props.fontId) || READING_FONTS[0];

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const categories = ["Classic", "Magazine", "Modern", "Sans"] as const;

  return (
    <div className="type-menu" ref={ref}>
      <button className="tool-button" type="button" onClick={() => setOpen((v) => !v)} title="Typography">
        <Type size={15} />
        <span className="type-current" style={{ fontFamily: activeFont.stack }}>
          {activeFont.label}
        </span>
        <ChevronDown size={14} />
      </button>

      {open ? (
        <div className="type-popover scroll-area" role="menu">
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
                      <span className="font-note">{font.note}</span>
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
        </div>
      ) : null}
    </div>
  );
}
