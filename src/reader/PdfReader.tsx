import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPdfLoadingTask, getPdfPageSizes, pdfErrorMessage } from "../pdf/engine";
import type { PdfDocument, PdfLoadingTask } from "../pdf/engine";
import { PdfViewerSurface } from "../pdf/PdfViewerSurface";
import type { PdfViewerHandle } from "../pdf/PdfViewerSurface";
import { normalizeSearchQuery, usePdfSearch } from "../pdf/search";
import type { SearchMatch } from "../pdf/search";
import { loadReadingPosition } from "../platform/readingPosition";
import type { ReadingPosition } from "../platform/readingPosition";
import type { ReaderFileSource } from "../platform/tauriReaderFiles";
import {
  computeSvgColorMatrix,
  isValidHexColor,
  loadRecolorSettings,
  normalizeHexColor,
  RECOLOR_PRESETS,
  saveRecolorSettings,
} from "../pdf/recolor";
import type { PdfRecolorPresetId, PdfRecolorSettings } from "../pdf/recolor";
import {
  calculateFitScale,
  getCenterPreservingScrollDelta,
  getPageGroupIndices,
  getAdjacentPageNumber,
  getPagedWheelDirection,
  canNavigatePagedWheel,
  getPagePanDelta,
  isPageZoomedIn,
  hasViewportSizeChanged,
  MAX_ZOOM,
  MIN_SPREAD_PAGE_WIDTH,
  MIN_ZOOM,
  measureAvailableViewport,
  SPREAD_GAP,
  ZOOM_FACTOR,
} from "./layout";
import type { PageSize, RectBounds, ViewMode, ViewportSize, ZoomState } from "./layout";
import {
  filterReaderCommands,
  useReaderKeyboard,
} from "./interactions";
import type { PdfPanDirection, ReaderCommandId, ReaderOverlay } from "./interactions";
import type { ReaderCommand } from "./interactions";
import { ReaderCommandPalette } from "./ReaderCommandPalette";
import { useReadingPosition } from "./useReadingPosition";
import "./Reader.css";


type PdfReaderSource = Extract<ReaderFileSource, { kind: "pdf" }>;
type ZoomCenterAnchor = {
  pageIndices: number[];
  bounds: RectBounds;
  center: { x: number; y: number };
};

function getPageElementBounds(elements: (HTMLElement | null)[]): RectBounds | null {
  if (!elements.length || elements.some((element) => element === null)) return null;
  const rects = elements.map((element) => element!.getBoundingClientRect());
  return {
    left: Math.min(...rects.map((rect) => rect.left)),
    top: Math.min(...rects.map((rect) => rect.top)),
    right: Math.max(...rects.map((rect) => rect.right)),
    bottom: Math.max(...rects.map((rect) => rect.bottom)),
  };
}


