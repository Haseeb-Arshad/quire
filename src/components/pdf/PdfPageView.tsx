import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Maximize2, Minus, Plus, Trash2, X } from "lucide-react";
import { pdfjsLib, TextLayer, type PDFDocumentProxy, type RenderTask } from "../../lib/pdf";
import { blitThemed } from "../../lib/pdfFilters";
import type { PageTheme } from "../../lib/preferences";
import type { Annotation, HighlightColor, PageHighlight } from "../../lib/types";
import { pageSelectionToDrafts, type PageSelectionDraft } from "../../lib/anchors";
import { HighlightPopover } from "../reader/HighlightPopover";

export function PdfPageView({
  bookId,
  fileUrl,
  pageTheme,
  annotations,
  onPageHighlight,
  onDeleteAnnotation,
  onSaveNote,
  onVisiblePage,
  initialPage,
  jump
}: {
  bookId: string;
  fileUrl: string;
  pageTheme: PageTheme;
  annotations: Annotation[];
  onPageHighlight: (drafts: PageSelectionDraft[], color: HighlightColor) => void;
  onDeleteAnnotation: (id: string) => void;
  onSaveNote: (id: string, note: string) => void;
  onVisiblePage: (page: number) => void;
  initialPage?: number;
  jump?: { page: number; nonce: number } | null;
}) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");
  const [lightboxPage, setLightboxPage] = useState<number | null>(null);
  const [renderWidth, setRenderWidth] = useState(0);
  const [popover, setPopover] = useState<{ drafts: PageSelectionDraft[]; x: number; y: number } | null>(null);
  const [annotMenu, setAnnotMenu] = useState<{ annotation: PageHighlight; x: number; y: number } | null>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const filter = pageTheme;

  const pageHighlights = useMemo(
    () => annotations.filter((a): a is PageHighlight => a.kind === "page-highlight"),
    [annotations]
  );

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

  // Give unpainted page holders the document's aspect ratio up front, so the
  // initial-page scroll (and page jumps) land accurately before bitmaps paint.
  useEffect(() => {
    if (!doc || status !== "ready") return;
    let cancelled = false;
    void doc.getPage(1).then((page) => {
      if (cancelled) return;
      const viewport = page.getViewport({ scale: 1 });
      pagesRef.current?.style.setProperty("--pdf-aspect", `${viewport.width} / ${viewport.height}`);
    });
    return () => {
      cancelled = true;
    };
  }, [doc, status]);

  // Report the page nearest the top of the viewport for progress + resume.
  useEffect(() => {
    const container = pagesRef.current;
    if (!container || status !== "ready") return;
    const holders = Array.from(container.querySelectorAll<HTMLElement>(".pdf-page[data-page]"));
    const observer = new IntersectionObserver(
      (entries) => {
        const onTop = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (onTop) {
          const page = Number((onTop.target as HTMLElement).dataset.page);
          if (!Number.isNaN(page)) onVisiblePage(page);
        }
      },
      { rootMargin: "-40% 0px -55% 0px" }
    );
    holders.forEach((holder) => observer.observe(holder));
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, doc]);

  const scrollToPage = (page: number, behavior: ScrollBehavior) => {
    pagesRef.current
      ?.querySelector(`.pdf-page[data-page="${page}"]`)
      ?.scrollIntoView({ block: "start", behavior });
  };

  // Land on the remembered page once the layout has settled.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (status !== "ready" || !renderWidth || restoredRef.current) return;
    restoredRef.current = true;
    if (initialPage && initialPage > 1) {
      requestAnimationFrame(() => scrollToPage(initialPage, "auto"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, renderWidth]);
  useEffect(() => {
    restoredRef.current = false;
  }, [bookId, fileUrl]);

  // Jump requests from the Notes panel (nonce distinguishes repeat jumps).
  useEffect(() => {
    if (!jump || status !== "ready") return;
    requestAnimationFrame(() => scrollToPage(jump.page, "smooth"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump?.nonce, status]);

  const handleMouseUp = () => {
    const container = pagesRef.current;
    if (!container) return;
    const drafts = pageSelectionToDrafts(container);
    if (!drafts.length) {
      setPopover(null);
      return;
    }
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    setPopover({ drafts, x: rect.left + rect.width / 2, y: rect.top - 8 });
  };

  const finishSelection = () => {
    window.getSelection()?.removeAllRanges();
    setPopover(null);
  };

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
    <div
      className="pdf-pages"
      ref={pagesRef}
      onMouseUp={handleMouseUp}
      onMouseDown={() => {
        setPopover(null);
        setAnnotMenu(null);
      }}
    >
      {Array.from({ length: doc.numPages }, (_, index) => (
        <PdfPage
          key={index + 1}
          doc={doc}
          pageNumber={index + 1}
          renderWidth={renderWidth}
          filter={filter}
          highlights={pageHighlights.filter((highlight) => highlight.page === index + 1)}
          onOpen={setLightboxPage}
          onAnnotationClick={(annotation, x, y) => setAnnotMenu({ annotation, x, y })}
        />
      ))}

      {popover ? (
        <HighlightPopover
          x={popover.x}
          y={popover.y}
          onPick={(color) => {
            onPageHighlight(popover.drafts, color);
            finishSelection();
          }}
          onCopy={() => {
            void navigator.clipboard.writeText(popover.drafts.map((d) => d.quote).join("\n\n"));
            finishSelection();
          }}
        />
      ) : null}

      {annotMenu ? (
        <PageAnnotMenu
          annotation={annotMenu.annotation}
          x={annotMenu.x}
          y={annotMenu.y}
          onDelete={() => {
            onDeleteAnnotation(annotMenu.annotation.id);
            setAnnotMenu(null);
          }}
          onSaveNote={(note) => {
            onSaveNote(annotMenu.annotation.id, note);
            setAnnotMenu(null);
          }}
          onClose={() => setAnnotMenu(null)}
        />
      ) : null}

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
  highlights,
  onOpen,
  onAnnotationClick
}: {
  doc: PDFDocumentProxy;
  pageNumber: number;
  renderWidth: number;
  filter: PageTheme;
  highlights: PageHighlight[];
  onOpen: (page: number) => void;
  onAnnotationClick: (annotation: PageHighlight, x: number, y: number) => void;
}) {
  const holderRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
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

  // Selectable text overlay, sized in CSS pixels (no dpr) so it tracks the
  // canvas's displayed box. Theme switches don't touch it — it is keyed on
  // render width alone.
  useEffect(() => {
    if (!inRenderBand || !renderWidth) return;
    const container = textLayerRef.current;
    if (!container || container.dataset.textRender === String(renderWidth)) return;

    let cancelled = false;
    let layer: InstanceType<typeof TextLayer> | null = null;

    (async () => {
      const page = await doc.getPage(pageNumber);
      if (cancelled) return;
      const baseViewport = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: renderWidth / baseViewport.width });
      const textContent = await page.getTextContent();
      if (cancelled || !textLayerRef.current) return;
      container.replaceChildren();
      container.style.setProperty("--scale-factor", String(viewport.scale));
      layer = new TextLayer({ textContentSource: textContent, container, viewport });
      try {
        await layer.render();
        if (!cancelled) container.dataset.textRender = String(renderWidth);
      } catch {
        /* cancelled */
      }
    })();

    return () => {
      cancelled = true;
      layer?.cancel();
    };
  }, [inRenderBand, renderWidth, doc, pageNumber]);

  // Far outside the keep band: drop the bitmap and text layer, keep the
  // aspect-ratio box so the scroll height stays stable.
  useEffect(() => {
    if (inKeepBand) return;
    const canvas = canvasRef.current;
    if (canvas && canvas.dataset.render) {
      canvas.width = 0;
      canvas.height = 0;
      delete canvas.dataset.render;
      setPainted(false);
    }
    const textLayer = textLayerRef.current;
    if (textLayer && textLayer.dataset.textRender) {
      textLayer.replaceChildren();
      delete textLayer.dataset.textRender;
    }
  }, [inKeepBand]);

  return (
    <div className="pdf-page" ref={holderRef} data-page={pageNumber}>
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
      <div className="pdf-canvas-wrap">
        <canvas
          key={filter}
          ref={canvasRef}
          className="pdf-canvas"
          role="img"
          aria-label={`Page ${pageNumber}`}
        />
        <div className="pdf-annot-layer" aria-hidden>
          {highlights.map((highlight) => (
            <PageHighlightOverlay
              key={highlight.id}
              highlight={highlight}
              onClick={(x, y) => onAnnotationClick(highlight, x, y)}
            />
          ))}
        </div>
        <div ref={textLayerRef} className="pdf-text-layer" />
        {!painted ? (
          <span className="pdf-canvas-skeleton" aria-hidden>
            <Loader2 className="spin" size={20} />
          </span>
        ) : null}
      </div>
    </div>
  );
}

