import { Download, PanelRight } from "lucide-react";
import type { BookDocument } from "../../lib/types";

export function OutlineRail(props: {
  book?: BookDocument;
  activeSectionId?: string;
  onJump: (id: string) => void;
}) {
  return (
    <aside className="outline-panel scroll-area">
      <section>
        <div className="section-heading">
          <PanelRight size={14} />
          <span>Outline</span>
        </div>
        {props.book ? (
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
