import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useImageBlobUrl } from "../../lib/hooks";

// Inline figure bitmap for the reflowed reader. The aspect-ratio box reserves
// the exact space before the blob resolves, so text never shifts. Clicking
// opens a simple full-screen viewer (stored crops are ≤1600px — no zoom UI).
export function FigureImage({
  imageId,
  width,
  height,
  alt
}: {
  imageId: string;
  width: number;
  height: number;
  alt: string;
}) {
  const url = useImageBlobUrl(imageId);
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="figure-frame"
        style={{ aspectRatio: `${width} / ${height}` }}
        onClick={() => url && setOpen(true)}
        title="View full size"
      >
        {url ? <img src={url} alt={alt} loading="lazy" /> : null}
      </button>
      {open && url ? <FigureLightbox url={url} alt={alt} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function FigureLightbox({ url, alt, onClose }: { url: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="lightbox" onClick={onClose} role="dialog" aria-modal="true" aria-label={alt}>
      <div className="lightbox-bar">
        <span>{alt}</span>
        <button type="button" className="lightbox-close" onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>
      </div>
      <div className="lightbox-scroll" onClick={(event) => event.stopPropagation()}>
        <img className="figure-lightbox-img" src={url} alt={alt} />
      </div>
    </div>
  );
}