function PageHighlightOverlay({
  highlight,
  onClick
}: {
  highlight: PageHighlight;
  onClick: (x: number, y: number) => void;
}) {
  const first = highlight.rects[0];
  return (
    <>
      {highlight.rects.map((rect, index) => (
        <span
          key={index}
          className={`pdf-annot-rect hl-fill-${highlight.color}`}
          style={{
            left: `${rect[0] * 100}%`,
            top: `${rect[1] * 100}%`,
            width: `${rect[2] * 100}%`,
            height: `${rect[3] * 100}%`
          }}
        />
      ))}
      {first ? (
        <button
          type="button"
          className={`pdf-annot-chip hl-dot hl-dot-${highlight.color}`}
          style={{
            left: `${(first[0] + first[2]) * 100}%`,
            top: `${first[1] * 100}%`
          }}
          title={highlight.note || "Highlight — click for note"}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onClick(event.clientX, event.clientY);
          }}
        />
      ) : null}
    </>
  );
}

function PageAnnotMenu({
  annotation,
  x,
  y,
  onDelete,
  onSaveNote,
  onClose
}: {
  annotation: PageHighlight;
  x: number;
  y: number;
  onDelete: () => void;
  onSaveNote: (note: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(annotation.note || "");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="page-annot-menu"
      style={{ left: Math.min(x, window.innerWidth - 280), top: y + 10 }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <p className="page-annot-quote">{annotation.quote.slice(0, 120)}</p>
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Write a note…"
        rows={3}
        autoFocus
      />
      <div className="page-annot-actions">
        <button type="button" className="note-editor-save" onClick={() => onSaveNote(draft)}>
          Save note
        </button>
        <button type="button" className="page-annot-delete" onClick={onDelete} aria-label="Delete highlight">
          <Trash2 size={13} />
          Delete
        </button>
      </div>
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
