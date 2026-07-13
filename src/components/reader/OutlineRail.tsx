import { useState } from "react";
import { Bookmark as BookmarkIcon, Download, Highlighter, PanelRightClose, X } from "lucide-react";
import type { Annotation, BookDocument } from "../../lib/types";
import type { PageTheme, WidthMode } from "../../lib/preferences";
import { Segmented } from "../ui/Segmented";
import { TypePanel } from "./TypeMenu";
import { ThemePanel, type ThemeScope } from "./ThemeMenu";

type RailTab = "outline" | "notes" | "appearance";

export function OutlineRail(props: {
  book?: BookDocument;
  activeSectionId?: string;
  annotations: Annotation[];
  onJump: (id: string) => void;
  onJumpToAnnotation: (annotation: Annotation) => void;
  onDeleteAnnotation: (id: string) => void;
  onClose: () => void;
  fontId: string;
  fontSize: number;
  widthMode: WidthMode;
  onFontId: (value: string) => void;
  onFontSize: (value: number) => void;
  onWidthMode: (value: WidthMode) => void;
  pageTheme: PageTheme;
  onPageTheme: (value: PageTheme) => void;
  themeScope: ThemeScope;
  onThemeScope: (scope: ThemeScope) => void;
}) {
  const [tab, setTab] = useState<RailTab>("outline");
  const noteCount = props.annotations.length;

  return (
    <aside className="outline-panel scroll-area">
      <section>
        <div className="rail-top">
          <span>Sidebar</span>
          <button className="icon-button" type="button" onClick={props.onClose} title="Collapse sidebar">
            <PanelRightClose size={15} />
          </button>
        </div>

        <Segmented<RailTab>
          label="Rail view"
          value={tab}
          options={[
            ["outline", "Outline"],
            ["notes", noteCount ? `Notes · ${noteCount}` : "Notes"],
            ["appearance", "Appearance"]
          ]}
          onChange={setTab}
        />
        <div className="rail-spacer" />

        {tab === "outline" ? (
          props.book ? (
            <>
              <BookAbout book={props.book} />
              <div className="outline-list">
                {props.book.sections.map((section) => (
                  <button
                    key={section.id}
                    type="button"
                    className={"outline-item" + (section.id === props.activeSectionId ? " current" : "")}
                    onClick={() => props.onJump(section.id)}
                  >
                    <span>{section.title}</span>
                    <small>{new Intl.NumberFormat("en").format(section.wordCount)}</small>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className="empty-note">The section outline appears once the book opens.</p>
          )
        ) : tab === "notes" ? (
          noteCount ? (
            <div className="notes-list">
              {props.annotations.map((annotation) => (
                <div key={annotation.id} className="note-item">
                  <button
                    type="button"
                    className="note-body"
                    onClick={() => props.onJumpToAnnotation(annotation)}
                  >
                    {annotation.kind === "highlight" ? (
                      <>
                        <span className={`hl-dot hl-dot-${annotation.color}`} aria-hidden />
                        <span className="note-quote">{truncate(annotation.quote, 110)}</span>
                      </>
                    ) : (
                      <>
                        <BookmarkIcon size={13} />
                        <span className="note-quote">{truncate(annotation.label, 110)}</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    className="note-delete"
                    onClick={() => props.onDeleteAnnotation(annotation.id)}
                    aria-label="Delete note"
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="empty-note">
              <Highlighter size={13} style={{ verticalAlign: "-2px" }} /> Select any text to highlight
              it, or press <kbd className="kbd">B</kbd> to bookmark where you are.
            </p>
          )
        ) : (
          <div className="rail-appearance">
            <TypePanel
              fontId={props.fontId}
              fontSize={props.fontSize}
              widthMode={props.widthMode}
              onFontId={props.onFontId}
              onFontSize={props.onFontSize}
              onWidthMode={props.onWidthMode}
            />
            <ThemePanel
              pageTheme={props.pageTheme}
              onPageTheme={props.onPageTheme}
              themeScope={props.themeScope}
              onThemeScope={props.onThemeScope}
              canScopeToBook={Boolean(props.book)}
            />
          </div>
        )}
      </section>

      <button
        className="secondary-action"
        type="button"
        disabled={!props.book}
        onClick={() => window.print()}
      >
        <Download size={15} />
        Print or save
      </button>
    </aside>
  );
}

function BookAbout({ book }: { book: BookDocument }) {
  return (
    <dl className="rail-about">
      <div>
        <dt>Source</dt>
        <dd>{book.fileName}</dd>
      </div>
      <div>
        <dt>Added</dt>
        <dd>{formatDate(book.uploadedAt)}</dd>
      </div>
      <div>
        <dt>Words</dt>
        <dd>{formatNumber(book.wordCount)}</dd>
      </div>
      <div>
        <dt>Sections</dt>
        <dd>{formatNumber(book.sectionCount)}</dd>
      </div>
    </dl>
  );
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en").format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { year: "numeric", month: "short", day: "numeric" }).format(
    new Date(value)
  );
}
