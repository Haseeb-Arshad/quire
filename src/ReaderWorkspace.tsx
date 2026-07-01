import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import {
  BookOpen,
  CheckCircle2,
  ChevronDown,
  Clock,
  Download,
  FileInput,
  FileText,
  Files,
  Layers,
  Loader2,
  Moon,
  PanelRight,
  Repeat,
  Search,
  Sun,
  Type,
  Upload,
  Wand2
} from "lucide-react";
import { createDemoBook, getBook, getBooks, getFileBlob, importBook } from "./lib/library";
import type { BookDocument, BookSummary } from "./lib/types";
import { fontStack, READING_FONTS } from "./lib/fonts";
import { ChapterNav } from "./ChapterNav";
import {
  addSeconds,
  formatDuration,
  formatRelative,
  getStat,
  loadStats,
  recordOpen,
  setProgress,
  type BookStat
} from "./lib/readingStats";
import {
  loadPrefs,
  updateGlobalPrefs,
  type AppTheme,
  type PageTheme,
  type ViewMode,
  type WidthMode
} from "./lib/preferences";

const PdfPageView = lazy(() =>
  import("./PdfPageView").then((module) => ({ default: module.PdfPageView }))
);

type ThemeMode = PageTheme;

export function ReaderWorkspace() {
  const params = useParams({ strict: false }) as { bookId?: string };
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const selectedBookId = params.bookId;

  const [fontSize, setFontSize] = useState(() => loadPrefs().global.fontSize);
  const [fontId, setFontId] = useState(() => loadPrefs().global.fontId);
  const [widthMode, setWidthMode] = useState<WidthMode>(() => loadPrefs().global.widthMode);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => loadPrefs().global.pageTheme);
  const [appTheme, setAppTheme] = useState<AppTheme>(() => loadPrefs().global.appTheme);
  const [viewMode, setViewMode] = useState<ViewMode>("reader");
  const [query, setQuery] = useState("");
  const [chapterOpen, setChapterOpen] = useState(false);
  const [activeSectionId, setActiveSectionId] = useState<string | undefined>();
  const [stats, setStats] = useState(() => loadStats());
  const [liveProgress, setLiveProgress] = useState(0);

  const stageRef = useRef<HTMLDivElement>(null);

  const booksQuery = useQuery({ queryKey: ["books"], queryFn: getBooks });
  const bookQuery = useQuery({
    queryKey: ["book", selectedBookId],
    queryFn: () => getBook(selectedBookId!),
    enabled: Boolean(selectedBookId)
  });

  const openBook = (id: string) => {
    void navigate({ to: "/books/$bookId", params: { bookId: id } });
  };

  // Persist reader preferences whenever they change (debounced in the lib).
  useEffect(() => {
    updateGlobalPrefs({ fontId, fontSize, widthMode, pageTheme: themeMode, appTheme });
  }, [fontId, fontSize, widthMode, themeMode, appTheme]);

  const uploadMutation = useMutation({
    mutationFn: importBook,
    onSuccess: (book) => {
      queryClient.setQueryData(["book", book.id], book);
      void queryClient.invalidateQueries({ queryKey: ["books"] });
      openBook(book.id);
    }
  });

  const demoMutation = useMutation({
    mutationFn: createDemoBook,
    onSuccess: (book) => {
      queryClient.setQueryData(["book", book.id], book);
      void queryClient.invalidateQueries({ queryKey: ["books"] });
      openBook(book.id);
    }
  });

  const activeBook = bookQuery.data;
  const recentBooks = booksQuery.data || [];
  const isWorking = uploadMutation.isPending || demoMutation.isPending;
  const error = uploadMutation.error || demoMutation.error || bookQuery.error || booksQuery.error;

  // Count a fresh open + reset the reading surface for each book.
  useEffect(() => {
    if (!selectedBookId) return;
    setStats(recordOpen(selectedBookId));
    setViewMode("reader");
    setActiveSectionId(undefined);
  }, [selectedBookId]);

  // Resume where the reader left off once the book content has rendered.
  const activeBookId = bookQuery.data?.id;
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !activeBookId) return;
    const { progress } = getStat(loadStats(), activeBookId);
    requestAnimationFrame(() => {
      const max = stage.scrollHeight - stage.clientHeight;
      stage.scrollTo({ top: progress > 0.005 ? progress * max : 0 });
    });
  }, [activeBookId]);

  // Time-on-book: accrue reading seconds while the tab is visible.
  useEffect(() => {
    if (!selectedBookId) return;
    let pending = 0;
    const tick = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      pending += 1;
      if (pending >= 5) {
        setStats(addSeconds(selectedBookId, pending));
        pending = 0;
      }
    }, 1000);
    return () => {
      window.clearInterval(tick);
      if (pending > 0) setStats(addSeconds(selectedBookId, pending));
    };
  }, [selectedBookId]);

  // Track scroll-through progress + which chapter is on screen.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !activeBook || viewMode !== "reader") return;

    const onScroll = () => {
      const max = stage.scrollHeight - stage.clientHeight;
      const ratio = max > 0 ? stage.scrollTop / max : 0;
      setProgress(activeBook.id, ratio);
      setLiveProgress(ratio);
    };
    onScroll();
    stage.addEventListener("scroll", onScroll, { passive: true });

    const sections = Array.from(stage.querySelectorAll<HTMLElement>(".book-section[id]"));
    const observer = new IntersectionObserver(
      (entries) => {
        const onTop = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (onTop) setActiveSectionId(onTop.target.id);
      },
      { root: stage, rootMargin: "-10% 0px -80% 0px" }
    );
    sections.forEach((section) => observer.observe(section));

    return () => {
      stage.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
  }, [activeBook, viewMode]);

  // Global shortcut: "c" opens the chapter navigator.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      if (event.key.toLowerCase() === "c" && activeBook) {
        event.preventDefault();
        setChapterOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeBook]);

  const jumpToChapter = (id: string) => {
    setChapterOpen(false);
    if (viewMode !== "reader") setViewMode("reader");
    requestAnimationFrame(() => {
      const el = stageRef.current?.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  return (
    <main className={`app-shell app-${appTheme} theme-${themeMode}`}>
      <TopBar
        fontSize={fontSize}
        fontId={fontId}
        widthMode={widthMode}
        themeMode={themeMode}
        appTheme={appTheme}
        viewMode={viewMode}
        hasOriginal={Boolean(activeBook?.hasOriginal)}
        canNavigate={Boolean(activeBook)}
        progress={liveProgress}
        onFontSize={setFontSize}
        onFontId={setFontId}
        onWidthMode={setWidthMode}
        onThemeMode={setThemeMode}
        onAppTheme={setAppTheme}
        onViewMode={setViewMode}
        onOpenChapters={() => setChapterOpen(true)}
        query={query}
        onQuery={setQuery}
      />

      <InputOutputPanel
        books={recentBooks}
        activeBook={activeBook}
        selectedBookId={selectedBookId}
        isWorking={isWorking}
        stats={stats}
        onUpload={(file) => uploadMutation.mutate(file)}
        onDemo={() => demoMutation.mutate()}
        onOpenBook={openBook}
        error={error instanceof Error ? error.message : undefined}
      />

      <ReaderCanvas
        stageRef={stageRef}
        book={activeBook}
        isLoading={bookQuery.isFetching || isWorking}
        fontSize={fontSize}
        fontId={fontId}
        widthMode={widthMode}
        viewMode={viewMode}
        query={query}
      />

      <OutlineRail book={activeBook} activeSectionId={activeSectionId} onJump={jumpToChapter} />

      {chapterOpen && activeBook ? (
        <ChapterNav
          book={activeBook}
          activeSectionId={activeSectionId}
          onJump={jumpToChapter}
          onClose={() => setChapterOpen(false)}
        />
      ) : null}
    </main>
  );
}

function TopBar(props: {
  fontSize: number;
  fontId: string;
  widthMode: WidthMode;
  themeMode: ThemeMode;
  appTheme: AppTheme;
  viewMode: ViewMode;
  hasOriginal: boolean;
  canNavigate: boolean;
  progress: number;
  onFontSize: (value: number) => void;
  onFontId: (value: string) => void;
  onWidthMode: (value: WidthMode) => void;
  onThemeMode: (value: ThemeMode) => void;
  onAppTheme: (value: AppTheme) => void;
  onViewMode: (value: ViewMode) => void;
  onOpenChapters: () => void;
  query: string;
  onQuery: (value: string) => void;
}) {
  return (
    <header className="top-bar">
      <div className="brand">
        <span className="brand-mark">
          <BookOpen size={17} />
        </span>
        <div>
          <strong>Quire</strong>
          <span>A quiet place to read anything</span>
        </div>
      </div>

      <label className="search-box">
        <Search size={16} />
        <input
          value={props.query}
          onChange={(event) => props.onQuery(event.target.value)}
          placeholder="Find in output"
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
          themeMode={props.themeMode}
          onFontId={props.onFontId}
          onFontSize={props.onFontSize}
          onWidthMode={props.onWidthMode}
          onThemeMode={props.onThemeMode}
        />

        <button
          className="icon-button"
          type="button"
          onClick={() => props.onAppTheme(props.appTheme === "dark" ? "light" : "dark")}
          title={props.appTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {props.appTheme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>

      <div className="top-progress" aria-hidden>
        <div style={{ width: `${Math.round(props.progress * 100)}%` }} />
      </div>
    </header>
  );
}

function TypeMenu(props: {
  fontId: string;
  fontSize: number;
  widthMode: WidthMode;
  themeMode: ThemeMode;
  onFontId: (value: string) => void;
  onFontSize: (value: number) => void;
  onWidthMode: (value: WidthMode) => void;
  onThemeMode: (value: ThemeMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const activeFont = READING_FONTS.find((font) => font.id === props.fontId) || READING_FONTS[0];

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const categories = ["Classic", "Magazine", "Modern", "Sans"] as const;

  return (
    <div className="type-menu" ref={ref}>
      <button className="tool-button" type="button" onClick={() => setOpen((v) => !v)} title="Typography">
        <Type size={15} />
        <span className="type-current" style={{ fontFamily: activeFont.stack }}>
          {activeFont.label}
        </span>
        <ChevronDown size={14} />
      </button>

      {open ? (
        <div className="type-popover" role="menu">
          <div className="type-section">
            <div className="type-label">Reading font</div>
            <div className="font-grid">
              {categories.map((category) => (
                <div key={category} className="font-group">
                  <span className="font-group-label">{category}</span>
                  {READING_FONTS.filter((font) => font.category === category).map((font) => (
                    <button
                      key={font.id}
                      type="button"
                      className={"font-option" + (font.id === props.fontId ? " active" : "")}
                      onClick={() => props.onFontId(font.id)}
                    >
                      <span className="font-preview" style={{ fontFamily: font.stack }}>
                        Ag
                      </span>
                      <span className="font-name" style={{ fontFamily: font.stack }}>
                        {font.label}
                      </span>
                      <span className="font-note">{font.note}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <div className="type-section">
            <div className="type-label">Text size · {props.fontSize}px</div>
            <input
              type="range"
              min="15"
              max="26"
              value={props.fontSize}
              onChange={(event) => props.onFontSize(Number(event.target.value))}
            />
          </div>

          <div className="type-row">
            <div className="type-section">
              <div className="type-label">Width</div>
              <Segmented<WidthMode>
                label="Width"
                value={props.widthMode}
                options={[
                  ["narrow", "Narrow"],
                  ["standard", "Standard"],
                  ["wide", "Wide"]
                ]}
                onChange={props.onWidthMode}
              />
            </div>
          </div>

          <div className="type-section">
            <div className="type-label">Page background</div>
            <Segmented<ThemeMode>
              label="Reader surface"
              value={props.themeMode}
              options={[
                ["night", "Night"],
                ["paper", "Paper"],
                ["white", "White"]
              ]}
              onChange={props.onThemeMode}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function InputOutputPanel(props: {
  books: BookSummary[];
  activeBook?: BookDocument;
  selectedBookId?: string;
  isWorking: boolean;
  error?: string;
  stats: Record<string, BookStat>;
  onUpload: (file: File) => void;
  onDemo: () => void;
  onOpenBook: (id: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isOver, setIsOver] = useState(false);
  const [recentOpen, setRecentOpen] = useState(true);

  const handleFile = (file?: File) => {
    if (file) props.onUpload(file);
  };

  return (
    <aside className="side-panel input-panel">
      <section className="panel-section">
        <div className="section-heading">
          <FileInput size={16} />
          <span>Input</span>
        </div>

        <button
          className={`dropzone ${isOver ? "is-over" : ""}`}
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setIsOver(true);
          }}
          onDragLeave={() => setIsOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setIsOver(false);
            handleFile(event.dataTransfer.files.item(0) || undefined);
          }}
        >
          <input
            ref={inputRef}
            hidden
            type="file"
            accept=".pdf,.epub,.txt,.html,.htm,.md,.markdown,application/pdf,application/epub+zip,text/*"
            onChange={(event) => handleFile(event.target.files?.item(0) || undefined)}
          />
          {props.isWorking ? <Loader2 className="spin" size={24} /> : <Upload size={24} />}
          <strong>{props.isWorking ? "Extracting text" : "Upload PDF or book"}</strong>
          <span>PDF, EPUB, TXT, HTML, and Markdown are supported.</span>
        </button>

        <button className="secondary-action" type="button" onClick={props.onDemo} disabled={props.isWorking}>
          <Wand2 size={16} />
          Load sample book
        </button>

        {props.error ? <p className="error-text">{props.error}</p> : null}
      </section>

      <section className="panel-section">
        <div className="section-heading">
          <CheckCircle2 size={16} />
          <span>Output</span>
        </div>
        <OutputStats book={props.activeBook} />
      </section>

      <section className="panel-section recent-section">
        <button className="section-heading collapsible" type="button" onClick={() => setRecentOpen((v) => !v)}>
          <FileText size={16} />
          <span>Recent books</span>
          <span className="recent-badge">{props.books.length}</span>
          <ChevronDown size={15} className={"chevron" + (recentOpen ? " open" : "")} />
        </button>

        {recentOpen ? (
          <div className="recent-list">
            {props.books.length ? (
              props.books.map((book) => (
                <RecentBook
                  key={book.id}
                  book={book}
                  active={book.id === props.selectedBookId}
                  stat={getStat(props.stats, book.id)}
                  onOpen={() => props.onOpenBook(book.id)}
                />
              ))
            ) : (
              <p className="empty-note">Uploaded books will appear here.</p>
            )}
          </div>
        ) : null}
      </section>
    </aside>
  );
}

function RecentBook(props: { book: BookSummary; active: boolean; stat: BookStat; onOpen: () => void }) {
  const { book, stat } = props;
  const progressPct = Math.round(stat.progress * 100);
  return (
    <button className={props.active ? "recent-book active" : "recent-book"} type="button" onClick={props.onOpen}>
      <strong>{book.title}</strong>
      <span className="recent-sub">
        {book.sourceKind.toUpperCase()} · {formatNumber(book.wordCount)} words
      </span>
      <div className="recent-stats">
        <span title="Times opened">
          <Repeat size={11} /> {stat.opens}
        </span>
        <span title="Time spent reading">
          <Clock size={11} /> {formatDuration(stat.secondsRead)}
        </span>
        <span title="Last opened">{formatRelative(stat.lastOpenedAt)}</span>
      </div>
      {progressPct > 0 ? (
        <div className="recent-progress" title={`${progressPct}% read`}>
          <div style={{ width: `${progressPct}%` }} />
        </div>
      ) : null}
    </button>
  );
}

function OutputStats({ book }: { book?: BookDocument }) {
  if (!book) {
    return (
      <div className="stat-grid muted-stats">
        <Metric label="Sections" value="-" />
        <Metric label="Paragraphs" value="-" />
        <Metric label="Words" value="-" />
        <Metric label="Pages" value="-" />
      </div>
    );
  }

  return (
    <>
      <div className="book-mini">
        <strong>{book.title}</strong>
        <span>{book.author || "Unknown author"}</span>
      </div>
      <div className="stat-grid">
        <Metric label="Sections" value={formatNumber(book.sectionCount)} />
        <Metric label="Paragraphs" value={formatNumber(book.paragraphCount)} />
        <Metric label="Words" value={formatNumber(book.wordCount)} />
        <Metric label="Pages" value={book.pageCount ? formatNumber(book.pageCount) : "-"} />
      </div>
      {book.warnings.length ? (
        <div className="warning-box">
          {book.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      ) : null}
    </>
  );
}

function ReaderCanvas(props: {
  stageRef: React.RefObject<HTMLDivElement>;
  book?: BookDocument;
  isLoading: boolean;
  fontSize: number;
  fontId: string;
  widthMode: WidthMode;
  viewMode: ViewMode;
  query: string;
}) {
  const fileUrl = useFileUrl(
    props.book?.id,
    props.viewMode === "original" && Boolean(props.book?.hasOriginal)
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
      <section className="reader-stage" ref={props.stageRef}>
        <div className="reader-empty">
          <Loader2 className="spin" size={32} />
          <strong>Preparing structured output</strong>
          <span>Extracting text, joining broken lines, and building sections.</span>
        </div>
      </section>
    );
  }

  if (!props.book) {
    return (
      <section className="reader-stage" ref={props.stageRef}>
        <div className="reader-empty">
          <BookOpen size={42} />
          <strong>Upload a PDF or book to start reading</strong>
          <span>The output appears as a structured page with outline, metadata, and readable sections.</span>
        </div>
      </section>
    );
  }

  if (props.viewMode === "original" && props.book.hasOriginal) {
    return (
      <section className="reader-stage" ref={props.stageRef}>
        <div className={`document-page width-${props.widthMode} pages-mode`}>
          <div className="pages-head">
            <Files size={16} />
            <span>Original pages · {props.book.pageCount || "?"} pages · images and layout preserved</span>
          </div>
          {fileUrl ? (
            <Suspense
              fallback={
                <div className="pdf-state">
                  <Loader2 className="spin" size={28} />
                  <span>Loading page renderer…</span>
                </div>
              }
            >
              <PdfPageView bookId={props.book.id} fileUrl={fileUrl} />
            </Suspense>
          ) : (
            <div className="pdf-state">
              <Loader2 className="spin" size={28} />
              <span>Opening the original file…</span>
            </div>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="reader-stage" ref={props.stageRef}>
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
          <p>Structured output from {props.book.sourceKind.toUpperCase()}</p>
          <h1>{props.book.title}</h1>
          {props.book.author ? <span>by {props.book.author}</span> : null}
          <dl>
            <div>
              <dt>Source</dt>
              <dd>{props.book.fileName}</dd>
            </div>
            <div>
              <dt>Released</dt>
              <dd>{formatDate(props.book.uploadedAt)}</dd>
            </div>
            <div>
              <dt>Language</dt>
              <dd>{props.book.language || "Not detected"}</dd>
            </div>
            <div>
              <dt>Format</dt>
              <dd>{props.book.sourceKind.toUpperCase()}</dd>
            </div>
          </dl>
        </header>

        <div className="title-page" aria-label="Book title page">
          <span>{props.book.author ? props.book.author : "Book"}</span>
          <h2>{props.book.title}</h2>
          <p>
            {formatNumber(props.book.wordCount)} words in {formatNumber(props.book.sectionCount)} sections
          </p>
        </div>

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
              <Paragraph key={`${section.id}-${index}`} text={paragraph} isMatch={matches.has(`${section.id}-${index}`)} />
            ))}
          </section>
        ))}
      </article>
    </section>
  );
}

// Turn the stored original bytes into a temporary object URL for pdf.js,
// revoking it as soon as the page view goes away.
function useFileUrl(bookId: string | undefined, enabled: boolean): string | undefined {
  const [url, setUrl] = useState<string>();

  useEffect(() => {
    if (!bookId || !enabled) {
      setUrl(undefined);
      return;
    }
    let objectUrl: string | undefined;
    let cancelled = false;
    void getFileBlob(bookId).then((blob) => {
      if (cancelled || !blob) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setUrl(undefined);
    };
  }, [bookId, enabled]);

  return url;
}

// Render code-like blocks (indented listings, symbol soup) in a monospace box so
// the reflowed view stops mangling figures and source listings into prose.
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

function OutlineRail(props: {
  book?: BookDocument;
  activeSectionId?: string;
  onJump: (id: string) => void;
}) {
  return (
    <aside className="side-panel outline-panel">
      <section className="panel-section">
        <div className="section-heading">
          <PanelRight size={16} />
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
                <small>{formatNumber(section.wordCount)}</small>
              </button>
            ))}
          </div>
        ) : (
          <p className="empty-note">The generated section outline will appear after extraction.</p>
        )}
      </section>

      <section className="panel-section">
        <div className="section-heading">
          <BookOpen size={16} />
          <span>Quality</span>
        </div>
        <ul className="quality-list">
          <li>Line breaks normalized</li>
          <li>Code &amp; figures preserved</li>
          <li>Original pages with images</li>
          <li>Searchable output</li>
        </ul>
      </section>

      <button
        className="secondary-action"
        type="button"
        disabled={!props.book}
        onClick={() => window.print()}
      >
        <Download size={16} />
        Print or save
      </button>
    </aside>
  );
}

function Segmented<T extends string>(props: {
  label: string;
  value: T;
  options: Array<[T, string]>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented" aria-label={props.label}>
      {props.options.map(([value, label]) => (
        <button
          key={value}
          type="button"
          className={value === props.value ? "active" : ""}
          onClick={() => props.onChange(value)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
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
