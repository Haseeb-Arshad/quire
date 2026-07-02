import { lazy, Suspense, useMemo } from "react";
import { BookOpen, Files, Loader2 } from "lucide-react";
import type { BookDocument } from "../../lib/types";
import type { PageTheme, ViewMode, WidthMode } from "../../lib/preferences";
import { fontStack } from "../../lib/fonts";
import { getFileBlob } from "../../lib/library";
import { useBlobUrl } from "../../lib/hooks";

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
  query: string;
}) {
  const fileUrl = useBlobUrl(
    props.book?.id,
    props.viewMode === "original" && Boolean(props.book?.hasOriginal),
    getFileBlob
  );

  const matches = useMemo(() => {
    const search = props.query.trim().toLowerCase();
    if (!props.book || !search) return new Set<string>();
    const result = new Set<string>();
    props.book.sections.forEach((section) => {
      if (section.title.toLowerCase().includes(search)) result.add(section.id);
      section.paragraphs.forEach((paragraph, index) => {
        if (paragraph.toLowerCase().includes(search)) result.add(`${section.id}-${index}`);
      });
    });
    return result;
  }, [props.book, props.query]);

  if (props.isLoading && !props.book) {
    return (
      <section className="reader-stage scroll-area" ref={props.stageRef}>
        <div className="reader-empty">
          <Loader2 className="spin" size={30} />
          <strong>Opening your book</strong>
          <span>Joining broken lines and building the section outline.</span>
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
              <PdfPageView bookId={props.book.id} fileUrl={fileUrl} pageTheme={props.pageTheme} />
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

  return (
    <section className="reader-stage scroll-area" ref={props.stageRef}>
      <article
        className={`document-page width-${props.widthMode}`}
        style={
          {
            "--reader-font-size": `${props.fontSize}px`,
            "--reader-font-family": fontStack(props.fontId)
          } as React.CSSProperties
        }
      >
        <header className="book-masthead">
          <p>{props.book.sourceKind.toUpperCase()} · reflowed for reading</p>
          <h1>{props.book.title}</h1>
          {props.book.author ? <span>by {props.book.author}</span> : null}
          <dl>
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
        </header>

        <nav className="inline-toc" aria-label="Table of contents">
          <h3>Contents</h3>
          <ol>
            {props.book.sections.slice(0, 18).map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`}>{section.title}</a>
              </li>
            ))}
          </ol>
        </nav>

        {props.book.sections.map((section) => (
          <section
            key={section.id}
            id={section.id}
            className={matches.has(section.id) ? "book-section match" : "book-section"}
          >
            <h2>{section.title}</h2>
            {section.paragraphs.map((paragraph, index) => (
              <Paragraph
                key={`${section.id}-${index}`}
                text={paragraph}
                isMatch={matches.has(`${section.id}-${index}`)}
              />
            ))}
          </section>
        ))}
      </article>
    </section>
  );
}

// Render code-like blocks (indented listings, symbol soup) in a monospace box
// so the reflowed view stops mangling figures and source listings into prose.
function Paragraph({ text, isMatch }: { text: string; isMatch: boolean }) {
  if (looksLikeCode(text)) {
    return <pre className={isMatch ? "code-block match" : "code-block"}>{text}</pre>;
  }
  return <p className={isMatch ? "match" : undefined}>{text}</p>;
}

function looksLikeCode(text: string): boolean {
  if (text.length > 600) return false;
  const symbols = (text.match(/[{}();#\\/*=<>\[\]|~%]/g) || []).length;
  const density = symbols / Math.max(text.length, 1);
  const codeHints = /(printf|char\s+s\s*\[|main\s*\(|return\s*\(|for\s*\(|if\s*\()/.test(text);
  return density > 0.06 && (codeHints || density > 0.12);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en").format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { year: "numeric", month: "short", day: "numeric" }).format(
    new Date(value)
  );
}
