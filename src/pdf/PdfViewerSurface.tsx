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
import { RecolorShaderRenderer } from "./recolor";
import type { NormalizedRect, PdfRecolorSettings } from "./recolor";

export type PdfViewerHandle = { current: PDFViewerInstance | null };
type PageMatch = { index: number; match: SearchMatch };
type PageViewLayers = {
  id?: number;
  div?: HTMLDivElement;
  canvas?: HTMLCanvasElement;
  renderingState?: number;
  imageCoordinates?: unknown;
  pdfPage?: { imageCoordinates?: unknown };
};

function extractNormalizedImageRects(rawCoords: ArrayLike<number> | undefined): NormalizedRect[] {
  const rects: NormalizedRect[] = [];
  if (!rawCoords || rawCoords.length < 6) return rects;
  for (let i = 0; i < rawCoords.length; i += 6) {
    const x1 = rawCoords[i];
    const y1 = rawCoords[i + 1];
    const x2 = rawCoords[i + 2];
    const y2 = rawCoords[i + 3];
    const x3 = rawCoords[i + 4];
    const y3 = rawCoords[i + 5];
    const x4 = x2 + x3 - x1;
    const y4 = y2 + y3 - y1;
    rects.push({
      minX: Math.max(0, Math.min(x1, x2, x3, x4)),
      minY: Math.max(0, Math.min(y1, y2, y3, y4)),
      maxX: Math.min(1, Math.max(x1, x2, x3, x4)),
      maxY: Math.min(1, Math.max(y1, y2, y3, y4)),
    });
  }
  return rects;
}

function prunePristineCanvases(
  pristineMap: Map<number, HTMLCanvasElement>,
  viewer: PDFViewerInstance | null,
  activePageNumber?: number,
): void {
  if (!viewer || pristineMap.size === 0) return;
  const cachedViews = viewer.getCachedPageViews?.() as Set<PageViewLayers> | undefined;
  if (!cachedViews) return;
  const cachedIds = new Set(Array.from(cachedViews, (v) => v.id));

  for (const [num] of pristineMap) {
    if (num === activePageNumber) continue;
    const pageView = viewer.getPageView(num - 1) as PageViewLayers | undefined;
    if (!pageView) {
      pristineMap.delete(num);
      continue;
    }
    if (pageView.renderingState === 1) continue;

    if (!cachedIds.has(num) && !pageView.canvas) {
      pristineMap.delete(num);
    }
  }
}

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
  recolorSettings,
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
  recolorSettings?: PdfRecolorSettings;
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
  const recolorSettingsRef = useRef(recolorSettings);
  recolorSettingsRef.current = recolorSettings;
  const pristineCanvasesRef = useRef<Map<number, HTMLCanvasElement>>(new Map());

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
      prunePristineCanvases(pristineCanvasesRef.current, viewer);
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
        imagesRightClickMinSize: 0,
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
          const pageNum = event.pageNumber;
          const pageView = viewer?.getPageView(pageNum - 1) as PageViewLayers | undefined;
          const canvas = pageView?.canvas;
          if (canvas && canvas.width > 0 && canvas.height > 0) {
            let pristine = pristineCanvasesRef.current.get(pageNum);
            if (!pristine || pristine.width !== canvas.width || pristine.height !== canvas.height) {
              pristine = document.createElement("canvas");
              pristine.width = canvas.width;
              pristine.height = canvas.height;
              pristineCanvasesRef.current.set(pageNum, pristine);
            }
            const pCtx = pristine.getContext("2d");
            if (pCtx) {
              pCtx.clearRect(0, 0, pristine.width, pristine.height);
              pCtx.drawImage(canvas, 0, 0);
            }

            const settings = recolorSettingsRef.current;
            if (settings?.recolor && (settings.recolorKeephue || settings.recolorReverseVideo)) {
              const rawCoords = (pageView.imageCoordinates ?? pageView.pdfPage?.imageCoordinates) as ArrayLike<number> | undefined;
              const rects = extractNormalizedImageRects(rawCoords);
              RecolorShaderRenderer.getInstance().render(pristine, canvas, settings, rects);
            }
          }
          prunePristineCanvases(pristineCanvasesRef.current, viewer, pageNum);
          pageRenderedRef.current?.(pageNum);
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
      pristineCanvasesRef.current.clear();
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

  useEffect(() => {
    const viewer = viewerHandle.current;
    if (!viewer) return;
    const settings = recolorSettings;

    for (let num = 1; num <= viewer.pagesCount; num += 1) {
      const pageView = viewer.getPageView(num - 1) as PageViewLayers | undefined;
      const canvas = pageView?.canvas;
      const pristine = pristineCanvasesRef.current.get(num);
      if (!canvas || !pristine) continue;

      if (settings?.recolor && (settings.recolorKeephue || settings.recolorReverseVideo)) {
        const rawCoords = (pageView.imageCoordinates ?? pageView.pdfPage?.imageCoordinates) as ArrayLike<number> | undefined;
        const rects = extractNormalizedImageRects(rawCoords);
        RecolorShaderRenderer.getInstance().render(pristine, canvas, settings, rects);
      } else {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(pristine, 0, 0);
        }
      }
    }
  }, [recolorSettings, viewerHandle]);

  return null;
}
