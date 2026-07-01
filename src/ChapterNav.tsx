import { useEffect, useMemo, useRef, useState } from "react";
import { CornerDownLeft, List, Search } from "lucide-react";
import type { BookDocument } from "./lib/types";

// A focused chapter-jump overlay (command-palette style): filterable, keyboard
// driven, and aware of which chapter you're currently reading.
export function ChapterNav({
  book,
  activeSectionId,
  onJump,
  onClose
}: {
  book: BookDocument;
  activeSectionId?: string;
  onJump: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const items = book.sections.map((section, index) => ({ section, index }));
    if (!q) return items;
    return items.filter(({ section }) => section.title.toLowerCase().includes(q));
  }, [book.sections, query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setCursor(0);
  }, [query]);

  useEffect(() => {
    const active = listRef.current?.querySelector<HTMLElement>('[data-cursor="true"]');
    active?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((c) => Math.min(filtered.length - 1, c + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const target = filtered[cursor];
      if (target) onJump(target.section.id);
    }
  };

  return (
    <div className="chapter-overlay" onClick={onClose}>
      <div
        className="chapter-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Chapters"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="chapter-search">
          <Search size={16} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Jump to a chapter…"
          />
          <span className="chapter-count">
            <List size={13} /> {book.sections.length}
          </span>
        </div>

        <div className="chapter-list" ref={listRef}>
          {filtered.length ? (
            filtered.map(({ section, index }, position) => (
              <button
                key={section.id}
                type="button"
                data-cursor={position === cursor}
                className={
                  "chapter-row" +
                  (section.id === activeSectionId ? " current" : "") +
                  (position === cursor ? " cursor" : "")
                }
                onClick={() => onJump(section.id)}
                onMouseEnter={() => setCursor(position)}
              >
                <span className="chapter-index">{String(index + 1).padStart(2, "0")}</span>
                <span className="chapter-title">{section.title}</span>
                <span className="chapter-meta">{formatCount(section.wordCount)} words</span>
                {position === cursor ? <CornerDownLeft size={14} className="chapter-enter" /> : null}
              </button>
            ))
          ) : (
            <p className="chapter-empty">No chapters match “{query}”.</p>
          )}
        </div>

        <div className="chapter-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> jump</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en").format(value);
}