export function PdfReader({
  onToggleNightMode,
  onOpenDocument,
  initialSource,
  onInitialSourceConsumed,
}: {
  onToggleNightMode: () => void;
  onOpenDocument: (restoreFocus?: () => void) => void;
  initialSource: PdfReaderSource | null;
  onInitialSourceConsumed: () => void;
}) {

  const [documentPath, setDocumentPath] = useState<string | null>(null);
  const [document, setDocument] = useState<PdfDocument | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoomState, setZoomState] = useState<ZoomState>({ mode: "fit-page" });
  const [viewMode, setViewMode] = useState<ViewMode>("single");
  const [continuousScrolling, setContinuousScrolling] = useState(false);
  const [viewerSize, setViewerSize] = useState<ViewportSize>({ width: 0, height: 0 });
  const [pageSizes, setPageSizes] = useState<PageSize[]>([]);
  const [pageElementsVersion, setPageElementsVersion] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [overlay, setOverlay] = useState<ReaderOverlay>(null);
  const [jumpInput, setJumpInput] = useState("");
  const [commandQuery, setCommandQuery] = useState("");
  const [commandIndex, setCommandIndex] = useState(0);
  const [recolorSettings, setRecolorSettings] = useState<PdfRecolorSettings>(() => loadRecolorSettings());
  const [customColorTarget, setCustomColorTarget] = useState<"light" | "dark" | null>(null);
  const [colorInput, setColorInput] = useState("");
  const colorInputRef = useRef<HTMLInputElement>(null);

  const activeMatchElementRef = useRef<HTMLDivElement | null>(null);
  const jumpInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const recolorMatrix = useMemo(() => {
    return computeSvgColorMatrix(recolorSettings.recolorLightcolor, recolorSettings.recolorDarkcolor);
  }, [recolorSettings.recolorLightcolor, recolorSettings.recolorDarkcolor]);
  const viewerRef = useRef<HTMLDivElement>(null);
  const pdfViewerElementRef = useRef<HTMLDivElement>(null);
  const pdfViewerRef = useRef<PdfViewerHandle["current"]>(null);
  const pageElementsRef = useRef<(HTMLDivElement | null)[]>([]);
  const scrollAnchorRef = useRef<{ page: number; top: number } | null>(null);
  const zoomCenterAnchorRef = useRef<ZoomCenterAnchor | null>(null);
  const lastPagedWheelNavigationAtRef = useRef(Number.NEGATIVE_INFINITY);
  const pageNumberRef = useRef(1);
  const loadingTaskRef = useRef<PdfLoadingTask | null>(null);
  const generationRef = useRef(0);
  const totalPages = document?.numPages ?? 0;
  pageNumberRef.current = pageNumber;

  const selectSearchMatch = useCallback((match: SearchMatch) => {
    if (pageNumberRef.current !== match.page) {
      pageNumberRef.current = match.page;
      setPageNumber(match.page);
    }
    const pdfViewer = pdfViewerRef.current;
    if (pdfViewer && pdfViewer.currentPageNumber !== match.page) {
      pdfViewer.currentPageNumber = match.page;
    }
    const viewer = viewerRef.current;
    const element = pageElementsRef.current[match.page - 1];
    if (viewer && element) {
      const offset = element.getBoundingClientRect().top - viewer.getBoundingClientRect().top;
      viewer.scrollTo({ top: viewer.scrollTop + offset - 20, behavior: "auto" });
    }
  }, []);
  const reportSearchError = useCallback((message: string) => setError(message), []);
  const search = usePdfSearch(document, selectSearchMatch, reportSearchError);
  const {
    query: searchQuery,
    matches,
    activeMatch,
    activeMatchRef,
    searching,
    searchedQuery,
  } = search;
  const matchesByPageRef = useRef(new Map<number, { index: number; match: SearchMatch }[]>());
  const matchesByPage = useMemo(() => {
    const grouped = new Map<number, { index: number; match: SearchMatch }[]>();
    matches.forEach((match, index) => {
      const pageMatches = grouped.get(match.page);
      if (pageMatches) pageMatches.push({ index, match });
      else grouped.set(match.page, [{ index, match }]);
    });
    const stablePages = new Map<number, { index: number; match: SearchMatch }[]>();
    for (const [page, pageMatches] of grouped) {
      const previous = matchesByPageRef.current.get(page);
      const unchanged = previous?.length === pageMatches.length &&
        pageMatches.every((entry, index) => entry.index === previous[index]?.index && entry.match === previous[index]?.match);
      stablePages.set(page, unchanged ? previous : pageMatches);
    }
    matchesByPageRef.current = stablePages;
    return stablePages;
  }, [matches]);
  const visibleCommands = filterReaderCommands(commandQuery, document !== null && !loading);
  const effectiveViewMode: ViewMode = viewMode === "spread" &&
    viewerSize.width >= MIN_SPREAD_PAGE_WIDTH * 2 + SPREAD_GAP ? "spread" : "single";
  const fitBasis = zoomState.mode === "manual" ? zoomState.basis : zoomState.mode;
  const zoomFactor = zoomState.mode === "manual" ? zoomState.factor : 1;
  const pageScale = calculateFitScale(fitBasis, pageSizes, effectiveViewMode, viewerSize, pageNumber) * zoomFactor;
  const reportPositionError = useCallback((message: string) => setError(message), []);
  const { handleViewportScroll, queueRestoration, retryRestoration } = useReadingPosition({
    path: documentPath,
    pageNumber,
    pageNumberRef,
    viewerRef,
    pageElementsRef,
    layoutVersion: pageElementsVersion,
    onError: reportPositionError,
  });
  const focusReader = useCallback(() => {
    requestAnimationFrame(() => viewerRef.current?.focus());
  }, []);

  const captureScrollAnchor = useCallback(() => {
    zoomCenterAnchorRef.current = null;
    const viewer = viewerRef.current;
    const page = pageElementsRef.current[pageNumberRef.current - 1];
    if (viewer && page) {
      scrollAnchorRef.current = {
        page: pageNumberRef.current,
        top: page.getBoundingClientRect().top - viewer.getBoundingClientRect().top,
      };
    }
  }, []);


  const handlePagedWheel = useCallback((event: WheelEvent) => {
    const direction = getPagedWheelDirection(
      event.deltaY,
      continuousScrolling,
      event.ctrlKey || event.metaKey || event.altKey || event.shiftKey,
    );
    if (direction === null || overlay !== null) return;
    const target = event.target;
    if (target instanceof Element && target.closest(
      ".status-bar, .command-palette, input, textarea, select, button, [contenteditable], [role='textbox']",
    )) return;

    event.preventDefault();
    const now = performance.now();
    if (!canNavigatePagedWheel(now, lastPagedWheelNavigationAtRef.current)) return;
    const pdfViewer = pdfViewerRef.current;
    if (!pdfViewer) return;
    lastPagedWheelNavigationAtRef.current = now;
    if (direction > 0) pdfViewer.nextPage();
    else pdfViewer.previousPage();
  }, [continuousScrolling, overlay]);
  useEffect(() => {
    const viewport = viewerRef.current;
    if (!viewport) return;
    viewport.addEventListener("wheel", handlePagedWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", handlePagedWheel);
  }, [handlePagedWheel]);
  useEffect(() => {
    lastPagedWheelNavigationAtRef.current = Number.NEGATIVE_INFINITY;
  }, [continuousScrolling, overlay, document]);

  const handlePageRenderError = useCallback((message: string) => setError(message), []);
  const handlePageChange = useCallback((nextPage: number) => {
    if (!Number.isInteger(nextPage) || pageNumberRef.current === nextPage) return;
    pageNumberRef.current = nextPage;
    setPageNumber(nextPage);
  }, []);
  const handlePageElements = useCallback((pages: (HTMLDivElement | null)[]) => {
    if (pages.length === pageElementsRef.current.length &&
      pages.every((page, index) => page === pageElementsRef.current[index])) return;
    pageElementsRef.current = pages;
    setPageElementsVersion((version) => version + 1);
  }, []);
  const handlePageRendered = useCallback((renderedPage: number) => {
    retryRestoration(renderedPage);
  }, [retryRestoration]);
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    let rafId: number | null = null;
    const updateSize = () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const nextSize = measureAvailableViewport(viewer);
        setViewerSize((prev) => {
          if (!hasViewportSizeChanged(prev, nextSize, 1)) return prev;
          captureScrollAnchor();
          return nextSize;
        });
      });
    };
    const observer = new ResizeObserver(updateSize);
    observer.observe(viewer);
    const initialSize = measureAvailableViewport(viewer);
    setViewerSize((prev) => (hasViewportSizeChanged(prev, initialSize, 1) ? initialSize : prev));
    return () => {
      observer.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [captureScrollAnchor, pageSizes]);


  useLayoutEffect(() => {
    const viewer = viewerRef.current;
    const centerAnchor = zoomCenterAnchorRef.current;
    if (viewer && centerAnchor) {
      const pdfViewer = pdfViewerRef.current;
      const pages = centerAnchor.pageIndices.map((index) =>
        pageElementsRef.current[index] ?? pdfViewer?.getPageView(index)?.div ?? null,
      );
      const after = getPageElementBounds(pages);
      zoomCenterAnchorRef.current = null;
      scrollAnchorRef.current = null;
      if (after) {
        const delta = getCenterPreservingScrollDelta(centerAnchor.bounds, after, centerAnchor.center);
        viewer.scrollLeft += delta.left;
        viewer.scrollTop += delta.top;
      }
      return;
    }

    const anchor = scrollAnchorRef.current;
    const page = anchor && pageElementsRef.current[anchor.page - 1];
    if (!anchor || !viewer || !page) return;
    const top = page.getBoundingClientRect().top - viewer.getBoundingClientRect().top;
    viewer.scrollTop += top - anchor.top;
    scrollAnchorRef.current = null;
  }, [zoomState, viewerSize, pageSizes, viewMode, continuousScrolling, pageElementsVersion]);


  useEffect(() => {
    if (overlay === "search") {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    } else if (overlay === "jump") {
      jumpInputRef.current?.focus();
    }
  }, [overlay]);

  useEffect(() => {
    const restoreReaderFocus = () => {
      const activeElement = window.document.activeElement;
      if (overlay === null && activeElement === window.document.body) {
        focusReader();
      }
    };
    window.addEventListener("focus", restoreReaderFocus);
    return () => window.removeEventListener("focus", restoreReaderFocus);
  }, [overlay, focusReader]);

  useEffect(() => () => {
    generationRef.current += 1;
    void loadingTaskRef.current?.destroy();
  }, []);
  const openPdfSource = useCallback(async (source: PdfReaderSource) => {
    if (!source.name.toLowerCase().endsWith(".pdf")) {
      setError("Choose a file with a .pdf extension.");
      return;
    }
    const generation = ++generationRef.current;
    search.cancelSearch();
    const previousTask = loadingTaskRef.current;
    loadingTaskRef.current = null;
    setLoading(true);
    setError("");
    let replacementTask: PdfLoadingTask | null = null;
    try {
      const task = createPdfLoadingTask(source.bytes);
      replacementTask = task;
      loadingTaskRef.current = task;
      const pdf = await task.promise;
      const sizes = await getPdfPageSizes(pdf, () => generation === generationRef.current);
      if (!sizes) {
        await task.destroy();
        return;
      }
      let restoredPosition: ReadingPosition | null = null;
      if (source.path) {
        try {
          restoredPosition = await loadReadingPosition(source.path);
        } catch (cause) {
          setError(`Could not restore reading position: ${pdfErrorMessage(cause)}`);
        }
      }
      if (generation !== generationRef.current) {
        await task.destroy();
        return;
      }
      const restoredPage = restoredPosition
        ? Math.max(1, Math.min(pdf.numPages, Math.trunc(restoredPosition.page)))
        : 1;
      const restoredOffset = restoredPosition && Number.isFinite(restoredPosition.offset)
        ? Math.max(0, Math.min(1, restoredPosition.offset))
        : 0;
      loadingTaskRef.current = task;
      queueRestoration(source.path ? { page: restoredPage, offset: restoredOffset } : null);
      setPageNumber(restoredPage);
      setDocumentPath(source.path);
      pageElementsRef.current = [];
      scrollAnchorRef.current = null;
      zoomCenterAnchorRef.current = null;
      setDocument(pdf);
      setPageSizes(sizes);
      setZoomState({ mode: "fit-page" });
      setContinuousScrolling(false);
      search.clear();
      if (previousTask && previousTask !== task) {
        try { await previousTask.destroy(); } catch { /* Already destroyed. */ }
      }
    } catch (cause) {
      if (generation === generationRef.current) {
        loadingTaskRef.current = previousTask;
        if (replacementTask && replacementTask !== previousTask) {
          void replacementTask.destroy().catch(() => undefined);
        }
        setError(`Could not open "${source.name}": ${pdfErrorMessage(cause)}`);
      }
    } finally {
      if (generation === generationRef.current) setLoading(false);
    }
  }, []);


  useEffect(() => {
    if (!initialSource) return;
    void openPdfSource(initialSource).finally(focusReader);
    onInitialSourceConsumed();
  }, [focusReader, initialSource, onInitialSourceConsumed, openPdfSource]);

  const closeDocument = useCallback(() => {
    if (loading) return;
    generationRef.current += 1;
    search.cancelSearch();
    search.clear();
    const activeTask = loadingTaskRef.current;
    loadingTaskRef.current = null;
    pdfViewerRef.current?.setDocument(null);
    if (activeTask) void activeTask.destroy().catch(() => undefined);
    setDocument(null);
    setDocumentPath(null);
    setPageNumber(1);
    pageNumberRef.current = 1;
    setPageSizes([]);
    setZoomState({ mode: "fit-page" });
    setContinuousScrolling(false);
    setViewMode("single");
    setLoading(false);
    setError("");
    setOverlay(null);
    setJumpInput("");
    setCommandQuery("");
    setCommandIndex(0);
    activeMatchElementRef.current = null;
    pageElementsRef.current = [];
    scrollAnchorRef.current = null;
    zoomCenterAnchorRef.current = null;
    queueRestoration(null);
  }, [loading, queueRestoration, search.cancelSearch, search.clear]);

  const goToPage = useCallback((page: number) => {
    if (!totalPages || !Number.isInteger(page)) return;
    const nextPage = Math.max(1, Math.min(totalPages, page));
    if (pageNumberRef.current === nextPage && pdfViewerRef.current?.currentPageNumber === nextPage) return;
    if (pageNumberRef.current !== nextPage) {
      pageNumberRef.current = nextPage;
      setPageNumber(nextPage);
    }
    const viewer = pdfViewerRef.current;
    if (viewer && viewer.currentPageNumber !== nextPage) {
      viewer.currentPageNumber = nextPage;
    }
  }, [totalPages]);

  const getPdfReadingViewport = useCallback(() => {
    const container = viewerRef.current;
    if (!container) return null;
    const pageViewer = container.querySelector<HTMLElement>(".pdfViewer");
    const style = pageViewer ? getComputedStyle(pageViewer) : null;
    const paddingLeft = Number.parseFloat(style?.paddingLeft ?? "0") || 0;
    const paddingTop = Number.parseFloat(style?.paddingTop ?? "0") || 0;
    const size = measureAvailableViewport(container);
    const rect = container.getBoundingClientRect();
    const left = rect.left + container.clientLeft + paddingLeft;
    const top = rect.top + container.clientTop + paddingTop;
    return { left, top, right: left + size.width, bottom: top + size.height, ...size };
  }, []);
  const captureZoomCenterAnchor = useCallback(() => {
    zoomCenterAnchorRef.current = null;
    const pdfViewer = pdfViewerRef.current;
    const viewport = getPdfReadingViewport();
    if (!pdfViewer || !viewport || !pdfViewer.pagesCount) return;
    const pageIndex = Math.max(0, pdfViewer.currentPageNumber - 1);
    const pageIndices = getPageGroupIndices(pdfViewer.pagesCount, effectiveViewMode)
      .find((group) => group.includes(pageIndex));
    if (!pageIndices) return;
    const pages = pageIndices.map((index) =>
      pageElementsRef.current[index] ?? pdfViewer.getPageView(index)?.div ?? null,
    );
    const bounds = getPageElementBounds(pages);
    if (!bounds || bounds.right <= bounds.left || bounds.bottom <= bounds.top) return;
    zoomCenterAnchorRef.current = {
      pageIndices,
      bounds,
      center: { x: viewport.left + viewport.width / 2, y: viewport.top + viewport.height / 2 },
    };
    scrollAnchorRef.current = null;
  }, [effectiveViewMode, getPdfReadingViewport]);


  const getCurrentPageGroupBounds = useCallback((): RectBounds | null => {
    const viewer = pdfViewerRef.current;
    if (!viewer || !viewer.pagesCount) return null;
    const pageIndex = Math.max(0, viewer.currentPageNumber - 1);
    const pageGroup = getPageGroupIndices(viewer.pagesCount, effectiveViewMode)
      .find((group) => group.includes(pageIndex)) ?? [pageIndex];
    const pages = pageGroup.map((index) =>
      pageElementsRef.current[index] ?? viewer.getPageView(index)?.div ?? null,
    );
    return getPageElementBounds(pages);
  }, [effectiveViewMode]);

  const isPdfZoomedIn = useCallback(() => {
    const viewport = getPdfReadingViewport();
    const bounds = getCurrentPageGroupBounds();
    if (!viewport || !bounds) return false;
    return isPageZoomedIn({ width: bounds.right - bounds.left, height: bounds.bottom - bounds.top }, viewport);
  }, [getCurrentPageGroupBounds, getPdfReadingViewport]);

  const panPdf = useCallback((direction: PdfPanDirection): boolean => {
    const container = viewerRef.current;
    const viewport = getPdfReadingViewport();
    const bounds = getCurrentPageGroupBounds();
    if (!container || !viewport || !bounds) return false;
    const distance = 40;
    const isVertical = direction === "up" || direction === "down";
    const dir: -1 | 1 = direction === "up" || direction === "left" ? -1 : 1;
    const delta = isVertical
      ? getPagePanDelta(bounds.top, bounds.bottom, viewport.top, viewport.bottom, dir, distance)
      : getPagePanDelta(bounds.left, bounds.right, viewport.left, viewport.right, dir, distance);
    if (Math.abs(delta) <= 0.5) return false;
    const previousScroll = isVertical ? container.scrollTop : container.scrollLeft;
    container.scrollBy({
      left: isVertical ? 0 : delta,
      top: isVertical ? delta : 0,
      behavior: "auto",
    });
    const moved = Math.abs((isVertical ? container.scrollTop : container.scrollLeft) - previousScroll);
    return moved > 0.5;
  }, [getCurrentPageGroupBounds, getPdfReadingViewport]);
  const scrollPdfContinuous = useCallback((direction: PdfPanDirection) => {
    const distance = 48;
    viewerRef.current?.scrollBy({
      left: direction === "left" ? -distance : direction === "right" ? distance : 0,
      top: direction === "up" ? -distance : direction === "down" ? distance : 0,
      behavior: "auto",
    });
  }, []);

  const panPdfPage = useCallback((direction: -1 | 1): boolean => {
    const container = viewerRef.current;
    const viewport = getPdfReadingViewport();
    const bounds = getCurrentPageGroupBounds();
    if (!container || !viewport || !bounds) return false;
    const delta = getPagePanDelta(
      bounds.top,
      bounds.bottom,
      viewport.top,
      viewport.bottom,
      direction,
      viewport.height * 0.85,
    );
    if (Math.abs(delta) <= 0.5) return false;
    const previousTop = container.scrollTop;
    container.scrollBy({ top: delta, behavior: "auto" });
    return Math.abs(container.scrollTop - previousTop) > 0.5;
  }, [getCurrentPageGroupBounds, getPdfReadingViewport]);

  const scrollPdfToPageEdge = useCallback((edge: "top" | "bottom") => {
    const container = viewerRef.current;
    const viewport = getPdfReadingViewport();
    const bounds = getCurrentPageGroupBounds();
    if (!container || !viewport || !bounds) return;
    const delta = edge === "top" ? bounds.top - viewport.top : bounds.bottom - viewport.bottom;
    container.scrollBy({ top: delta, behavior: "auto" });
  }, [getCurrentPageGroupBounds, getPdfReadingViewport]);

  const registerActiveMatchElement = useCallback((index: number, element: HTMLDivElement | null) => {
    if (index !== activeMatchRef.current) return;
    activeMatchElementRef.current = element;
    if (!element) return;
    requestAnimationFrame(() => {
      const viewer = viewerRef.current;
      const current = activeMatchElementRef.current;
      if (!viewer || current !== element) return;
      const offset = element.getBoundingClientRect().top - viewer.getBoundingClientRect().top;
      viewer.scrollTo({ top: viewer.scrollTop + offset - viewer.clientHeight * 0.4, behavior: "auto" });
    });
  }, []);


  const handleZoomChange = useCallback((direction: number) => {
    const multiplier = direction > 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
    const basis = zoomState.mode === "manual" ? zoomState.basis : zoomState.mode;
    const factor = zoomState.mode === "manual" ? zoomState.factor : 1;
    const nextFactor = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, factor * multiplier));
    if (nextFactor === factor) return;
    captureZoomCenterAnchor();
    setZoomState({ mode: "manual", basis, factor: nextFactor });
  }, [captureZoomCenterAnchor, zoomState]);

  const restoreFitWidth = useCallback(() => {
    captureScrollAnchor();
    setZoomState({ mode: "fit-width" });
  }, [captureScrollAnchor]);
  const changeViewMode = useCallback((nextMode: ViewMode) => {
    captureScrollAnchor();
    setViewMode(nextMode);
    setZoomState((current) => {
      if (current.mode === "manual") {
        const basis = current.basis === "fit-width"
          ? current.basis
          : nextMode === "spread" ? "fit-spread" : "fit-page";
        return basis === current.basis ? current : { ...current, basis };
      }
      if (nextMode === "spread" && current.mode === "fit-page") return { mode: "fit-spread" };
      if (nextMode === "single" && current.mode === "fit-spread") return { mode: "fit-page" };
      return current;
    });
  }, [captureScrollAnchor]);

  const runReaderCommand = useCallback((command: ReaderCommandId) => {
    switch (command) {
      case "open_document":
        onOpenDocument(focusReader);
        break;
      case "close_document":
        closeDocument();
        break;
      case "toggle_night_mode":
        onToggleNightMode();
        break;
      case "search":
        if (!document) return;
        setOverlay("search");
        break;
      case "single_page_view":
        changeViewMode("single");
        break;
      case "two_page_spread":
        changeViewMode("spread");
        break;
      case "toggle_continuous_scrolling":
        captureScrollAnchor();
        setContinuousScrolling((current) => !current);
        break;
      case "next_item":
        search.moveMatch(1);
        break;
      case "previous_item":
        search.moveMatch(-1);
        break;
      case "goto_page_with_page_number":
        if (!totalPages) return;
        setJumpInput("");
        setOverlay("jump");
        break;
      case "next_page":
        goToPage(getAdjacentPageNumber(pageNumberRef.current, 1, totalPages, effectiveViewMode));
        break;
      case "previous_page":
        goToPage(getAdjacentPageNumber(pageNumberRef.current, -1, totalPages, effectiveViewMode));
        break;
      case "goto_beginning":
        goToPage(1);
        break;
      case "goto_end":
        goToPage(totalPages);
        break;
      case "zoom_in":
        handleZoomChange(1);
        break;
      case "zoom_out":
        handleZoomChange(-1);
        break;
      case "fit_to_page_width":
        restoreFitWidth();
        break;
      case "fit_to_page":
        captureScrollAnchor();
        setViewMode("single");
        setZoomState({ mode: "fit-page" });
        break;
      case "fit_to_spread":
        captureScrollAnchor();
        setViewMode("spread");
        setZoomState({ mode: "fit-spread" });
        break;
      case "toggle_recolor":
        setRecolorSettings((current) => {
          const next = { ...current, recolor: !current.recolor };
          saveRecolorSettings(next);
          return next;
        });
        break;
      case "recolor_preset_original":
        setRecolorSettings((current) => {
          const next = { ...current, recolor: false, activePreset: "original" as const };
          saveRecolorSettings(next);
          return next;
        });
        break;
      case "recolor_preset_zathura_dark":
      case "recolor_preset_gruvbox_dark":
      case "recolor_preset_solarized_dark":
      case "recolor_preset_rose_pine_dawn":
      case "recolor_preset_sepia_warm": {
        const presetId = command.replace("recolor_preset_", "").replace(/_/g, "-") as PdfRecolorPresetId;
        const preset = RECOLOR_PRESETS[presetId];
        if (preset) {
          setRecolorSettings((current) => {
            const next = {
              ...current,
              recolor: true,
              activePreset: presetId,
              recolorLightcolor: preset.lightColor,
              recolorDarkcolor: preset.darkColor,
            };
            saveRecolorSettings(next);
            return next;
          });
        }
        break;
      }
      case "recolor_toggle_keephue":
        setRecolorSettings((current) => {
          const next = { ...current, recolorKeephue: !current.recolorKeephue };
          saveRecolorSettings(next);
          return next;
        });
        break;
      case "recolor_toggle_reverse_video":
        setRecolorSettings((current) => {
          const next = { ...current, recolorReverseVideo: !current.recolorReverseVideo };
          saveRecolorSettings(next);
          return next;
        });
        break;
      case "recolor_toggle_adjust_lightness":
        setRecolorSettings((current) => {
          const next = { ...current, recolorAdjustLightness: !current.recolorAdjustLightness };
          saveRecolorSettings(next);
          return next;
        });
        break;
      case "recolor_set_lightcolor":
        setCustomColorTarget("light");
        setColorInput(recolorSettings.recolorLightcolor);
        setOverlay("recolor-color");
        requestAnimationFrame(() => colorInputRef.current?.focus());
        break;
      case "recolor_set_darkcolor":
        setCustomColorTarget("dark");
        setColorInput(recolorSettings.recolorDarkcolor);
        setOverlay("recolor-color");
        requestAnimationFrame(() => colorInputRef.current?.focus());
        break;
    }
  }, [search.moveMatch, totalPages, goToPage, effectiveViewMode, handleZoomChange, restoreFitWidth, changeViewMode, captureScrollAnchor, onToggleNightMode, onOpenDocument, closeDocument, document, recolorSettings]);

  const executePaletteCommand = useCallback((command: ReaderCommand) => {
    setOverlay(null);
    runReaderCommand(command.id);
    if (command.id !== "open_document" && command.id !== "search" && command.id !== "goto_page_with_page_number" && command.id !== "recolor_set_lightcolor" && command.id !== "recolor_set_darkcolor") {
      requestAnimationFrame(() => viewerRef.current?.focus());
    }
  }, [runReaderCommand]);

  const closeOverlay = useCallback(() => {
    setOverlay(null);
    requestAnimationFrame(() => viewerRef.current?.focus());
  }, []);

  const searchReady = normalizeSearchQuery(searchQuery) === searchedQuery;
  useReaderKeyboard(
    {
      readerKind: "pdf",
      overlay,
      commands: visibleCommands,
      searchReady,
      matchCount: matches.length,
      jumpInput,
      continuousScrolling,
      pageCount: totalPages,
      commandIndex,
    },
    {
      closeOverlay,
      moveMatch: search.moveMatch,
      runSearch: search.runSearch,
      goToPage,
      executePaletteCommand,
      runCommand: runReaderCommand,
      isPdfZoomedIn,
      panPdf,
      panPdfPage,
      scrollPdfToPageEdge,
      scrollPdfContinuous,
      setCommandQuery,
      setCommandIndex,
      setOverlay,
    },
  );

  const dismissError = () => setError("");
  return (
    <>
      {error && <div className="error-banner" role="alert"><span>{error}</span><button className="text-button" onClick={dismissError}>Dismiss</button></div>}
      <svg className="visually-hidden" aria-hidden="true" style={{ position: "absolute", width: 0, height: 0 }}>
        <defs>
          <filter id="clio-recolor-matrix" colorInterpolationFilters="sRGB">
            <feColorMatrix type="matrix" values={recolorMatrix} />
          </filter>
        </defs>
      </svg>
      <section
        className="reader-layout"
        data-recolor={recolorSettings.recolor ? "true" : "false"}
        data-recolor-mode={recolorSettings.recolorKeephue || recolorSettings.recolorReverseVideo ? "pixel" : "svg"}
        style={recolorSettings.recolor ? { "--recolor-light-color": recolorSettings.recolorLightcolor } as React.CSSProperties : undefined}
      >
        <div
          className="document-viewport"
          ref={viewerRef}
          onScroll={handleViewportScroll}
          tabIndex={-1}
          aria-label="PDF reading area"
          style={recolorSettings.recolor ? { background: recolorSettings.recolorLightcolor } : undefined}
        >
          {loading && <div className="loading-indicator" aria-label="Opening document" />}
          <div className={`pdfViewer ${continuousScrolling ? "continuous-presentation" : "paged-presentation"}`} ref={pdfViewerElementRef} />
          <PdfViewerSurface
            containerRef={viewerRef}
            viewerRef={pdfViewerElementRef}
            viewerHandle={pdfViewerRef}
            pdf={document}
            continuousScrolling={continuousScrolling}
            pageNumber={pageNumber}
            scale={pageScale}
            spread={effectiveViewMode === "spread"}
            matchesByPage={matchesByPage}
            activeMatch={activeMatch}
            onPageChange={handlePageChange}
            onActiveMatchElement={registerActiveMatchElement}
            onPageElements={handlePageElements}
            onRenderError={handlePageRenderError}
            onPageRendered={handlePageRendered}
            recolorSettings={recolorSettings}
          />
          {overlay !== "commands" && <footer className="status-bar" aria-live="polite">
            <span>
              {document ? `Page ${pageNumber} / ${totalPages}` : "Ctrl+O Open PDF or EPUB"}
              {recolorSettings.recolor && ` · ${RECOLOR_PRESETS[recolorSettings.activePreset]?.label ?? "Recolor"}`}
            </span>
            {overlay === "search" && <>
              <span className="status-prefix">/</span>
              <input
                ref={searchInputRef}
                className="status-input"
                aria-label="Search document"
                placeholder="Search"
                value={searchQuery}
                disabled={!document}
                onChange={(event) => {
                  activeMatchElementRef.current = null;
                  search.setQuery(event.currentTarget.value);
                }}
              />
              <span className="search-status">{searching ? "Searching…" : matches.length ? `${activeMatch + 1} / ${matches.length} matches` : searchedQuery ? "No matches" : ""}</span>
            </>}
            {overlay === "jump" && <>
              <span className="status-prefix">Go to</span>
              <input
                ref={jumpInputRef}
                className="status-input"
                aria-label="Page number"
                inputMode="numeric"
                placeholder={totalPages ? `1–${totalPages}` : "No document"}
                value={jumpInput}
                disabled={!document}
                onChange={(event) => setJumpInput(event.currentTarget.value)}
              />
              <span className="status-range">{totalPages ? `1–${totalPages}` : "—"}</span>
            </>}
            {overlay === "recolor-color" && <>
              <span className="status-prefix">{customColorTarget === "light" ? "Background (hex)" : "Foreground (hex)"}</span>
              <input
                ref={colorInputRef}
                className="status-input"
                aria-label={customColorTarget === "light" ? "Background hex color" : "Foreground hex color"}
                placeholder="#14161B"
                value={colorInput}
                onChange={(event) => setColorInput(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    if (isValidHexColor(colorInput)) {
                      const normalized = normalizeHexColor(colorInput);
                      setRecolorSettings((current) => {
                        const next = {
                          ...current,
                          recolor: true,
                          activePreset: "custom" as const,
                          [customColorTarget === "light" ? "recolorLightcolor" : "recolorDarkcolor"]: normalized,
                        };
                        saveRecolorSettings(next);
                        return next;
                      });
                      closeOverlay();
                    } else {
                      setError("Invalid hex color. Enter 3 or 6 hex characters (e.g. #14161B).");
                    }
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    closeOverlay();
                  }
                }}
              />
            </>}
            {loading && <span>Opening PDF…</span>}
          </footer>}
          {overlay === "commands" && <ReaderCommandPalette
            commands={visibleCommands}
            commandIndex={commandIndex}
            query={commandQuery}
            onQueryChange={setCommandQuery}
            onCommandIndexChange={setCommandIndex}
            onExecute={executePaletteCommand}
          />}
        </div>
      </section>
    </>
  );
}

export default PdfReader;
