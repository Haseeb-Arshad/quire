import { useState } from "react";
import { Bookmark as BookmarkIcon, Download, Highlighter, PanelRightClose, X } from "lucide-react";
import type { Annotation, BookDocument } from "../../lib/types";
import type { FlowMode, PageTheme, WidthMode } from "../../lib/preferences";
import { Segmented } from "../ui/Segmented";
import { TypePanel } from "./TypeMenu";
import { ThemePanel, type ThemeScope } from "./ThemeMenu";

type PanelTab = "notes" | "appearance";

// Right drawer: reader notes (highlights + bookmarks, with editable notes)
// and the appearance controls. Slides in from the right screen edge.
export function NotesAppearancePanel(props: {
  book?: BookDocument;
  annotations: Annotation[];
  onJumpToAnnotation: (annotation: Annotation) => void;
  onDeleteAnnotation: (id: string) => void;
  onSaveNote: (id: string, note: string) => void;
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
  flowMode: FlowMode;
  onFlowMode: (value: FlowMode) => void;
}) {
  const [tab, setTab] = useState<PanelTab>("notes");
  const noteCount = props.annotations.length;

  return (
    <aside className="edge-drawer edge-drawer-right scroll-area" aria-label="Notes and appearance">
      <div className="rail-top">
        <span>{tab === "notes" ? "Notes" : "Appearance"}</span>
        <button className="icon-button" type="button" onClick={props.onClose} title="Hide panel">
          <PanelRightClose size={15} />
        </button>
      </div>

      <Segmented<PanelTab>
        label="Panel view"
        value={tab}
        options={[
          ["notes", noteCount ? `Notes · ${noteCount}` : "Notes"],
          ["appearance", "Appearance"]
        ]}
        onChange={setTab}
      />
      <div className="rail-spacer" />

      {tab === "notes" ? (
        noteCount ? (
          <div className="notes-list">
            {props.annotations.map((annotation) => (
              <NoteRow
                key={annotation.id}
                annotation={annotation}
                onJump={() => props.onJumpToAnnotation(annotation)}
                onDelete={() => props.onDeleteAnnotation(annotation.id)}
                onSaveNote={(note) => props.onSaveNote(annotation.id, note)}
              />
            ))}
          </div>
        ) : (
          <p className="empty-note">
            <Highlighter size={13} style={{ verticalAlign: "-2px" }} /> Select any text to highlight
            it, or press <kbd className="kbd">B</kbd> to bookmark where you are — in both reading
            views.
          </p>
        )
      ) : (
        <div className="rail-appearance">
          <div className="type-section">
            <div className="type-label">Layout</div>
            <Segmented<FlowMode>
              label="Layout"
              value={props.flowMode}
              options={[
                ["paged", "Chapters"],
                ["scroll", "Scroll"]
              ]}
              onChange={props.onFlowMode}
            />
          </div>
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
          <button
            className="secondary-action"
            type="button"
            disabled={!props.book}
            onClick={() => window.print()}
          >
            <Download size={15} />
            Print or save
          </button>
        </div>
      )}
    </aside>
  );
}

function NoteRow({
  annotation,
  onJump,
  onDelete,
  onSaveNote
}: {
  annotation: Annotation;
  onJump: () => void;
  onDelete: () => void;
  onSaveNote: (note: string) => void;
}) {
  const isHighlight = annotation.kind === "highlight" || annotation.kind === "page-highlight";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(isHighlight ? annotation.note || "" : "");

  const pageMeta =
    annotation.kind === "page-highlight" || annotation.kind === "page-bookmark" ? (
      <small className="note-page"> · p. {annotation.page}</small>
    ) : null;

  return (
    <div className="note-item-block">
      <div className="note-item">
        <button type="button" className="note-body" onClick={onJump}>
          {isHighlight ? (
            <>
              <span className={`hl-dot hl-dot-${annotation.color}`} aria-hidden />
              <span className="note-quote">
                {truncate(annotation.quote, 110)}
                {pageMeta}
              </span>
            </>
          ) : (
            <>
              <BookmarkIcon size={13} />
              <span className="note-quote">
                {truncate(annotation.label, 110)}
                {pageMeta}
              </span>
            </>
          )}
        </button>
        <button type="button" className="note-delete" onClick={onDelete} aria-label="Delete note">
          <X size={13} />
        </button>
      </div>

      {isHighlight ? (
        editing ? (
          <div className="note-editor">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Write a note…"
              rows={3}
              autoFocus
            />
            <div className="note-editor-actions">
              <button
                type="button"
                className="note-editor-save"
                onClick={() => {
                  onSaveNote(draft);
                  setEditing(false);
                }}
              >
                Save
              </button>
              <button type="button" className="note-editor-cancel" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : annotation.note ? (
          <button type="button" className="note-text" onClick={() => setEditing(true)}>
            {annotation.note}
          </button>
        ) : (
          <button type="button" className="note-add" onClick={() => setEditing(true)}>
            Add note
          </button>
        )
      ) : null}
    </div>
  );
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
