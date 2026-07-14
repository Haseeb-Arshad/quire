import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, BookOpen, Files, Loader2 } from "lucide-react";
import type { Annotation, BookDocument, HighlightColor } from "../../lib/types";
import type { FlowMode, PageTheme, ViewMode, WidthMode } from "../../lib/preferences";
import { fontStack } from "../../lib/fonts";
import { getFileBlob } from "../../lib/library";
import { useBlobUrl } from "../../lib/hooks";
import {
  selectionToDrafts,
  type Decoration,
  type PageSelectionDraft,
  type SelectionDraft
} from "../../lib/anchors";
import { resolveHighlightRange } from "../../lib/annotations";
import type { SearchMatch } from "../../lib/search";
import { EMPTY_DECORATIONS, Paragraph } from "./Paragraph";
import { HighlightPopover } from "./HighlightPopover";

const PdfPageView = lazy(() =>
  import("../pdf/PdfPageView").then((module) => ({ default: module.PdfPageView }))
);

export function ReaderCanvas(props: {
  stageRef: React.RefObject<HTMLDivElement>;
  book?: BookDocument;
  isLoading: boolean;
  fontSize: number;
  fontId: string;
  widthMode: WidthMode;
  viewMode: ViewMode;
  pageTheme: PageTheme;
  flowMode: FlowMode;
  /** Chapter shown in paged mode; -1 is the cover page. */
  activeChapterIndex: number;
  onChapterSelect: (index: number) => void;
  searchMatches: SearchMatch[];
  activeMatchIndex: number;
  annotations: Annotation[];
  onHighlight: (drafts: SelectionDraft[], color: HighlightColor) => void;
  onPageHighlight: (drafts: PageSelectionDraft[], color: HighlightColor) => void;
  onDeleteAnnotation: (id: string) => void;
  onSaveNote: (id: string, note: string) => void;
  onVisiblePage: (page: number) => void;
  initialPage?: number;
  pdfJump?: { page: number; nonce: number } | null;
}) {
  const fileUrl = useBlobUrl(
    props.book?.id,
    props.viewMode === "original" && Boolean(props.book?.hasOriginal),
    getFileBlob
  );

  const [popover, setPopover] = useState<{ drafts: SelectionDraft[]; x: number; y: number } | null>(
    null
  );

  // Decorations per paragraph: search marks + persisted highlights.
  const decoMap = useMemo(() => {
    const map = new Map<string, Decoration[]>();
    const push = (sectionId: string, paraIndex: number, decoration: Decoration) => {
      const key = `${sectionId}|${paraIndex}`;
      const list = map.get(key);
      if (list) {
        list.push(decoration);
      } else {
        map.set(key, [decoration]);
      }
    };

    props.searchMatches.forEach((match, index) => {
      push(match.sectionId, match.paraIndex, {
        start: match.start,
        end: match.end,
        kind: index === props.activeMatchIndex ? "search-active" : "search"
      });
    });

    if (props.book) {
      const sectionsById = new Map(props.book.sections.map((section) => [section.id, section]));
      for (const annotation of props.annotations) {
        if (annotation.kind !== "highlight") continue;
        const text = sectionsById.get(annotation.sectionId)?.paragraphs[annotation.paraIndex];
        if (text === undefined) continue;
        const range = resolveHighlightRange(annotation, text);
        if (!range) continue;
        push(annotation.sectionId, annotation.paraIndex, {
          start: range.start,
          end: range.end,
          kind: `hl-${annotation.color}`,
          id: annotation.id
        });
      }
    }
    return map;
  }, [props.book, props.annotations, props.searchMatches, props.activeMatchIndex]);

  // Bring the active search match to the center of the stage. In paged mode
  // the chapter may have just switched, so the chapter index is a dependency —
  // the mark only exists once the right chapter has rendered.
  useEffect(() => {
    if (!props.searchMatches.length) return;
    const stage = props.stageRef.current;
    if (!stage) return;
    const frame = requestAnimationFrame(() => {
      stage.querySelector(".deco-search-active")?.scrollIntoView({ block: "center" });
    });
    return () => cancelAnimationFrame(frame);
  }, [props.activeMatchIndex, props.searchMatches, props.stageRef, props.activeChapterIndex]);

  const handleMouseUp = () => {
    const stage = props.stageRef.current;
    if (!stage) return;
    const drafts = selectionToDrafts(stage);
    if (!drafts.length) {
      setPopover(null);
      return;
    }
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    setPopover({ drafts, x: rect.left + rect.width / 2, y: rect.top - 8 });
  };

  const finishSelection = () => {
    window.getSelection()?.removeAllRanges();
    setPopover(null);
  };

  const beginReading = () => {
    if (props.flowMode === "paged") {
      props.onChapterSelect(0);
      return;
    }
    props.stageRef.current
      ?.querySelector(".book-section")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (props.isLoading && !props.book) {
    return (
      <section className="reader-stage scroll-area" ref={props.stageRef}>
        <div className="reader-empty">
          <Loader2 className="spin" size={30} />
          <strong>Opening your book</strong>
          <span>Reading the layout — paragraphs, headings and tables.</span>
        </div>
      </section>
    );
  }

  if (!props.book) {
    return (
      <section className="reader-stage scroll-area" ref={props.stageRef}>
        <div className="reader-empty">
          <BookOpen size={40} />
          <strong>This book isn&apos;t in your library</strong>
          <span>Head back to the library to open or import one.</span>
        </div>
      </section>
    );
  }

  if (props.viewMode === "original" && props.book.hasOriginal) {
    return (
      <section className="reader-stage scroll-area" ref={props.stageRef}>
        <div className={`document-page width-${props.widthMode} pages-mode`}>
          <div className="pages-head">
            <Files size={15} />
            <span>Original pages · {props.book.pageCount || "?"} pages · images and layout preserved</span>
          </div>
          {fileUrl ? (
            <Suspense
              fallback={
                <div className="pdf-state">
                  <Loader2 className="spin" size={26} />
                  <span>Loading page renderer…</span>
                </div>
              }
            >
              <PdfPageView
                bookId={props.book.id}
                fileUrl={fileUrl}
                pageTheme={props.pageTheme}
                annotations={props.annotations}
                onPageHighlight={props.onPageHighlight}
                onDeleteAnnotation={props.onDeleteAnnotation}
                onSaveNote={props.onSaveNote}
                onVisiblePage={props.onVisiblePage}
                initialPage={props.initialPage}
                jump={props.pdfJump}
              />
            </Suspense>
          ) : (
            <div className="pdf-state">
              <Loader2 className="spin" size={26} />
              <span>Opening the original file…</span>
            </div>
          )}
        </div>
      </section>
    );
  }

  const paged = props.flowMode === "paged";
  const chapterCount = props.book.sections.length;
  const chapterIndex = Math.min(props.activeChapterIndex, chapterCount - 1);
  const activeSection = paged && chapterIndex >= 0 ? props.book.sections[chapterIndex] : null;
  const showCover = !paged || chapterIndex < 0;

  const renderSection = (section: BookDocument["sections"][number]) => (
    <section key={section.id} id={section.id} className="book-section">
      <h2>{section.title}</h2>
      {section.paragraphs.map((paragraph, index) => (
        <Paragraph
          key={`${section.id}-${index}`}
          text={paragraph}
          block={section.blocks?.[index]}
          sectionId={section.id}
          paraIndex={index}
          decorations={decoMap.get(`${section.id}|${index}`) || EMPTY_DECORATIONS}
        />
      ))}
    </section>
  );

  return (
    <section
      className="reader-stage scroll-area"
      ref={props.stageRef}
      onMouseUp={handleMouseUp}
      onMouseDown={() => setPopover(null)}
      onScroll={() => popover && setPopover(null)}
    >
      <article
        className={`document-page width-${props.widthMode}`}
        style={
          {
            "--reader-font-size": `${props.fontSize}px`,
            "--reader-font-family": fontStack(props.fontId)
          } as React.CSSProperties
        }
      >
        {showCover ? (
          <section className="book-cover">
            {props.book.author ? <p className="book-cover-author">{props.book.author}</p> : null}
            <h1 className="book-cover-title">{props.book.title}</h1>
            <button type="button" className="book-cover-begin" onClick={beginReading}>
              begin
            </button>
          </section>
        ) : null}

        {paged
          ? activeSection
            ? renderSection(activeSection)
            : null
          : props.book.sections.map(renderSection)}

        {paged ? (
          <ChapterFooter
            book={props.book}
            chapterIndex={chapterIndex}
            onChapterSelect={props.onChapterSelect}
          />
        ) : null}
      </article>

      {popover ? (
        <HighlightPopover
          x={popover.x}
          y={popover.y}
          onPick={(color) => {
            props.onHighlight(popover.drafts, color);
            finishSelection();
          }}
          onCopy={() => {
            void navigator.clipboard.writeText(popover.drafts.map((d) => d.quote).join("\n\n"));
            finishSelection();
          }}
        />
      ) : null}
    </section>
  );
}

function ChapterFooter({
  book,
  chapterIndex,
  onChapterSelect
}: {
  book: BookDocument;
  chapterIndex: number;
  onChapterSelect: (index: number) => void;
}) {
  const count = book.sections.length;
  const prevTitle = chapterIndex === 0 ? "Cover" : book.sections[chapterIndex - 1]?.title;
  const next = book.sections[chapterIndex + 1];

  return (
    <nav className="chapter-footer" aria-label="Chapter navigation">
      {chapterIndex >= 0 ? (
        <button
          type="button"
          className="chapter-step"
          onClick={() => onChapterSelect(chapterIndex - 1)}
        >
          <ArrowLeft size={14} />
          <span>{truncateTitle(prevTitle || "Previous")}</span>
        </button>
      ) : (
        <span />
      )}

      <span className="chapter-footer-count">
        {chapterIndex >= 0 ? `Chapter ${chapterIndex + 1} of ${count}` : `${count} chapters`}
      </span>

      {chapterIndex < count - 1 ? (
        <button
          type="button"
          className="chapter-step chapter-step-next"
          onClick={() => onChapterSelect(chapterIndex + 1)}
        >
          <span>{truncateTitle(chapterIndex < 0 ? book.sections[0]?.title || "Begin" : next?.title || "Next")}</span>
          <ArrowRight size={14} />
        </button>
      ) : (
        <span />
      )}
    </nav>
  );
}

function truncateTitle(value: string): string {
  return value.length > 34 ? `${value.slice(0, 33)}…` : value;
}
