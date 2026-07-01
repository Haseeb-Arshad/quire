import { useEffect, useRef, useState } from "react";
import { Loader2, Maximize2, Minus, Plus, X } from "lucide-react";
import { pdfjsLib, type PDFDocumentProxy, type RenderTask } from "../../lib/pdf";

export function PdfPageView({ bookId, fileUrl }: { bookId: string; fileUrl: string }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");
  const [lightboxPage, setLightboxPage] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let loaded: PDFDocumentProxy | null = null;
    setStatus("loading");
    const task = pdfjsLib.getDocument({ url: fileUrl });
    task.promise.then(
      (pdf) => {
        if (cancelled) {
          void pdf.destroy();
          return;
        }
        loaded = pdf;
        setDoc(pdf);
        setStatus("ready");
      },
      (error: unknown) => {
        if (cancelled) return;
        setMessage(error instanceof Error ? error.message : "Could not render this PDF.");
        setStatus("error");
      }
    );
    return () => {
      cancelled = true;
      void task.destroy();
      if (loaded) void loaded.destroy();
    };
    // Re-run only when the source document changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, fileUrl]);

  if (status === "loading") {
    return (
      <div className="pdf-state">
        <Loader2 className="spin" size={28} />
        <span>Rendering original pages…</span>
      </div>
    );
  }

  if (status === "error" || !doc) {
    return (
      <div className="pdf-state">
        <span>Original page view unavailable.</span>
        <small>{message}</small>
      </div>
    );
  }

  return (
    <div className="pdf-pages">
      {Array.from({ length: doc.numPages }, (_, index) => (
        <PdfPage key={index + 1} doc={doc} pageNumber={index + 1} onOpen={setLightboxPage} />
      ))}
      {lightboxPage !== null ? (
        <PdfLightbox doc={doc} pageNumber={lightboxPage} onClose={() => setLightboxPage(null)} />
      ) : null}
    </div>
  );
}

function PdfPage({
  doc,
  pageNumber,
  onOpen
}: {
  doc: PDFDocumentProxy;
  pageNumber: number;
  onOpen: (page: number) => void;
}) {
  const holderRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [rendered, setRendered] = useState(false);
  const [visible, setVisible] = useState(false);

  // Only paint a page once it scrolls near the viewport — keeps big PDFs light.
  useEffect(() => {
    const holder = holderRef.current;
    if (!holder) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "600px 0px" }
    );
    observer.observe(holder);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || rendered) return;
    let cancelled = false;
    let task: RenderTask | null = null;

    (async () => {
      const page = await doc.getPage(pageNumber);
      const canvas = canvasRef.current;
      const holder = holderRef.current;
      if (!canvas || !holder || cancelled) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const baseViewport = page.getViewport({ scale: 1 });
      const targetWidth = holder.clientWidth || 820;
      const scale = targetWidth / baseViewport.width;
      const viewport = page.getViewport({ scale: scale * dpr });

      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = "100%";
      canvas.style.aspectRatio = `${baseViewport.width} / ${baseViewport.height}`;

      const context = canvas.getContext("2d");
      if (!context) return;
      task = page.render({ canvasContext: context, viewport });
      try {
        await task.promise;
        if (!cancelled) setRendered(true);
      } catch {
        /* render cancelled on unmount */
      }
    })();

    return () => {
      cancelled = true;
      if (task) task.cancel();
    };
  }, [visible, rendered, doc, pageNumber]);

  return (
    <div className="pdf-page" ref={holderRef}>
      <div className="pdf-page-tools">
        <span className="pdf-page-num">Page {pageNumber}</span>
        <button type="button" className="pdf-open" onClick={() => onOpen(pageNumber)} aria-label="Open page">
          <Maximize2 size={14} />
        </button>
      </div>
      <button type="button" className="pdf-canvas-btn" onClick={() => onOpen(pageNumber)}>
        <canvas ref={canvasRef} className="pdf-canvas" />
        {!rendered ? (
          <span className="pdf-canvas-skeleton">
            <Loader2 className="spin" size={20} />
          </span>
        ) : null}
      </button>
    </div>
  );
}

function PdfLightbox({
  doc,
  pageNumber,
  onClose
}: {
  doc: PDFDocumentProxy;
  pageNumber: number;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1.6);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "+" || event.key === "=") setZoom((z) => Math.min(4, z + 0.25));
      if (event.key === "-") setZoom((z) => Math.max(0.5, z - 0.25));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    let task: RenderTask | null = null;
    (async () => {
      const page = await doc.getPage(pageNumber);
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: zoom * dpr });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${viewport.width / dpr}px`;
      const context = canvas.getContext("2d");
      if (!context) return;
      task = page.render({ canvasContext: context, viewport });
      try {
        await task.promise;
      } catch {
        /* cancelled */
      }
    })();
    return () => {
      cancelled = true;
      if (task) task.cancel();
    };
  }, [doc, pageNumber, zoom]);

  return (
    <div className="lightbox" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="lightbox-bar" onClick={(event) => event.stopPropagation()}>
        <span>Page {pageNumber}</span>
        <div className="lightbox-zoom">
          <button type="button" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} aria-label="Zoom out">
            <Minus size={15} />
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => setZoom((z) => Math.min(4, z + 0.25))} aria-label="Zoom in">
            <Plus size={15} />
          </button>
        </div>
        <button type="button" className="lightbox-close" onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>
      </div>
      <div className="lightbox-scroll" onClick={(event) => event.stopPropagation()}>
        <canvas ref={canvasRef} className="lightbox-canvas" />
      </div>
    </div>
  );
}
