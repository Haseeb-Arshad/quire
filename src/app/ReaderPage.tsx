import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import type { ThemeScope } from "../components/reader/ThemeMenu";
import { addSeconds, getStat, loadStats, recordOpen, setProgress } from "../lib/readingStats";
import { TopBar } from "../components/reader/TopBar";
import { ReaderCanvas } from "../components/reader/ReaderCanvas";
import { OutlineRail } from "../components/reader/OutlineRail";
import { ChapterNav } from "../components/reader/ChapterNav";

export function ReaderPage() {
  const { bookId } = useParams({ from: "/books/$bookId" });

  const [fontSize, setFontSize] = useState(() => loadPrefs().global.fontSize);
  const [fontId, setFontId] = useState(() => loadPrefs().global.fontId);
  const [widthMode, setWidthMode] = useState<WidthMode>(() => loadPrefs().global.widthMode);
  const [pageTheme, setPageTheme] = useState<PageTheme>(() => resolveForBook(bookId).pageTheme);
  const [themeScope, setThemeScope] = useState<ThemeScope>(() =>
    loadPrefs().perBook[bookId]?.pageTheme ? "book" : "global"
  );
  const [viewMode, setViewMode] = useState<ViewMode>("reader");
  const [query, setQuery] = useState("");
  const [chapterOpen, setChapterOpen] = useState(false);
  const [activeSectionId, setActiveSectionId] = useState<string | undefined>();
  const [liveProgress, setLiveProgress] = useState(0);

  const stageRef = useRef<HTMLDivElement>(null);

  const bookQuery = useQuery({
    queryKey: ["book", bookId],
    queryFn: () => getBook(bookId),
    enabled: Boolean(bookId)
  });
  const activeBook = bookQuery.data;

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

  // Resume where the reader left off once the book content has rendered.
  const activeBookId = activeBook?.id;
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
