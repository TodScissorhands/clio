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
  detailView?: unknown;
  imageCoordinates?: unknown;
  pdfPage?: { imageCoordinates?: unknown };
};

type PageRecolorRequest = {
  pageNumber: number;
  pageView: PageViewLayers;
  pdf: PdfDocument;
  pristine: HTMLCanvasElement;
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  settings: PdfRecolorSettings | undefined;
  visibility: string;
  controller: AbortController;
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

function clearPristineCanvases(pristineMap: Map<number, HTMLCanvasElement>): void {
  for (const canvas of pristineMap.values()) {
    canvas.width = 0;
    canvas.height = 0;
  }
  pristineMap.clear();
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
  const pdfRef = useRef<PdfDocument | null>(null);
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
  pageNumberRef.current = pageNumber;
  scaleRef.current = scale;
  spreadRef.current = spread;
  continuousScrollingRef.current = continuousScrolling;
  const recolorSettingsRef = useRef(recolorSettings);
  recolorSettingsRef.current = recolorSettings;
  const pristineCanvasesRef = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const cancelRecolorRef = useRef<() => void>(() => {});
  const refreshRecolorRef = useRef<() => void>(() => {});

  useEffect(() => {
    let disposed = false;
    let eventBus: EventBus | null = null;
    let viewer: PDFViewerInstance | null = null;
    let listeners: [string, (event: { pageNumber?: number; error?: unknown }) => void][] = [];
    const requests = new Map<number, PageRecolorRequest>();
    let completed = new WeakMap<HTMLCanvasElement, {
      pristine: HTMLCanvasElement; settings: PdfRecolorSettings | undefined; width: number; height: number;
    }>();
    let active: PageRecolorRequest | null = null;
    let queuedTimer: number | undefined;

    const restoreVisibility = (request: PageRecolorRequest) => {
      if (request.canvas.style.visibility === "hidden") request.canvas.style.visibility = request.visibility;
    };
    const current = (request: PageRecolorRequest) => !disposed && !request.controller.signal.aborted &&
      requests.get(request.pageNumber) === request && pdfRef.current === request.pdf &&
      viewer?.pdfDocument === request.pdf && viewer.getPageView(request.pageNumber - 1) === request.pageView &&
      request.pageView.canvas === request.canvas && request.pageView.renderingState === 3 &&
      pristineCanvasesRef.current.get(request.pageNumber) === request.pristine &&
      recolorSettingsRef.current === request.settings &&
      request.pristine.width === request.width && request.pristine.height === request.height &&
      request.canvas.width === request.width && request.canvas.height === request.height;
    const cancelPage = (pageNumber: number) => {
      const request = requests.get(pageNumber);
      if (!request) return;
      requests.delete(pageNumber);
      request.controller.abort();
      restoreVisibility(request);
    };
    const cancelRecolor = () => {
      window.clearTimeout(queuedTimer);
      queuedTimer = undefined;
      for (const pageNumber of requests.keys()) cancelPage(pageNumber);
      active?.controller.abort();
      // Completed metadata also owns pristine references while PDF.js holds its
      // canvas keys. Drop that document's metadata even if those keys survive.
      if (disposed || !pdfRef.current) completed = new WeakMap();
    };
    cancelRecolorRef.current = cancelRecolor;

    const schedule = () => {
      if (disposed || active || queuedTimer !== undefined || requests.size === 0) return;
      queuedTimer = window.setTimeout(() => {
        queuedTimer = undefined;
        processNext();
      }, 0);
    };
    const finish = (request: PageRecolorRequest, applied: boolean, error?: unknown) => {
      const wasCurrent = current(request);
      if (requests.get(request.pageNumber) === request) {
        if (applied && wasCurrent) {
          completed.set(request.canvas, {
            pristine: request.pristine, settings: request.settings, width: request.width, height: request.height,
          });
        }
        requests.delete(request.pageNumber);
        restoreVisibility(request);
      }
      active = null;
      schedule();
      if (error && wasCurrent) {
        renderErrorRef.current(`Could not recolor page ${request.pageNumber}: ${String(error)}`);
      }
    };
    function processNext() {
      if (disposed || active) return;
      let next: PageRecolorRequest | null = null;
      let priority = Number.POSITIVE_INFINITY;
      const page = viewer?.currentPageNumber ?? pageNumberRef.current;
      for (const request of requests.values()) {
        if (!current(request)) {
          cancelPage(request.pageNumber);
          continue;
        }
        const distance = Math.abs(request.pageNumber - page);
        const score = distance + (request.pageView.div?.isConnected ? 0 : 10000);
        if (score < priority) {
          next = request;
          priority = score;
        }
      }
      if (!next) return;
      const request = next;
      active = request;
      try {
        const settings = request.settings;
        if (settings?.recolor && (settings.recolorKeephue || settings.recolorReverseVideo)) {
          const rawCoords = (request.pageView.imageCoordinates ?? request.pageView.pdfPage?.imageCoordinates) as ArrayLike<number> | undefined;
          const result = RecolorShaderRenderer.getInstance().render(
            request.pristine, request.canvas, settings, extractNormalizedImageRects(rawCoords),
            { signal: request.controller.signal, isCurrent: () => current(request) },
          );
          if (typeof result === "boolean") {
            finish(request, result);
          } else {
            void result.then(
              (applied) => finish(request, applied),
              (error: unknown) => finish(request, false, error),
            );
          }
        } else {
          const context = request.canvas.getContext("2d");
          if (context && current(request)) context.drawImage(request.pristine, 0, 0);
          finish(request, !!context);
        }
      } catch (error) {
        finish(request, false, error);
      }
    }
    const enqueue = (pageNumber: number) => {
      const pdf = pdfRef.current;
      if (!viewer || !pdf || viewer.pdfDocument !== pdf) return;
      const pageView = viewer.getPageView(pageNumber - 1) as PageViewLayers | undefined;
      const canvas = pageView?.canvas;
      const pristine = pristineCanvasesRef.current.get(pageNumber);
      if (!pageView || pageView.renderingState !== 3 || !canvas || !pristine ||
        !canvas.width || !canvas.height || canvas.width !== pristine.width || canvas.height !== pristine.height) return;
      const settings = recolorSettingsRef.current;
      const previous = requests.get(pageNumber);
      if (previous && current(previous)) return;
      const applied = completed.get(canvas);
      if (applied?.pristine === pristine && applied.settings === settings &&
        applied.width === canvas.width && applied.height === canvas.height) return;
      const visibility = previous?.canvas === canvas ? previous.visibility : canvas.style.visibility;
      if (previous) {
        requests.delete(pageNumber);
        previous.controller.abort();
        if (previous.canvas !== canvas) restoreVisibility(previous);
      }
      const request: PageRecolorRequest = {
        pageNumber, pageView, pdf, pristine, canvas, settings, visibility,
        width: canvas.width, height: canvas.height, controller: new AbortController(),
      };
      requests.set(pageNumber, request);
      // Only a complete current image may become visible, including cached pages.
      canvas.style.visibility = "hidden";
    };
    const cancelStaleRequests = () => {
      for (const request of requests.values()) {
        if (!current(request)) cancelPage(request.pageNumber);
      }
    };
    const refreshRecolor = () => {
      if (!viewer || viewer.pdfDocument !== pdfRef.current) return;
      cancelStaleRequests();
      for (const pageNumber of pristineCanvasesRef.current.keys()) enqueue(pageNumber);
      if (active && active.pageNumber !== viewer.currentPageNumber && requests.has(viewer.currentPageNumber)) {
        const pageNumber = active.pageNumber;
        cancelPage(pageNumber);
        enqueue(pageNumber);
      }
      if (!active && queuedTimer === undefined) processNext();
    };
    refreshRecolorRef.current = refreshRecolor;

    const syncPageElements = () => {
      if (!viewer) return;
      const pages = Array.from({ length: viewer.pagesCount }, (_, index) => {
        const pageView = viewer!.getPageView(index) as PageViewLayers;
        return pageView?.div ?? null;
      });
      pageElementsRef.current(pages);
      prunePristineCanvases(pristineCanvasesRef.current, viewer);
      cancelStaleRequests();
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
        refreshRecolor();
      };
      const pageRendered = (event: { pageNumber?: number; error?: unknown; source?: unknown; cssTransform?: boolean }) => {
        if (disposed || !viewer || !pdfRef.current || viewer.pdfDocument !== pdfRef.current) return;
        if (event.pageNumber) {
          const pageNum = event.pageNumber;
          const pageView = viewer.getPageView(pageNum - 1) as PageViewLayers | undefined;
          // A previous document can finish rendering after this page number is reused.
          if (!pageView || (event.source !== pageView &&
            (!pageView.detailView || event.source !== pageView.detailView))) return;
          if (event.error) {
            renderErrorRef.current(`Could not render page ${pageNum}: ${String(event.error)}`);
          }
          const canvas = pageView.canvas;
          if (canvas && canvas.width > 0 && canvas.height > 0) {
            cancelPage(pageNum);
            const bitmapChanged = !event.cssTransform && event.source === pageView;
            // CSS transforms and detail views do not repaint the main bitmap.
            // Re-copying it here could make an already recolored image pristine.
            if (bitmapChanged) completed.delete(canvas);
            let pristine = pristineCanvasesRef.current.get(pageNum);
            if (bitmapChanged || !pristine || pristine.width !== canvas.width || pristine.height !== canvas.height) {
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
            }
          }
          prunePristineCanvases(pristineCanvasesRef.current, viewer, pageNum);
          refreshRecolor();
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
      cancelRecolor();
      cancelRecolorRef.current = () => {};
      refreshRecolorRef.current = () => {};
      if (eventBus) for (const [name, listener] of listeners) eventBus.off(name, listener);
      viewer?.setDocument(null);
      viewerHandle.current = null;
      pageElementsRef.current([]);
      clearPristineCanvases(pristineCanvasesRef.current);
    };
  }, [containerRef, viewerRef, viewerHandle]);

  useLayoutEffect(() => {
    pdfRef.current = pdf;
    return () => {
      // Invalidate before releasing resources so late events cannot recreate them.
      pdfRef.current = null;
      cancelRecolorRef.current();
      clearPristineCanvases(pristineCanvasesRef.current);
    };
  }, [pdf]);

  useEffect(() => {
    viewerHandle.current?.setDocument(pdf);
  }, [pdf, viewerHandle]);

  useLayoutEffect(() => {
    const viewer = viewerHandle.current;
    if (!viewer || !pdf || viewer.pdfDocument !== pdf || !viewer.getPageView(0)) return;
    const targetScale = scale / PixelsPerInch.PDF_TO_CSS_UNITS;
    const ScrollMode = scrollModeRef.current;
    const desiredScroll = continuousScrolling ? ScrollMode?.VERTICAL : ScrollMode?.PAGE;
    if (viewer.spreadMode !== (spread ? 1 : 0) ||
      (desiredScroll !== undefined && viewer.scrollMode !== desiredScroll) ||
      (Number.isFinite(targetScale) && targetScale > 0 && !isScaleEffectivelyEqual(viewer.currentScale, targetScale))) {
      cancelRecolorRef.current();
    }
    const desiredSpread = spread ? 1 : 0;
    if (viewer.spreadMode !== desiredSpread) {
      viewer.spreadMode = desiredSpread;
    }
    if (ScrollMode) {
      const desiredScroll = continuousScrolling ? ScrollMode.VERTICAL : ScrollMode.PAGE;
      if (viewer.scrollMode !== desiredScroll) {
        viewer.scrollMode = desiredScroll;
      }
    }
    if (Number.isFinite(targetScale) && targetScale > 0 && !isScaleEffectivelyEqual(viewer.currentScale, targetScale)) {
      viewer.currentScale = targetScale;
    }
    if (viewer.currentPageNumber !== pageNumber) {
      viewer.currentPageNumber = pageNumber;
    }
    refreshRecolorRef.current();
  }, [pdf, pageNumber, scale, spread, continuousScrolling, viewerHandle]);

  useEffect(() => {
    const viewer = viewerHandle.current;
    if (!viewer) return;
    for (let number = 1; number <= viewer.pagesCount; number += 1) syncHighlightsRef.current(number);
  }, [matchesByPage, activeMatch, viewerHandle]);

  useLayoutEffect(() => {
    cancelRecolorRef.current();
    refreshRecolorRef.current();
  }, [recolorSettings, viewerHandle]);

  return null;
}
