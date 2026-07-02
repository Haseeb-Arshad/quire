import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { getBook } from "../lib/library";
import {
  loadPrefs,
  resolveForBook,
  updateBookPrefs,
  updateGlobalPrefs,
  type PageTheme,
  type ViewMode,
  type WidthMode
} from "../lib/preferences";
import { addSeconds, recordOpen, setProgress } from "../lib/readingStats";
import { runSearch } from "../lib/search";
import { addBookmark, addHighlights, deleteAnnotation, getAnnotations } from "../lib/annotations";
import type { Annotation, HighlightColor } from "../lib/types";
import type { SelectionDraft } from "../lib/anchors";
import { TopBar } from "../components/reader/TopBar";
import { ReaderCanvas } from "../components/reader/ReaderCanvas";
import { OutlineRail } from "../components/reader/OutlineRail";
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
  const [viewMode, setViewMode] = useState<ViewMode>("reader");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [chapterOpen, setChapterOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [activeSectionId, setActiveSectionId] = useState<string | undefined>();
  const [liveProgress, setLiveProgress] = useState(0);

  const stageRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

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

  /* --------------------------- prefs + themes -------------------------- */

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

  /* ------------------------- per-book lifecycle ------------------------ */

  // Count a fresh open + reset transient state for each book.
  useEffect(() => {
    if (!bookId) return;
    recordOpen(bookId);
    setViewMode("reader");
    setActiveSectionId(undefined);
    setQuery("");
    setPageTheme(resolveForBook(bookId).pageTheme);
    setThemeScope(loadPrefs().perBook[bookId]?.pageTheme ? "book" : "global");
  }, [bookId]);

  // Resume where the reader left off once the book content has rendered:
  // paragraph anchor first, scroll ratio as the fallback.
  const activeBookId = activeBook?.id;
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !activeBookId) return;
    const resume = loadPrefs().perBook[activeBookId]?.resume;
    requestAnimationFrame(() => {
      if (resume?.sectionId !== undefined && resume.paraIndex !== undefined) {
        const anchor = stage.querySelector<HTMLElement>(
          `[data-section-id="${CSS.escape(resume.sectionId)}"][data-para="${resume.paraIndex}"]`
        );
        if (anchor && resume.ratio > 0.005) {
          anchor.scrollIntoView({ block: "start" });
          return;
        }
      }
      const max = stage.scrollHeight - stage.clientHeight;
      stage.scrollTo({ top: resume && resume.ratio > 0.005 ? resume.ratio * max : 0 });
    });
  }, [activeBookId]);

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
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !activeBook || viewMode !== "reader") return;

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
      const ratio = max > 0 ? stage.scrollTop / max : 0;
      setProgress(activeBook.id, ratio);
      setLiveProgress(ratio);
      if (anchorTimer === undefined) {
        anchorTimer = window.setTimeout(recordAnchor, 500);
      }
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
      if (anchorTimer !== undefined) window.clearTimeout(anchorTimer);
      observer.disconnect();
    };
  }, [activeBook, viewMode]);

  /* ------------------------------ shortcuts ---------------------------- */

  const bookmarkHere = () => {
    const stage = stageRef.current;
    if (!stage || !activeBook) return;
    const top = topmostParagraph(stage);
    if (!top?.dataset.sectionId) return;
    bookmarkMutation.mutate({
      sectionId: top.dataset.sectionId,
      paraIndex: Number(top.dataset.para),
      label: (top.textContent || "").trim().slice(0, 80)
    });
  };

  const stepChapter = (delta: number) => {
    if (!activeBook) return;
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
    requestAnimationFrame(() => {
      const el = stageRef.current?.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const jumpToAnnotation = (annotation: Annotation) => {
    if (viewMode !== "reader") setViewMode("reader");
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
        fontSize={fontSize}
        fontId={fontId}
        widthMode={widthMode}
        pageTheme={pageTheme}
        viewMode={viewMode}
        hasOriginal={Boolean(activeBook?.hasOriginal)}
        canNavigate={Boolean(activeBook)}
        progress={liveProgress}
        onFontSize={setFontSize}
        onFontId={setFontId}
        onWidthMode={setWidthMode}
        onPageTheme={onPageTheme}
        themeScope={themeScope}
        onThemeScope={onThemeScope}
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
        searchMatches={searchMatches}
        activeMatchIndex={activeMatchIndex}
        annotations={annotations}
        onHighlight={(drafts, color) => highlightMutation.mutate({ drafts, color })}
      />

      <OutlineRail
        book={activeBook}
        activeSectionId={activeSectionId}
        annotations={annotations}
        onJump={jumpToChapter}
        onJumpToAnnotation={jumpToAnnotation}
        onDeleteAnnotation={(id) => deleteAnnotationMutation.mutate(id)}
      />

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
