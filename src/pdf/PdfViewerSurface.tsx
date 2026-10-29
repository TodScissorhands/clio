import { PixelsPerInch } from "pdfjs-dist";
import { useEffect, useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";
import type { EventBus, PDFViewer as PDFViewerInstance } from "pdfjs-dist/web/pdf_viewer.mjs";
import type { PdfDocument } from "./engine";
import type { SearchMatch } from "./search";
import { loadPdfJsViewer } from "./viewer";
import type { PdfJsViewerModule } from "./viewer";
import "pdfjs-dist/web/pdf_viewer.css";
import { isScaleEffectivelyEqual } from "../reader/layout";

export type PdfViewerHandle = { current: PDFViewerInstance | null };
type PageMatch = { index: number; match: SearchMatch };
type PageViewLayers = { div?: HTMLDivElement };

export function PdfViewerSurface({
  containerRef,
  viewerRef,
  viewerHandle,
  pdf,
  pageNumber,
  scale,
  spread,
  continuousScrolling,
  matchesByPage,
  activeMatch,
  onPageChange,
  onActiveMatchElement,
  onPageElements,
  onPageRendered,
  onRenderError,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  viewerRef: RefObject<HTMLDivElement | null>;
  viewerHandle: { current: PDFViewerInstance | null };
  pdf: PdfDocument | null;
  pageNumber: number;
  scale: number;
  spread: boolean;
  continuousScrolling: boolean;
  matchesByPage: Map<number, PageMatch[]>;
  activeMatch: number;
  onPageChange: (page: number) => void;
  onActiveMatchElement: (index: number, element: HTMLDivElement | null) => void;
  onPageElements: (pages: (HTMLDivElement | null)[]) => void;
  onPageRendered?: (pageNumber: number) => void;
  onRenderError: (message: string) => void;
}) {
  const pageChangeRef = useRef(onPageChange);
  const activeMatchRef = useRef(onActiveMatchElement);
  const pageElementsRef = useRef(onPageElements);
  const renderErrorRef = useRef(onRenderError);
  const pageRenderedRef = useRef(onPageRendered);
  pageRenderedRef.current = onPageRendered;
  const matchesRef = useRef(matchesByPage);
  const activeIndexRef = useRef(activeMatch);
  const pdfRef = useRef(pdf);
  const pageNumberRef = useRef(pageNumber);
  const scaleRef = useRef(scale);
  const spreadRef = useRef(spread);
  const continuousScrollingRef = useRef(continuousScrolling);
  const scrollModeRef = useRef<PdfJsViewerModule["ScrollMode"] | null>(null);
  const syncHighlightsRef = useRef<(number: number) => void>(() => {});
  pageChangeRef.current = onPageChange;
  activeMatchRef.current = onActiveMatchElement;
  pageElementsRef.current = onPageElements;
  renderErrorRef.current = onRenderError;
  matchesRef.current = matchesByPage;
  activeIndexRef.current = activeMatch;
  pdfRef.current = pdf;
  pageNumberRef.current = pageNumber;
  scaleRef.current = scale;
  spreadRef.current = spread;
  continuousScrollingRef.current = continuousScrolling;

  useEffect(() => {
    let disposed = false;
    let eventBus: EventBus | null = null;
    let viewer: PDFViewerInstance | null = null;
    let listeners: [string, (event: { pageNumber?: number; error?: unknown }) => void][] = [];

    const syncPageElements = () => {
      if (!viewer) return;
      const pages = Array.from({ length: viewer.pagesCount }, (_, index) => {
        const pageView = viewer!.getPageView(index) as PageViewLayers;
        return pageView?.div ?? null;
      });
      pageElementsRef.current(pages);
    };
    const syncHighlights = (number: number) => {
      const page = viewerRef.current?.querySelector<HTMLDivElement>(`.page[data-page-number="${number}"]`);
      const textDivs = page?.querySelectorAll<HTMLElement>(".textLayer span");
      if (!page || !textDivs?.length) return;
      let layer = page.querySelector<HTMLDivElement>(".pdfjs-search-highlights");
      if (!layer) {
        layer = document.createElement("div");
        layer.className = "pdfjs-search-highlights";
        layer.setAttribute("aria-hidden", "true");
        page.append(layer);
      }
      layer.replaceChildren();
      let activeElement: HTMLDivElement | null = null;
      const pageRect = page.getBoundingClientRect();
      for (const { index, match } of matchesRef.current.get(number) ?? []) {
        for (const segment of match.segments) {
          const textNode = textDivs[segment.itemIndex]?.firstChild;
          if (!textNode || textNode.nodeType !== Node.TEXT_NODE) continue;
          const range = document.createRange();
          range.setStart(textNode, Math.min(segment.start, textNode.textContent?.length ?? 0));
          range.setEnd(textNode, Math.min(segment.end, textNode.textContent?.length ?? 0));
          for (const rect of range.getClientRects()) {
            if (!rect.width || !rect.height) continue;
            const mark = document.createElement("div");
            mark.className = `pdfjs-search-highlight${index === activeIndexRef.current ? " is-active" : ""}`;
            mark.dataset.match = String(index);
            Object.assign(mark.style, {
              left: `${rect.left - pageRect.left}px`,
              top: `${rect.top - pageRect.top}px`,
              width: `${rect.width}px`,
              height: `${rect.height}px`,
            });
            layer.append(mark);
            if (index === activeIndexRef.current) activeElement ??= mark;
          }
        }
      }
      if (activeIndexRef.current >= 0) activeMatchRef.current(activeIndexRef.current, activeElement);
    };
    syncHighlightsRef.current = syncHighlights;

    void loadPdfJsViewer().then(({ EventBus, PDFViewer, ScrollMode, SimpleLinkService }: PdfJsViewerModule) => {
      const container = containerRef.current;
      const viewerElement = viewerRef.current;
      if (disposed || !container || !viewerElement) return;
      eventBus = new EventBus();
      const linkService = new SimpleLinkService({ eventBus });
      viewer = new PDFViewer({
        container,
        viewer: viewerElement,
        eventBus,
        linkService,
        textLayerMode: 1,
        annotationMode: 0,
        removePageBorders: true,
        minDurationToUpdateCanvas: 500,
      });
      scrollModeRef.current = ScrollMode;
      linkService.setViewer(viewer);
      viewerHandle.current = viewer;
      const pageChanged = (event: { pageNumber?: number }) => {
        if (event.pageNumber && event.pageNumber !== pageNumberRef.current) {
          pageChangeRef.current(event.pageNumber);
        }
      };
      const pageRendered = (event: { pageNumber?: number; error?: unknown }) => {
        if (event.error && event.pageNumber) {
          renderErrorRef.current(`Could not render page ${event.pageNumber}: ${String(event.error)}`);
        }
        if (event.pageNumber) {
          pageRenderedRef.current?.(event.pageNumber);
        }
      };
      const pagesInitialized = () => {
        if (!viewer) return;
        const desiredSpread = spreadRef.current ? 1 : 0;
        if (viewer.spreadMode !== desiredSpread) viewer.spreadMode = desiredSpread;
        const ScrollMode = scrollModeRef.current;
        if (ScrollMode) {
          const desiredScroll = continuousScrollingRef.current ? ScrollMode.VERTICAL : ScrollMode.PAGE;
          if (viewer.scrollMode !== desiredScroll) viewer.scrollMode = desiredScroll;
        }
        const targetScale = scaleRef.current / PixelsPerInch.PDF_TO_CSS_UNITS;
        if (Number.isFinite(targetScale) && targetScale > 0 && !isScaleEffectivelyEqual(viewer.currentScale, targetScale)) {
          viewer.currentScale = targetScale;
        }
        if (viewer.currentPageNumber !== pageNumberRef.current) {
          viewer.currentPageNumber = pageNumberRef.current;
        }
        syncPageElements();
      };
      const textRendered = (event: { pageNumber?: number }) => {
        if (event.pageNumber) {
          syncHighlights(event.pageNumber);
          pageRenderedRef.current?.(event.pageNumber);
        }
      };
      listeners = [
        ["pagechanging", pageChanged],
        ["pagesinit", pagesInitialized],
        ["pagerendered", pageRendered],
        ["textlayerrendered", textRendered],
      ];
      for (const [name, listener] of listeners) eventBus.on(name, listener);
      viewer.setDocument(pdfRef.current);
    }).catch((cause: unknown) => {
      renderErrorRef.current(`Could not initialize the PDF.js viewer: ${cause instanceof Error ? cause.message : String(cause)}`);
    });

    return () => {
      disposed = true;
      if (eventBus) for (const [name, listener] of listeners) eventBus.off(name, listener);
      viewer?.setDocument(null);
      viewerHandle.current = null;
      pageElementsRef.current([]);
    };
  }, [containerRef, viewerRef, viewerHandle]);

  useEffect(() => {
    viewerHandle.current?.setDocument(pdf);
  }, [pdf, viewerHandle]);

  useLayoutEffect(() => {
    const viewer = viewerHandle.current;
    if (!viewer || !pdf) return;
    const desiredSpread = spread ? 1 : 0;
    if (viewer.spreadMode !== desiredSpread) {
      viewer.spreadMode = desiredSpread;
    }
    const ScrollMode = scrollModeRef.current;
    if (ScrollMode) {
      const desiredScroll = continuousScrolling ? ScrollMode.VERTICAL : ScrollMode.PAGE;
      if (viewer.scrollMode !== desiredScroll) {
        viewer.scrollMode = desiredScroll;
      }
    }
    const targetScale = scale / PixelsPerInch.PDF_TO_CSS_UNITS;
    if (Number.isFinite(targetScale) && targetScale > 0 && !isScaleEffectivelyEqual(viewer.currentScale, targetScale)) {
      viewer.currentScale = targetScale;
    }
    if (viewer.currentPageNumber !== pageNumber) {
      viewer.currentPageNumber = pageNumber;
    }
  }, [pdf, pageNumber, scale, spread, continuousScrolling, viewerHandle]);

  useEffect(() => {
    const viewer = viewerHandle.current;
    if (!viewer) return;
    for (let number = 1; number <= viewer.pagesCount; number += 1) syncHighlightsRef.current(number);
  }, [matchesByPage, activeMatch, viewerHandle]);

  return null;
}
