import { useEffect, useRef, useState } from "react";
import { Palette } from "lucide-react";
import type { PageTheme } from "../../lib/preferences";

interface ThemeOption {
  id: PageTheme;
  label: string;
  bg: string;
  ink: string;
  hint: string;
}

export const PAGE_THEMES: ThemeOption[] = [
  { id: "white", label: "White", bg: "#ffffff", ink: "#1c1c1e", hint: "Clean gallery white" },
  { id: "paper", label: "Paper", bg: "#f7f2e7", ink: "#2a251c", hint: "Warm book paper" },
  { id: "sepia", label: "Sepia", bg: "#f4ecd8", ink: "#5b4636", hint: "Amber, easy for long reads" },
  { id: "grey", label: "Grey", bg: "#e2e3e5", ink: "#3f4247", hint: "Low glare for office light" },
  { id: "night", label: "Night", bg: "#141414", ink: "#d8d8d6", hint: "True dark, inverted pages" },
  { id: "focus", label: "Focus", bg: "#181310", ink: "#e6d3ae", hint: "Low-blue evening amber" }
];

export type ThemeScope = "global" | "book";

export function ThemeMenu(props: {
  pageTheme: PageTheme;
  onPageTheme: (value: PageTheme) => void;
  themeScope: ThemeScope;
  onThemeScope: (scope: ThemeScope) => void;
  canScopeToBook: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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

  return (
    <div className="type-menu" ref={ref}>
      <button
        className="icon-button"
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Page theme (T)"
        aria-label="Page theme"
      >
        <Palette size={16} />
      </button>

      {open ? (
        <div className="type-popover scroll-area" role="menu" style={{ width: 300 }}>
          <div className="type-section">
            <div className="type-label">Page theme</div>
            <div className="theme-swatches">
              {PAGE_THEMES.map((theme) => (
                <button
                  key={theme.id}
                  type="button"
                  className={"theme-swatch" + (theme.id === props.pageTheme ? " active" : "")}
                  title={theme.hint}
                  onClick={() => props.onPageTheme(theme.id)}
                >
                  <span
                    className="theme-swatch-chip"
                    style={{ background: theme.bg, color: theme.ink }}
                    aria-hidden
                  >
                    Ag
                  </span>
                  <span>{theme.label}</span>
                </button>
              ))}
            </div>
          </div>

          {props.canScopeToBook ? (
            <div className="type-section">
              <label className="theme-scope">
                <input
                  type="checkbox"
                  checked={props.themeScope === "book"}
                  onChange={(event) => props.onThemeScope(event.target.checked ? "book" : "global")}
                />
                <span>Only for this book</span>
              </label>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
