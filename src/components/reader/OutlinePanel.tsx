import { PanelLeftClose } from "lucide-react";
import type { BookDocument } from "../../lib/types";

// Left drawer: the book's outline plus a compact About block. Slides in from
// the left screen edge; its floating toggle lives in ReaderPage.
export function OutlinePanel(props: {
  book?: BookDocument;
  activeSectionId?: string;
  onJump: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <aside className="edge-drawer edge-drawer-left scroll-area" aria-label="Outline">
      <div className="rail-top">
        <span>Contents</span>
        <button className="icon-button" type="button" onClick={props.onClose} title="Hide contents">
          <PanelLeftClose size={15} />
        </button>
      </div>

      {props.book ? (
        <>
          <dl className="rail-about">
            <div>
              <dt>Source</dt>
              <dd>{props.book.fileName}</dd>
            </div>
            <div>
              <dt>Added</dt>
              <dd>{formatDate(props.book.uploadedAt)}</dd>
            </div>
            <div>
              <dt>Words</dt>
              <dd>{formatNumber(props.book.wordCount)}</dd>
            </div>
            <div>
              <dt>Sections</dt>
              <dd>{formatNumber(props.book.sectionCount)}</dd>
            </div>
          </dl>
          <div className="outline-list">
            {props.book.sections.map((section) => (
              <button
                key={section.id}
                type="button"
                className={"outline-item" + (section.id === props.activeSectionId ? " current" : "")}
                onClick={() => props.onJump(section.id)}
              >
                <span>{section.title}</span>
                <small>{formatNumber(section.wordCount)}</small>
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className="empty-note">The outline appears once the book opens.</p>
      )}
    </aside>
  );
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en").format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { year: "numeric", month: "short", day: "numeric" }).format(
    new Date(value)
  );
}
