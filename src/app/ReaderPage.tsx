import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getBook } from "../lib/library";
import {
  loadPrefs,
  resolveForBook,
  updateBookPrefs,
  updateGlobalPrefs,
  type FlowMode,
  type PageTheme,
  type ViewMode,
  type WidthMode
} from "../lib/preferences";
import { addSeconds, recordOpen, setProgress } from "../lib/readingStats";
import { runSearch } from "../lib/search";
import {
  addBookmark,
  addHighlights,
  addPageBookmark,
  addPageHighlights,
  deleteAnnotation,
  getAnnotations,
  updateAnnotationNote
} from "../lib/annotations";
import type { Annotation, HighlightColor } from "../lib/types";
import type { PageSelectionDraft, SelectionDraft } from "../lib/anchors";
import { TopBar } from "../components/reader/TopBar";
import { ReaderCanvas } from "../components/reader/ReaderCanvas";
import { OutlinePanel } from "../components/reader/OutlinePanel";
import { NotesAppearancePanel } from "../components/reader/NotesAppearancePanel";
import { ChapterNav } from "../components/reader/ChapterNav";
import { ShortcutsDialog } from "../components/reader/ShortcutsDialog";
import type { ThemeScope } from "../components/reader/ThemeMenu";

export function ReaderPage() {
  const { bookId } = useParams({ from: "/books/$bookId" });
  const queryClient = useQueryClient();

  const [fontSize, setFontSize] = useState(() => loadPrefs().global.fontSize);
  const [fontId, setFontId] = useState(() => loadPrefs().global.fontId);
  const [widthMode, setWidthMode] = useState<WidthMode>(() => loadPrefs().global.widthMode);
  const [pageTheme, setPageTheme] = useState<PageTheme>(() => resolveForBook(bookId).pageTheme);
  const [themeScope, setThemeScope] = useState<ThemeScope>(() =>
    loadPrefs().perBook[bookId]?.pageTheme ? "book" : "global"
  );
  const [flowMode, setFlowMode] = useState<FlowMode>(() => resolveForBook(bookId).flowMode);
  const [viewMode, setViewModeState] = useState<ViewMode>(
    () => resolveForBook(bookId).viewMode ?? "reader"
  );
  const [leftRailOpen, setLeftRailOpen] = useState(() => loadPrefs().global.leftRailOpen);
  const [rightRailOpen, setRightRailOpen] = useState(() => loadPrefs().global.rightRailOpen);
  const [activeChapterIndex, setActiveChapterIndex] = useState(-1);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [chapterOpen, setChapterOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [scrollSectionId, setScrollSectionId] = useState<string | undefined>();
  const [liveProgress, setLiveProgress] = useState(0);

  const stageRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  // Resume anchor waiting for its chapter to render (paged mode restore).
  const pendingAnchorRef = useRef<{ sectionId: string; paraIndex: number } | null>(null);
  // Last page on screen in the original-pages view (1-based).
  const currentPageRef = useRef(1);
  const pageResumeTimer = useRef<number>();
  const [pdfJump, setPdfJump] = useState<{ page: number; nonce: number } | null>(null);

  const bookQuery = useQuery({
    queryKey: ["book", bookId],
    queryFn: () => getBook(bookId),
    enabled: Boolean(bookId)
  });
  const activeBook = bookQuery.data;

  const annotationsQuery = useQuery({
    queryKey: ["annotations", bookId],
    queryFn: () => getAnnotations(bookId),
    enabled: Boolean(bookId)
  });
  const annotations: Annotation[] = annotationsQuery.data || [];

  const invalidateAnnotations = () =>
    queryClient.invalidateQueries({ queryKey: ["annotations", bookId] });

  const highlightMutation = useMutation({
    mutationFn: ({ drafts, color }: { drafts: SelectionDraft[]; color: HighlightColor }) =>
      addHighlights(bookId, drafts, color),
    onSuccess: invalidateAnnotations
  });

  const bookmarkMutation = useMutation({
    mutationFn: (input: { sectionId: string; paraIndex: number; label: string }) =>
      addBookmark(bookId, input.sectionId, input.paraIndex, input.label),
    onSuccess: invalidateAnnotations
  });

  const pageHighlightMutation = useMutation({
    mutationFn: ({ drafts, color }: { drafts: PageSelectionDraft[]; color: HighlightColor }) =>
      addPageHighlights(bookId, drafts, color),
    onSuccess: invalidateAnnotations
  });

  const pageBookmarkMutation = useMutation({
    mutationFn: (input: { page: number; label: string }) =>
      addPageBookmark(bookId, input.page, input.label),
    onSuccess: invalidateAnnotations
  });

  const noteMutation = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) => updateAnnotationNote(id, note),
    onSuccess: invalidateAnnotations
  });

  const deleteAnnotationMutation = useMutation({
    mutationFn: deleteAnnotation,
    onSuccess: invalidateAnnotations
  });

  /* ------------------------------- search ------------------------------ */

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 200);
    return () => window.clearTimeout(timer);
  }, [query]);

  const searchMatches = useMemo(
    () => runSearch(activeBook, debouncedQuery),
    [activeBook, debouncedQuery]
  );

  useEffect(() => {
    setActiveMatchIndex(0);
  }, [searchMatches]);

  const stepMatch = (delta: number) => {
    if (!searchMatches.length) return;
    setActiveMatchIndex((index) => (index + delta + searchMatches.length) % searchMatches.length);
  };

  // Paged mode: the active match may live in another chapter — switch first,
  // then ReaderCanvas centers the mark once that chapter has rendered.
  useEffect(() => {
    if (flowMode !== "paged" || !activeBook || !searchMatches.length) return;
    const match = searchMatches[activeMatchIndex];
    if (!match) return;
    const index = activeBook.sections.findIndex((section) => section.id === match.sectionId);
    if (index >= 0 && index !== activeChapterIndex) setActiveChapterIndex(index);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMatchIndex, searchMatches, flowMode, activeBook]);

  /* --------------------------- prefs + modes --------------------------- */

  // Persist reader preferences whenever they change (debounced in the lib).
  // The page theme persists through its own handlers so it can scope per-book.
  useEffect(() => {
    updateGlobalPrefs({ fontId, fontSize, widthMode });
  }, [fontId, fontSize, widthMode]);

  const onPageTheme = (theme: PageTheme) => {
    setPageTheme(theme);
    if (themeScope === "book") {
      updateBookPrefs(bookId, { pageTheme: theme });
    } else {
      updateGlobalPrefs({ pageTheme: theme });
    }
  };

  const onThemeScope = (scope: ThemeScope) => {
    setThemeScope(scope);
    if (scope === "book") {
      updateBookPrefs(bookId, { pageTheme });
    } else {
      updateBookPrefs(bookId, { pageTheme: undefined });
      setPageTheme(loadPrefs().global.pageTheme);
    }
  };

  const onFlowMode = (mode: FlowMode) => {
    setFlowMode(mode);
    updateGlobalPrefs({ flowMode: mode });
    if (mode === "paged" && activeBook) {
      // Land on the chapter that was on screen in the continuous flow.
      const index = activeBook.sections.findIndex((section) => section.id === scrollSectionId);
      setActiveChapterIndex(index >= 0 ? index : 0);
    }
  };

  const setViewMode = (mode: ViewMode) => {
    setViewModeState(mode);
    updateBookPrefs(bookId, { viewMode: mode });
  };

  const toggleLeftRail = () => {
    setLeftRailOpen((open) => {
      updateGlobalPrefs({ leftRailOpen: !open });
      return !open;
    });
  };

  const toggleRightRail = () => {
    setRightRailOpen((open) => {
      updateGlobalPrefs({ rightRailOpen: !open });
      return !open;
    });
  };

  /* ------------------------- per-book lifecycle ------------------------ */

  // Count a fresh open + reset transient state for each book.
  useEffect(() => {
    if (!bookId) return;
    recordOpen(bookId);
    setViewModeState(resolveForBook(bookId).viewMode ?? "reader");
    setFlowMode(resolveForBook(bookId).flowMode);
    setScrollSectionId(undefined);
    setActiveChapterIndex(-1);
    setPdfJump(null);
    currentPageRef.current = 1;
    setQuery("");
    setPageTheme(resolveForBook(bookId).pageTheme);
    setThemeScope(loadPrefs().perBook[bookId]?.pageTheme ? "book" : "global");
  }, [bookId]);

  // Resume where the reader left off once the book content is available.
  const activeBookId = activeBook?.id;
  useEffect(() => {
    if (!activeBookId || !activeBook) return;
    const resume = loadPrefs().perBook[activeBookId]?.resume;
    const meaningful = resume && resume.ratio > 0.005;

    if (resolveForBook(activeBookId).flowMode === "paged") {
      if (meaningful && resume.sectionId) {
        const index = activeBook.sections.findIndex((section) => section.id === resume.sectionId);
        if (index >= 0) {
          if (resume.paraIndex !== undefined) {
            pendingAnchorRef.current = { sectionId: resume.sectionId, paraIndex: resume.paraIndex };
          }
          setActiveChapterIndex(index);
          return;
        }
      }
      setActiveChapterIndex(-1);
      return;
    }

    // Continuous flow: paragraph anchor first, scroll ratio as the fallback.
    const stage = stageRef.current;
    if (!stage) return;
    requestAnimationFrame(() => {
      if (meaningful && resume.sectionId !== undefined && resume.paraIndex !== undefined) {
        const anchor = stage.querySelector<HTMLElement>(
          `[data-section-id="${CSS.escape(resume.sectionId)}"][data-para="${resume.paraIndex}"]`
        );
        if (anchor) {
          anchor.scrollIntoView({ block: "start" });
          return;
        }
      }
      const max = stage.scrollHeight - stage.clientHeight;
      stage.scrollTo({ top: meaningful ? resume.ratio * max : 0 });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBookId]);

  // Paged mode: whenever the chapter changes, land at its top — or at the
  // recorded resume paragraph on the first render after opening.
  useEffect(() => {
    if (flowMode !== "paged") return;
    const stage = stageRef.current;
    if (!stage) return;
    const pending = pendingAnchorRef.current;
    pendingAnchorRef.current = null;
    requestAnimationFrame(() => {
      if (pending) {
        const anchor = stage.querySelector<HTMLElement>(
          `[data-section-id="${CSS.escape(pending.sectionId)}"][data-para="${pending.paraIndex}"]`
        );
        if (anchor) {
          anchor.scrollIntoView({ block: "start" });
          return;
        }
      }
      stage.scrollTo({ top: 0 });
    });
  }, [activeChapterIndex, flowMode]);

  // Time-on-book: accrue reading seconds while the tab is visible.
  useEffect(() => {
    if (!bookId) return;
    let pending = 0;
    const tick = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      pending += 1;
      if (pending >= 5) {
        addSeconds(bookId, pending);
        pending = 0;
      }
    }, 1000);
    return () => {
      window.clearInterval(tick);
      if (pending > 0) addSeconds(bookId, pending);
    };
  }, [bookId]);

  // Track scroll-through progress, the on-screen chapter, and the resume anchor.
  const sectionCount = activeBook?.sections.length || 0;
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !activeBook || viewMode !== "reader") return;
    const paged = flowMode === "paged";

    let anchorTimer: number | undefined;
    const recordAnchor = () => {
      anchorTimer = undefined;
      const top = topmostParagraph(stage);
      const max = stage.scrollHeight - stage.clientHeight;
      const ratio = max > 0 ? stage.scrollTop / max : 0;
      updateBookPrefs(activeBook.id, {
        resume: top
          ? { sectionId: top.dataset.sectionId, paraIndex: Number(top.dataset.para), ratio }
          : { ratio }
      });
    };

    const onScroll = () => {
      const max = stage.scrollHeight - stage.clientHeight;
      const inStage = max > 0 ? stage.scrollTop / max : 0;
      // Paged mode: overall progress blends chapter position with the
      // within-chapter scroll; the cover counts as zero.
      const overall = paged
        ? sectionCount > 0
          ? Math.max(0, (activeChapterIndex + inStage)) / sectionCount
          : 0
        : inStage;
      setProgress(activeBook.id, overall);
      setLiveProgress(overall);
      if (anchorTimer === undefined) {
        anchorTimer = window.setTimeout(recordAnchor, 500);
      }
    };
    onScroll();
    stage.addEventListener("scroll", onScroll, { passive: true });

    let observer: IntersectionObserver | undefined;
    if (!paged) {
      const sections = Array.from(stage.querySelectorAll<HTMLElement>(".book-section[id]"));
      observer = new IntersectionObserver(
        (entries) => {
          const onTop = entries
            .filter((entry) => entry.isIntersecting)
            .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
          if (onTop) setScrollSectionId(onTop.target.id);
        },
        { root: stage, rootMargin: "-10% 0px -80% 0px" }
      );
      sections.forEach((section) => observer?.observe(section));
    }

    return () => {
      stage.removeEventListener("scroll", onScroll);
      if (anchorTimer !== undefined) window.clearTimeout(anchorTimer);
      observer?.disconnect();
    };
  }, [activeBook, viewMode, flowMode, activeChapterIndex, sectionCount]);

  // The chapter on screen: derived directly in paged mode, observed in scroll.
  const activeSectionId =
    flowMode === "paged"
      ? activeChapterIndex >= 0
        ? activeBook?.sections[activeChapterIndex]?.id
        : undefined
      : scrollSectionId;

  /* ------------------------------ shortcuts ---------------------------- */

  const bookmarkHere = () => {
    if (!activeBook) return;
    if (viewMode === "original") {
      const page = currentPageRef.current;
      pageBookmarkMutation.mutate({ page, label: `Page ${page}` });
      return;
    }
    const stage = stageRef.current;
    if (!stage) return;
    const top = topmostParagraph(stage);
    if (!top?.dataset.sectionId) return;
    bookmarkMutation.mutate({
      sectionId: top.dataset.sectionId,
      paraIndex: Number(top.dataset.para),
      label: (top.textContent || "").trim().slice(0, 80)
    });
  };

  // Original-pages view: track the visible page for progress, resume and
  // page bookmarks. Persisting is debounced like the reader's anchor.
  const onVisiblePage = (page: number) => {
    currentPageRef.current = page;
    const count = activeBook?.pageCount || 0;
    if (count > 0) {
      const ratio = page / count;
      setLiveProgress(ratio);
      setProgress(bookId, ratio);
    }
    window.clearTimeout(pageResumeTimer.current);
    pageResumeTimer.current = window.setTimeout(() => {
      const previous = loadPrefs().perBook[bookId]?.resume;
      updateBookPrefs(bookId, { resume: { ratio: previous?.ratio ?? 0, ...previous, page } });
    }, 500);
  };

  const selectChapter = (index: number) => {
    if (!activeBook) return;
    setActiveChapterIndex(Math.max(-1, Math.min(index, activeBook.sections.length - 1)));
  };

  const stepChapter = (delta: number) => {
    if (!activeBook) return;
    if (flowMode === "paged") {
      selectChapter(activeChapterIndex + delta);
      return;
    }
    const sections = activeBook.sections;
    const currentIndex = Math.max(
      0,
      sections.findIndex((section) => section.id === activeSectionId)
    );
    const next = sections[currentIndex + delta];
    if (next) jumpToChapter(next.id);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      switch (event.key) {
        case "c":
        case "C":
          if (activeBook) {
            event.preventDefault();
            setChapterOpen(true);
          }
          break;
        case "/":
          event.preventDefault();
          searchRef.current?.focus();
          break;
        case "b":
        case "B":
          event.preventDefault();
          bookmarkHere();
          break;
        case "[":
          event.preventDefault();
          stepChapter(-1);
          break;
        case "]":
          event.preventDefault();
          stepChapter(1);
          break;
        case "ArrowLeft":
          if (flowMode === "paged" && viewMode === "reader") {
            event.preventDefault();
            stepChapter(-1);
          }
          break;
        case "ArrowRight":
          if (flowMode === "paged" && viewMode === "reader") {
            event.preventDefault();
            stepChapter(1);
          }
          break;
        case "?":
          event.preventDefault();
          setShortcutsOpen(true);
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const jumpToChapter = (id: string) => {
    setChapterOpen(false);
    if (viewMode !== "reader") setViewMode("reader");
    if (flowMode === "paged" && activeBook) {
      const index = activeBook.sections.findIndex((section) => section.id === id);
      if (index >= 0) selectChapter(index);
      return;
    }
    requestAnimationFrame(() => {
      const el = stageRef.current?.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const jumpToAnnotation = (annotation: Annotation) => {
    if (annotation.kind === "page-highlight" || annotation.kind === "page-bookmark") {
      // Page annotations live on the original-pages view.
      if (viewMode !== "original") setViewMode("original");
      setPdfJump((previous) => ({ page: annotation.page, nonce: (previous?.nonce || 0) + 1 }));
      return;
    }
    if (viewMode !== "reader") setViewMode("reader");
    if (flowMode === "paged" && activeBook) {
      const index = activeBook.sections.findIndex((section) => section.id === annotation.sectionId);
      if (index >= 0 && index !== activeChapterIndex) setActiveChapterIndex(index);
    }
    requestAnimationFrame(() => {
      const el = stageRef.current?.querySelector<HTMLElement>(
        `[data-section-id="${CSS.escape(annotation.sectionId)}"][data-para="${annotation.paraIndex}"]`
      );
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  return (
    <main className="reader-shell" data-page-theme={pageTheme}>
      <TopBar
        title={activeBook?.title}
        author={activeBook?.author}
        viewMode={viewMode}
        hasOriginal={Boolean(activeBook?.hasOriginal)}
        canNavigate={Boolean(activeBook)}
        progress={liveProgress}
        onViewMode={setViewMode}
        onOpenChapters={() => setChapterOpen(true)}
        query={query}
        onQuery={setQuery}
        matchCount={searchMatches.length}
        activeMatchIndex={activeMatchIndex}
        onNextMatch={() => stepMatch(1)}
        onPrevMatch={() => stepMatch(-1)}
        searchRef={searchRef}
      />

      <ReaderCanvas
        stageRef={stageRef}
        book={activeBook}
        isLoading={bookQuery.isFetching}
        fontSize={fontSize}
        fontId={fontId}
        widthMode={widthMode}
        viewMode={viewMode}
        pageTheme={pageTheme}
        flowMode={flowMode}
        activeChapterIndex={activeChapterIndex}
        onChapterSelect={selectChapter}
        searchMatches={searchMatches}
        activeMatchIndex={activeMatchIndex}
        annotations={annotations}
        onHighlight={(drafts, color) => highlightMutation.mutate({ drafts, color })}
        onPageHighlight={(drafts, color) => pageHighlightMutation.mutate({ drafts, color })}
        onDeleteAnnotation={(id) => deleteAnnotationMutation.mutate(id)}
        onSaveNote={(id, note) => noteMutation.mutate({ id, note })}
        onVisiblePage={onVisiblePage}
        initialPage={loadPrefs().perBook[bookId]?.resume?.page}
        pdfJump={pdfJump}
      />

      <button
        type="button"
        className={"edge-toggle edge-toggle-left" + (leftRailOpen ? " open" : "")}
        onClick={toggleLeftRail}
        title={leftRailOpen ? "Hide contents" : "Show contents"}
        aria-expanded={leftRailOpen}
      >
        <ChevronRight size={15} />
      </button>

      <button
        type="button"
        className={"edge-toggle edge-toggle-right" + (rightRailOpen ? " open" : "")}
        onClick={toggleRightRail}
        title={rightRailOpen ? "Hide notes & appearance" : "Show notes & appearance"}
        aria-expanded={rightRailOpen}
      >
        <ChevronLeft size={15} />
      </button>

      {leftRailOpen ? (
        <OutlinePanel
          book={activeBook}
          activeSectionId={activeSectionId}
          onJump={jumpToChapter}
          onClose={toggleLeftRail}
        />
      ) : null}

      {rightRailOpen ? (
        <NotesAppearancePanel
          book={activeBook}
          annotations={annotations}
          onJumpToAnnotation={jumpToAnnotation}
          onDeleteAnnotation={(id) => deleteAnnotationMutation.mutate(id)}
          onSaveNote={(id, note) => noteMutation.mutate({ id, note })}
          onClose={toggleRightRail}
          fontId={fontId}
          fontSize={fontSize}
          widthMode={widthMode}
          onFontId={setFontId}
          onFontSize={setFontSize}
          onWidthMode={setWidthMode}
          pageTheme={pageTheme}
          onPageTheme={onPageTheme}
          themeScope={themeScope}
          onThemeScope={onThemeScope}
          flowMode={flowMode}
          onFlowMode={onFlowMode}
        />
      ) : null}

      {chapterOpen && activeBook ? (
        <ChapterNav
          book={activeBook}
          activeSectionId={activeSectionId}
          onJump={jumpToChapter}
          onClose={() => setChapterOpen(false)}
        />
      ) : null}

      {shortcutsOpen ? <ShortcutsDialog onClose={() => setShortcutsOpen(false)} /> : null}
    </main>
  );
}

function topmostParagraph(stage: HTMLElement): HTMLElement | null {
  const stageTop = stage.getBoundingClientRect().top;
  const paragraphs = stage.querySelectorAll<HTMLElement>("[data-para]");
  for (const paragraph of paragraphs) {
    if (paragraph.getBoundingClientRect().bottom > stageTop + 12) return paragraph;
  }
  return null;
}
