import { useEffect, useRef, useState } from "react";
import { Loader2, Maximize2, Minus, Plus, X } from "lucide-react";
import { pdfjsLib, type PDFDocumentProxy, type RenderTask } from "../../lib/pdf";
import { blitThemed } from "../../lib/pdfFilters";
import type { PageTheme } from "../../lib/preferences";

export function PdfPageView({
  bookId,
  fileUrl,
  pageTheme
}: {
  bookId: string;
  fileUrl: string;
  pageTheme: PageTheme;
}) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");
  const [lightboxPage, setLightboxPage] = useState<number | null>(null);
  const [renderWidth, setRenderWidth] = useState(0);
  const pagesRef = useRef<HTMLDivElement>(null);
  const filter = pageTheme;

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

  // One observer for the whole pages container: pages re-render (sharp, not
  // stretched) whenever the available width settles on a new value.
  useEffect(() => {
    const el = pagesRef.current;
    if (!el || status !== "ready") return;
    let timer: number | undefined;
    const observer = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setRenderWidth(el.clientWidth), 150);
    });
    observer.observe(el);
    setRenderWidth(el.clientWidth);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [status]);

  if (status === "loading") {
    return (
      <div className="pdf-state">
        <Loader2 className="spin" size={26} />
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
    <div className="pdf-pages" ref={pagesRef}>
      {Array.from({ length: doc.numPages }, (_, index) => (
        <PdfPage
          key={index + 1}
          doc={doc}
          pageNumber={index + 1}
          renderWidth={renderWidth}
          filter={filter}
          onOpen={setLightboxPage}
        />
      ))}
      {lightboxPage !== null ? (
        <PdfLightbox
          doc={doc}
          pageNumber={lightboxPage}
          filter={filter}
          onClose={() => setLightboxPage(null)}
        />
      ) : null}
    </div>
  );
}

function PdfPage({
  doc,
  pageNumber,
  renderWidth,
  filter,
  onOpen
}: {
  doc: PDFDocumentProxy;
  pageNumber: number;
  renderWidth: number;
  filter: PageTheme;
  onOpen: (page: number) => void;
}) {
  const holderRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [painted, setPainted] = useState(false);
  const [inRenderBand, setInRenderBand] = useState(false);
  const [inKeepBand, setInKeepBand] = useState(true);

  // Two bands around the viewport: paint pages near it, free bitmaps for
  // pages far outside it so 1000-page documents stay within memory.
  useEffect(() => {
    const holder = holderRef.current;
    if (!holder) return;
    const renderObserver = new IntersectionObserver(
      (entries) => setInRenderBand(entries.some((entry) => entry.isIntersecting)),
      { rootMargin: "600px 0px" }
    );
    const keepObserver = new IntersectionObserver(
      (entries) => setInKeepBand(entries.some((entry) => entry.isIntersecting)),
      { rootMargin: "2400px 0px" }
    );
    renderObserver.observe(holder);
    keepObserver.observe(holder);
    return () => {
      renderObserver.disconnect();
      keepObserver.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!inRenderBand || !renderWidth) return;
    // The canvas node remembers what it shows (the node itself is remounted
    // per filter via key, so a theme switch always starts blank).
    const stamp = canvasRef.current?.dataset.render?.split("|");
    if (stamp && Math.abs(Number(stamp[0]) - renderWidth) <= 4 && stamp[1] === filter) return;

    let cancelled = false;
    let task: RenderTask | null = null;

    (async () => {
      const page = await doc.getPage(pageNumber);
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = renderWidth / baseViewport.width;
      const viewport = page.getViewport({ scale: scale * dpr });

      const offscreen = document.createElement("canvas");
      offscreen.width = viewport.width;
      offscreen.height = viewport.height;
      const context = offscreen.getContext("2d");
      if (!context) return;
      task = page.render({ canvasContext: context, viewport });
      try {
        await task.promise;
        if (cancelled) return;
        canvas.style.aspectRatio = `${baseViewport.width} / ${baseViewport.height}`;
        blitThemed(canvas, offscreen, filter);
        canvas.dataset.render = `${renderWidth}|${filter}`;
        setPainted(true);
      } catch {
        /* render cancelled */
      }
    })();

    return () => {
      cancelled = true;
      if (task) task.cancel();
    };
  }, [inRenderBand, renderWidth, filter, doc, pageNumber]);

  // Far outside the keep band: drop the bitmap, keep the aspect-ratio box so
  // the scroll height stays stable.
  useEffect(() => {
    if (inKeepBand) return;
    const canvas = canvasRef.current;
    if (canvas && canvas.dataset.render) {
      canvas.width = 0;
      canvas.height = 0;
      delete canvas.dataset.render;
      setPainted(false);
    }
  }, [inKeepBand]);

  return (
    <div className="pdf-page" ref={holderRef}>
      <div className="pdf-page-tools">
        <span className="pdf-page-num">Page {pageNumber}</span>
        <button
          type="button"
          className="pdf-open"
          onClick={() => onOpen(pageNumber)}
          aria-label={`Open page ${pageNumber} full screen`}
        >
          <Maximize2 size={14} />
        </button>
      </div>
      <button type="button" className="pdf-canvas-btn" onClick={() => onOpen(pageNumber)}>
        <canvas
          key={filter}
          ref={canvasRef}
          className="pdf-canvas"
          role="img"
          aria-label={`Page ${pageNumber}`}
        />
        {!painted ? (
          <span className="pdf-canvas-skeleton" aria-hidden>
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
  filter,
  onClose
}: {
  doc: PDFDocumentProxy;
  pageNumber: number;
  filter: PageTheme;
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
      const offscreen = document.createElement("canvas");
      offscreen.width = viewport.width;
      offscreen.height = viewport.height;
      const context = offscreen.getContext("2d");
      if (!context) return;
      task = page.render({ canvasContext: context, viewport });
      try {
        await task.promise;
        if (cancelled) return;
        canvas.style.width = `${viewport.width / dpr}px`;
        blitThemed(canvas, offscreen, filter);
      } catch {
        /* cancelled */
      }
    })();
    return () => {
      cancelled = true;
      if (task) task.cancel();
    };
  }, [doc, pageNumber, zoom, filter]);

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
        <canvas key={filter} ref={canvasRef} className="lightbox-canvas" />
      </div>
    </div>
  );
}
