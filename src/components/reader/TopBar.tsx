import { Link } from "@tanstack/react-router";
import { ArrowLeft, Layers, Moon, Search, Sun } from "lucide-react";
import type { ViewMode, WidthMode } from "../../lib/preferences";
import { Segmented } from "../ui/Segmented";
import { TypeMenu } from "./TypeMenu";
import { ThemeMenu } from "./ThemeMenu";
import { useAppTheme } from "../../app/AppShell";
import type { PageTheme } from "../../lib/preferences";

export function TopBar(props: {
  title?: string;
  author?: string;
  fontSize: number;
  fontId: string;
  widthMode: WidthMode;
  pageTheme: PageTheme;
  viewMode: ViewMode;
  hasOriginal: boolean;
  canNavigate: boolean;
  progress: number;
  onFontSize: (value: number) => void;
  onFontId: (value: string) => void;
  onWidthMode: (value: WidthMode) => void;
  onPageTheme: (value: PageTheme) => void;
  onViewMode: (value: ViewMode) => void;
  onOpenChapters: () => void;
  query: string;
  onQuery: (value: string) => void;
}) {
  const { appTheme, toggleAppTheme } = useAppTheme();

  return (
    <header className="top-bar">
      <div className="top-bar-title">
        <Link to="/" className="icon-button" title="Back to library" aria-label="Back to library">
          <ArrowLeft size={16} />
        </Link>
        <strong>{props.title || "Quire"}</strong>
        {props.author ? <span>· {props.author}</span> : null}
      </div>

      <label className="search-box">
        <Search size={15} />
        <input
          value={props.query}
          onChange={(event) => props.onQuery(event.target.value)}
          placeholder="Find in book"
          aria-label="Find in book"
        />
      </label>

      <div className="toolbar-group" aria-label="Reader controls">
        <button
          className="tool-button"
          type="button"
          onClick={props.onOpenChapters}
          disabled={!props.canNavigate}
          title="Chapters (C)"
        >
          <Layers size={15} />
          <span>Chapters</span>
        </button>

        {props.hasOriginal ? (
          <Segmented<ViewMode>
            label="View"
            value={props.viewMode}
            options={[
              ["reader", "Reader"],
              ["original", "Pages"]
            ]}
            onChange={props.onViewMode}
          />
        ) : null}

        <TypeMenu
          fontId={props.fontId}
          fontSize={props.fontSize}
          widthMode={props.widthMode}
          onFontId={props.onFontId}
          onFontSize={props.onFontSize}
          onWidthMode={props.onWidthMode}
        />

        <ThemeMenu pageTheme={props.pageTheme} onPageTheme={props.onPageTheme} />

        <button
          className="icon-button"
          type="button"
          onClick={toggleAppTheme}
          title={appTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {appTheme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>

      <div className="top-progress" aria-hidden>
        <div style={{ width: `${Math.round(props.progress * 100)}%` }} />
      </div>
    </header>
  );
}
