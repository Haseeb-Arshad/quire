import { useState } from "react";
import { Bookmark as BookmarkIcon, Download, Highlighter, PanelRight, X } from "lucide-react";
import type { Annotation, BookDocument } from "../../lib/types";
import { Segmented } from "../ui/Segmented";

type RailTab = "outline" | "notes";

export function OutlineRail(props: {
  book?: BookDocument;
  activeSectionId?: string;
  annotations: Annotation[];
  onJump: (id: string) => void;
  onJumpToAnnotation: (annotation: Annotation) => void;
  onDeleteAnnotation: (id: string) => void;
}) {
  const [tab, setTab] = useState<RailTab>("outline");
  const noteCount = props.annotations.length;

  return (
    <aside className="outline-panel scroll-area">
      <section>
        <div className="section-heading rail-heading">
          <PanelRight size={14} />
          <Segmented<RailTab>
            label="Rail view"
            value={tab}
            options={[
              ["outline", "Outline"],
              ["notes", noteCount ? `Notes · ${noteCount}` : "Notes"]
            ]}
            onChange={setTab}
          />
        </div>

        {tab === "outline" ? (
          props.book ? (
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
          ) : (
            <p className="empty-note">The section outline appears once the book opens.</p>
          )
        ) : noteCount ? (
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

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
