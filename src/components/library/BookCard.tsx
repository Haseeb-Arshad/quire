import { Clock, Repeat } from "lucide-react";
import type { BookSummary } from "../../lib/types";
import type { BookStat } from "../../lib/readingStats";
import { formatDuration, formatRelative } from "../../lib/readingStats";
import { getCoverBlob } from "../../lib/library";
import { useBlobUrl } from "../../lib/hooks";

export function BookCard(props: { book: BookSummary; stat: BookStat; onOpen: () => void }) {
  const { book, stat } = props;
  const coverUrl = useBlobUrl(book.id, true, getCoverBlob);
  const progressPct = Math.round(stat.progress * 100);
  const tint = book.coverTint || "butter";

  return (
    <button type="button" className="book-card" onClick={props.onOpen}>
      <span className={`book-card-cover tint-${tint}`}>
        {coverUrl ? <img src={coverUrl} alt="" loading="lazy" /> : null}
      </span>

      <span className="book-card-title">
        <span className={`tint-dot tint-${tint}`} aria-hidden />
        {book.title}
      </span>
      <span className="book-card-author">{book.author || "Unknown author"}</span>

      <span className="book-card-meta">
        <span className={`pill tint-${tint}`}>{book.sourceKind.toUpperCase()}</span>
        <span className="pill tint-plain">{formatNumber(book.wordCount)} words</span>
        {progressPct > 0 ? <span className="pill tint-plain">{progressPct}% read</span> : null}
      </span>

      <span className="book-card-stats">
        <span title="Times opened">
          <Repeat size={11} /> {stat.opens}
        </span>
        <span title="Time spent reading">
          <Clock size={11} /> {formatDuration(stat.secondsRead)}
        </span>
        <span title="Last opened">{formatRelative(stat.lastOpenedAt)}</span>
      </span>

      {progressPct > 0 ? (
        <span className="book-card-progress" aria-hidden>
          <div style={{ width: `${progressPct}%` }} />
        </span>
      ) : null}
    </button>
  );
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en").format(value);
}
