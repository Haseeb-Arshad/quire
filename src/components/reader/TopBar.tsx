import { Link } from "@tanstack/react-router";
import { ArrowLeft, Layers, Moon, PanelRight, Sun } from "lucide-react";
import type { ViewMode } from "../../lib/preferences";
import { Segmented } from "../ui/Segmented";
import { SearchBar } from "./SearchBar";
import { useAppTheme } from "../../app/AppShell";

export function TopBar(props: {
  title?: string;
  author?: string;
  viewMode: ViewMode;
  hasOriginal: boolean;
  canNavigate: boolean;
  progress: number;
  onViewMode: (value: ViewMode) => void;
  onOpenChapters: () => void;
  railOpen: boolean;
  onToggleRail: () => void;
  query: string;
  onQuery: (value: string) => void;
  matchCount: number;
  activeMatchIndex: number;
  onNextMatch: () => void;
  onPrevMatch: () => void;
  searchRef: React.RefObject<HTMLInputElement>;
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

      <SearchBar
        ref={props.searchRef}
        query={props.query}
        onQuery={props.onQuery}
        matchCount={props.matchCount}
        activeIndex={props.activeMatchIndex}
        onNext={props.onNextMatch}
        onPrev={props.onPrevMatch}
      />

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

        <button
          className="icon-button"
          type="button"
          onClick={toggleAppTheme}
          title={appTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {appTheme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>

        <button
          className={"icon-button" + (props.railOpen ? " active" : "")}
          type="button"
          onClick={props.onToggleRail}
          title={props.railOpen ? "Collapse sidebar" : "Show outline & appearance"}
          aria-pressed={props.railOpen}
        >
          <PanelRight size={16} />
        </button>
      </div>

      <div className="top-progress" aria-hidden>
        <div style={{ width: `${Math.round(props.progress * 100)}%` }} />
      </div>
    </header>
  );
}
