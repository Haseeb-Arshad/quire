import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { BookOpen, Loader2, Moon, Sun, Wand2 } from "lucide-react";
import { createDemoBook, getBooks, importBook } from "../lib/library";
import { getStat, loadStats } from "../lib/readingStats";
import { BookCard } from "../components/library/BookCard";
import { Dropzone } from "../components/library/Dropzone";
import { StatsStrip } from "../components/library/StatsStrip";
import { useAppTheme } from "./AppShell";

export function LibraryPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { appTheme, toggleAppTheme } = useAppTheme();
  const [stats] = useState(() => loadStats());

  const booksQuery = useQuery({ queryKey: ["books"], queryFn: getBooks });

  const openBook = (id: string) => {
    void navigate({ to: "/books/$bookId", params: { bookId: id } });
  };

  const onImported = (book: { id: string }) => {
    void queryClient.invalidateQueries({ queryKey: ["books"] });
    openBook(book.id);
  };

  const importMutation = useMutation({ mutationFn: importBook, onSuccess: onImported });
  const demoMutation = useMutation({ mutationFn: createDemoBook, onSuccess: onImported });

  const books = booksQuery.data || [];
  const isWorking = importMutation.isPending || demoMutation.isPending;
  const error = importMutation.error || demoMutation.error || booksQuery.error;

  return (
    <main className="library-page scroll-area">
      <div className="library-inner">
        <header className="library-head">
          <div className="library-brand">
            <h1>Quire</h1>
            <p>A quiet place to read anything — your books never leave this device.</p>
          </div>
          <div className="library-head-actions">
            <button
              className="icon-button"
              type="button"
              onClick={toggleAppTheme}
              title={appTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              {appTheme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>
        </header>

        <StatsStrip books={books} stats={stats} />

        <Dropzone isWorking={isWorking} onFile={(file) => importMutation.mutate(file)} />

        <div className="dropzone-actions">
          <button
            className="secondary-action"
            type="button"
            onClick={() => demoMutation.mutate()}
            disabled={isWorking}
          >
            <Wand2 size={15} />
            Try a sample book
          </button>
        </div>

        {error instanceof Error ? <p className="error-text">{error.message}</p> : null}

        {books.length ? (
          <>
            <div className="library-section-head">
              <h2>Your library</h2>
              <span className="library-count">{books.length}</span>
            </div>
            <div className="book-grid">
              {books.map((book) => (
                <BookCard
                  key={book.id}
                  book={book}
                  stat={getStat(stats, book.id)}
                  onOpen={() => openBook(book.id)}
                />
              ))}
            </div>
          </>
        ) : booksQuery.isLoading ? (
          <div className="library-working">
            <Loader2 className="spin" size={18} />
            Opening your library…
          </div>
        ) : (
          <div className="library-empty">
            <BookOpen size={40} />
            <h2>Nothing on the shelf yet</h2>
            <p>
              Drop in a PDF, EPUB, or plain-text book above. Quire reflows it into a clean,
              readable page — with the original layout one tap away.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
