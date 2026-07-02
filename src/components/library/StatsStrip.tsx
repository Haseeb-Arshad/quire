import { BookOpen, Clock, Flame } from "lucide-react";
import type { BookSummary } from "../../lib/types";
import { formatDuration, type BookStat } from "../../lib/readingStats";

export function StatsStrip(props: { books: BookSummary[]; stats: Record<string, BookStat> }) {
  const totalSeconds = Object.values(props.stats).reduce((sum, stat) => sum + stat.secondsRead, 0);
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const openedThisWeek = props.books.filter(
    (book) => (props.stats[book.id]?.lastOpenedAt || 0) > weekAgo
  ).length;
  const mostRead = props.books.reduce<{ title: string; seconds: number } | null>((best, book) => {
    const seconds = props.stats[book.id]?.secondsRead || 0;
    return seconds > (best?.seconds || 0) ? { title: book.title, seconds } : best;
  }, null);

  if (!totalSeconds && !openedThisWeek) return null;

  return (
    <div className="stats-strip">
      <span className="pill tint-butter">
        <Clock size={12} /> {formatDuration(totalSeconds)} read in total
      </span>
      <span className="pill tint-sage">
        <BookOpen size={12} /> {openedThisWeek} {openedThisWeek === 1 ? "book" : "books"} this week
      </span>
      {mostRead && mostRead.seconds >= 60 ? (
        <span className="pill tint-peach">
          <Flame size={12} /> Most read: {truncate(mostRead.title, 34)}
        </span>
      ) : null}
    </div>
  );
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
