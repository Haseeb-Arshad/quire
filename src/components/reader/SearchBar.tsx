import { forwardRef } from "react";
import { ChevronDown, ChevronUp, Search } from "lucide-react";

export const SearchBar = forwardRef<
  HTMLInputElement,
  {
    query: string;
    onQuery: (value: string) => void;
    matchCount: number;
    activeIndex: number;
    onNext: () => void;
    onPrev: () => void;
  }
>(function SearchBar(props, ref) {
  const hasQuery = props.query.trim().length >= 2;
  return (
    <div className="search-box">
      <Search size={15} />
      <input
        ref={ref}
        value={props.query}
        onChange={(event) => props.onQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          if (event.shiftKey) {
            props.onPrev();
          } else {
            props.onNext();
          }
        }}
        placeholder="Find in book  ( / )"
        aria-label="Find in book"
      />
      {hasQuery ? (
        <>
          <span className="search-count" aria-live="polite">
            {props.matchCount ? `${props.activeIndex + 1}/${props.matchCount}` : "0"}
          </span>
          <button
            type="button"
            className="search-step"
            onClick={props.onPrev}
            disabled={!props.matchCount}
            aria-label="Previous match"
          >
            <ChevronUp size={14} />
          </button>
          <button
            type="button"
            className="search-step"
            onClick={props.onNext}
            disabled={!props.matchCount}
            aria-label="Next match"
          >
            <ChevronDown size={14} />
          </button>
        </>
      ) : null}
    </div>
  );
});
