import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { preparePdfDocument, pdfErrorMessage } from "../pdf/engine";
import type { PdfDocument, PdfLoadingTask, PdfReaderOpenRequest } from "../pdf/engine";
import { PdfViewerSurface } from "../pdf/PdfViewerSurface";
import type { PdfViewerHandle } from "../pdf/PdfViewerSurface";
import { normalizeSearchQuery, usePdfSearch } from "../pdf/search";
import type { SearchMatch } from "../pdf/search";
import { getSearchRevealScroll } from "../pdf/searchReveal";
import { loadReadingPosition } from "../platform/readingPosition";
import type { ReadingPosition } from "../platform/readingPosition";
import {
  computeSvgColorMatrix,
  isValidHexColor,
  loadRecolorSettings,
  normalizeHexColor,
  saveRecolorSettings,
} from "../pdf/recolor";
import type { PdfRecolorSettings } from "../pdf/recolor";
import { applyPdfTheme, getPdfSearchAppearance, getPdfThemeState } from "../pdf/appearance";
import { DOCUMENT_THEMES } from "./appearance";
import { commandTheme, pdfAdvancedAppearanceCommands, searchableReaderCommands, themeCommands } from "./appearanceCommands";
import {
  calculateFitScale,
  getCenterPreservingScrollDelta,
  getPageGroupIndices,
  getAdjacentPageNumber,
  createPagedWheelState,
  getPagedWheelAction,
  createWheelZoomState,
  getWheelZoomDirection,
  getNextZoomFactor,
  getPagePanDelta,
  hasViewportSizeChanged,
  MIN_SPREAD_PAGE_WIDTH,
  measureAvailableViewport,
  SPREAD_GAP,
} from "./layout";
import type { PageSize, RectBounds, ViewMode, ViewportSize, ZoomState } from "./layout";
import {
  filterReaderCommands,
  READER_COMMANDS,
  useReaderKeyboard,
} from "./interactions";
import type { PdfPanDirection, PdfZoomOverflow, ReaderCommandId, ReaderOverlay } from "./interactions";
import type { ReaderCommand } from "./interactions";
import { ReaderCommandPalette } from "./ReaderCommandPalette";
import { getPdfCommandStates } from "./commandState";
import { deferPdfOpen } from "./deferPdfOpen";
import { useReadingPosition } from "./useReadingPosition";
import "./Reader.css";
import "./ReaderStatus.css";


type ZoomPoint = { x: number; y: number };
type ZoomAnchor = {
  pageIndices: number[];
  bounds: RectBounds;
  point: ZoomPoint;
  pointer: boolean;
};
type SearchTarget = { pdf: PdfDocument; match: SearchMatch };

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
  nightMode,
  onToggleNightMode,
  onOpenDocument,
  initialSource,
  onInitialSourceConsumed,
  onDocumentChange,
  openGeneration,
}: {
  nightMode: boolean;
  onToggleNightMode: () => void;
  onOpenDocument: (restoreFocus?: () => void) => void;
  initialSource: PdfReaderOpenRequest | null;
  onInitialSourceConsumed: (request: PdfReaderOpenRequest) => void;
  onDocumentChange: (name: string | null) => void;
  openGeneration: number;
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
  const [jumpError, setJumpError] = useState("");
  const jumpFeedbackId = useId();
  const jumpRangeId = useId();
  const [commandQuery, setCommandQuery] = useState("");
  const [commandIndex, setCommandIndex] = useState(0);
  const [paletteMode, setPaletteMode] = useState<"commands" | "themes" | "advanced-appearance">("commands");
  const [recolorSettings, setRecolorSettings] = useState<PdfRecolorSettings>(() => loadRecolorSettings());
  const [customColorTarget, setCustomColorTarget] = useState<"light" | "dark" | null>(null);
  const [colorInput, setColorInput] = useState("");
  const colorInputRef = useRef<HTMLInputElement>(null);

  const activeMatchElementRef = useRef<(SearchTarget & { element: HTMLDivElement }) | null>(null);
  const pendingSearchRevealRef = useRef<(SearchTarget & { context: boolean; ready: boolean }) | null>(null);
  const searchRevealFrameRef = useRef<number | null>(null);
  const scheduleSearchRevealRef = useRef<() => void>(() => {});
  const documentRef = useRef(document);
  documentRef.current = document;
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
  const zoomAnchorRef = useRef<ZoomAnchor | null>(null);
  const zoomAnchorFrameRef = useRef<number | null>(null);
  const pagedWheelStateRef = useRef(createPagedWheelState());
  const wheelZoomStateRef = useRef(createWheelZoomState());
  const wheelZoomFrameRef = useRef<number | null>(null);
  const pendingWheelZoomRef = useRef<{ direction: -1 | 1; point: ZoomPoint } | null>(null);
  const pageNumberRef = useRef(1);
  const loadingTaskRef = useRef<PdfLoadingTask | null>(null);
  const committedTaskRef = useRef<PdfLoadingTask | null>(null);
  const ownedTasksRef = useRef(new Set<PdfLoadingTask>());
  const generationRef = useRef(0);
  const openGenerationRef = useRef(openGeneration);
  openGenerationRef.current = openGeneration;
  const pendingOpenRef = useRef<{ generation: number; localGeneration: number } | null>(null);
  const totalPages = document?.numPages ?? 0;
  pageNumberRef.current = pageNumber;

  const selectSearchMatch = useCallback((match: SearchMatch) => {
    const pdf = documentRef.current;
    if (!pdf) return;
    pendingSearchRevealRef.current = { pdf, match, context: true, ready: true };
    if (pageNumberRef.current !== match.page) {
      pageNumberRef.current = match.page;
      setPageNumber(match.page);
    }
    const pdfViewer = pdfViewerRef.current;
    if (pdfViewer && pdfViewer.currentPageNumber !== match.page) {
      pdfViewer.currentPageNumber = match.page;
    }
    scheduleSearchRevealRef.current();
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
  const appearance = getPdfThemeState(recolorSettings);
  const searchAppearance = useMemo(() => getPdfSearchAppearance(recolorSettings), [recolorSettings]);
  const themeLabel = DOCUMENT_THEMES.find((theme) => theme.id === appearance.effective)?.label ?? "Custom";
  const themes = themeCommands("pdf", appearance.effective, appearance.saved, "Saved — recoloring off");
  const advancedAppearance = pdfAdvancedAppearanceCommands();
  const visibleCommands = filterReaderCommands(commandQuery, document !== null && !loading, "pdf",
    paletteMode === "themes" ? themes : paletteMode === "advanced-appearance" ? advancedAppearance
      : searchableReaderCommands(READER_COMMANDS, [themes, advancedAppearance], commandQuery));
  const effectiveViewMode: ViewMode = viewMode === "spread" &&
    viewerSize.width >= MIN_SPREAD_PAGE_WIDTH * 2 + SPREAD_GAP ? "spread" : "single";
  const commandStates = useMemo(() => getPdfCommandStates({
    viewMode, effectiveViewMode, zoomMode: zoomState.mode, continuousScrolling, nightMode, recolorSettings,
  }), [viewMode, effectiveViewMode, zoomState.mode, continuousScrolling, nightMode, recolorSettings]);
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

  const cancelSearchReveal = useCallback(() => {
    pendingSearchRevealRef.current = null;
    if (searchRevealFrameRef.current !== null) cancelAnimationFrame(searchRevealFrameRef.current);
    searchRevealFrameRef.current = null;
  }, []);
  useLayoutEffect(() => () => {
    cancelSearchReveal();
    activeMatchElementRef.current = null;
  }, [document, cancelSearchReveal]);

  const retainVisibleSearchMatch = useCallback(() => {
    if (pendingSearchRevealRef.current?.context) return;
    const active = activeMatchElementRef.current;
    const viewer = viewerRef.current;
    if (!active?.element.isConnected || active.pdf !== documentRef.current || !viewer) return;
    const rect = active.element.getBoundingClientRect();
    const viewport = viewer.getBoundingClientRect();
    // Do not return to a result the reader has deliberately scrolled away from.
    if (rect.bottom > viewport.top && rect.top < viewport.bottom &&
      rect.right > viewport.left && rect.left < viewport.right) {
      pendingSearchRevealRef.current = { pdf: active.pdf, match: active.match, context: false, ready: false };
    }
  }, []);

  const captureScrollAnchor = useCallback(() => {
    retainVisibleSearchMatch();
    if (zoomAnchorFrameRef.current !== null) cancelAnimationFrame(zoomAnchorFrameRef.current);
    zoomAnchorFrameRef.current = null;
    zoomAnchorRef.current = null;
    const viewer = viewerRef.current;
    const page = pageElementsRef.current[pageNumberRef.current - 1];
    if (viewer && page) {
      scrollAnchorRef.current = {
        page: pageNumberRef.current,
        top: page.getBoundingClientRect().top - viewer.getBoundingClientRect().top,
      };
    }
  }, [retainVisibleSearchMatch]);



  const handlePageRenderError = useCallback((message: string) => setError(message), []);
  const handlePageChange = useCallback((nextPage: number) => {
    // PDF.js emits intermediate visible-page changes while regrouping/scaling.
    // Do not let those change the fit basis before the pending result is revealed.
    if (pendingSearchRevealRef.current && nextPage !== pendingSearchRevealRef.current.match.page) return;
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
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    let rafId: number | null = null;
    const updateSize = () => {
      // Capture before deferred overlay/fit-layout work replaces the old bounds.
      retainVisibleSearchMatch();
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
  }, [captureScrollAnchor, retainVisibleSearchMatch, pageSizes]);


  const applyZoomAnchor = useCallback((anchor: ZoomAnchor) => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const pdfViewer = pdfViewerRef.current;
    const pages = anchor.pageIndices.map((index) =>
      pageElementsRef.current[index] ?? pdfViewer?.getPageView(index)?.div ?? null,
    );
    const after = getPageElementBounds(pages);
    if (!after) return;
    const delta = getCenterPreservingScrollDelta(anchor.bounds, after, anchor.point);
    viewer.scrollLeft += delta.left;
    viewer.scrollTop += delta.top;
  }, []);

  useLayoutEffect(() => {
    const viewer = viewerRef.current;
    const zoomAnchor = zoomAnchorRef.current;
    if (viewer && zoomAnchor) {
      scrollAnchorRef.current = null;
      if (!zoomAnchor.pointer) zoomAnchorRef.current = null;
      applyZoomAnchor(zoomAnchor);
      if (zoomAnchor.pointer) {
        // PDF.js can recenter again as its page/scale events commit. Retain the
        // same document point through those commits and finish after layout.
        if (zoomAnchorFrameRef.current !== null) cancelAnimationFrame(zoomAnchorFrameRef.current);
        zoomAnchorFrameRef.current = requestAnimationFrame(() => {
          zoomAnchorFrameRef.current = null;
          if (zoomAnchorRef.current !== zoomAnchor) return;
          applyZoomAnchor(zoomAnchor);
          zoomAnchorRef.current = null;
        });
      }
      return;
    }

    const anchor = scrollAnchorRef.current;
    const page = anchor && pageElementsRef.current[anchor.page - 1];
    if (!anchor || !viewer || !page) return;
    const top = page.getBoundingClientRect().top - viewer.getBoundingClientRect().top;
    viewer.scrollTop += top - anchor.top;
    scrollAnchorRef.current = null;
  }, [zoomState, viewerSize, pageSizes, viewMode, continuousScrolling, pageElementsVersion, pageScale, pageNumber, applyZoomAnchor]);
  useLayoutEffect(() => {
    const pending = pendingSearchRevealRef.current;
    if (!pending) return;
    // A resize overlay sync may precede React's fit/layout commit. Only consume
    // its reveal after that commit and the existing reading anchors have run.
    pending.ready = true;
    scheduleSearchRevealRef.current();
  }, [zoomState, viewerSize, effectiveViewMode, continuousScrolling, pageScale]);


  useEffect(() => {
    if (overlay === "search") {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    } else if (overlay === "jump") {
      jumpInputRef.current?.focus();
    }
  }, [overlay]);

  useEffect(() => {
    setJumpError("");
  }, [overlay, document]);

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

  const releaseTask = useCallback(async (task: PdfLoadingTask | null) => {
    if (!task || !ownedTasksRef.current.delete(task)) return;
    try { await task.destroy(); } catch { /* Already destroyed. */ }
  }, []);

  useEffect(() => () => {
    generationRef.current += 1;
    loadingTaskRef.current = null;
    committedTaskRef.current = null;
    pendingOpenRef.current = null;
    for (const task of ownedTasksRef.current) void releaseTask(task);
  }, [releaseTask]);
  useEffect(() => {
    const pending = pendingOpenRef.current;
    if (!pending || pending.generation === openGeneration) return;
    generationRef.current += 1;
    pendingOpenRef.current = null;
    if (loadingTaskRef.current !== committedTaskRef.current) void releaseTask(loadingTaskRef.current);
    loadingTaskRef.current = committedTaskRef.current;
    setLoading(false);
  }, [openGeneration, releaseTask]);
  const openPdfSource = useCallback(async (request: PdfReaderOpenRequest) => {
    if (request.generation !== openGenerationRef.current) return;
    const { source } = request;
    const generation = ++generationRef.current;
    const isCurrent = () => generation === generationRef.current
      && request.generation === openGenerationRef.current;
    pendingOpenRef.current = { generation: request.generation, localGeneration: generation };
    search.cancelSearch();
    const previousTask = committedTaskRef.current;
    if (loadingTaskRef.current !== previousTask) void releaseTask(loadingTaskRef.current);
    loadingTaskRef.current = previousTask;
    setLoading(true);
    setError("");
    let replacementTask: PdfLoadingTask | null = null;
    const takeTask = (task: PdfLoadingTask) => {
      replacementTask = task;
      ownedTasksRef.current.add(task);
      loadingTaskRef.current = task;
    };
    // Claim a prepared task synchronously, before awaiting restoration or parsing.
    if (request.prepared) takeTask(request.prepared.task);
    try {
      const prepared = request.prepared ?? await preparePdfDocument(
        source.bytes,
        isCurrent,
        takeTask,
      );
      if (!prepared) {
        if (isCurrent()) loadingTaskRef.current = previousTask;
        await releaseTask(replacementTask);
        return;
      }
      const { task, pdf, sizes } = prepared;
      let restoredPosition: ReadingPosition | null = null;
      if (source.path) {
        try {
          restoredPosition = await loadReadingPosition(source.path);
        } catch (cause) {
          if (isCurrent()) {
            setError(`Could not restore reading position: ${pdfErrorMessage(cause)}`);
          }
        }
      }
      if (!isCurrent()) {
        await releaseTask(task);
        return;
      }
      const restoredPage = restoredPosition
        ? Math.max(1, Math.min(pdf.numPages, Math.trunc(restoredPosition.page)))
        : 1;
      const restoredOffset = restoredPosition && Number.isFinite(restoredPosition.offset)
        ? Math.max(0, Math.min(1, restoredPosition.offset))
        : 0;
      loadingTaskRef.current = task;
      committedTaskRef.current = task;
      queueRestoration(source.path ? { page: restoredPage, offset: restoredOffset } : null);
      setPageNumber(restoredPage);
      setDocumentPath(source.path);
      pageElementsRef.current = [];
      scrollAnchorRef.current = null;
      zoomAnchorRef.current = null;
      setDocument(pdf);
      onDocumentChange(source.name);
      setPageSizes(sizes);
      setZoomState({ mode: "fit-page" });
      setContinuousScrolling(false);
      search.clear();
      if (previousTask && previousTask !== task) await releaseTask(previousTask);
    } catch (cause) {
      await releaseTask(replacementTask);
      if (isCurrent()) {
        loadingTaskRef.current = previousTask;
        setError(`Could not open "${source.name}": ${pdfErrorMessage(cause)}`);
      }
    } finally {
      if (isCurrent()) {
        if (pendingOpenRef.current?.localGeneration === generation) pendingOpenRef.current = null;
        setLoading(false);
      }
    }
  }, [onDocumentChange, queueRestoration, releaseTask, search.cancelSearch, search.clear]);


  useEffect(() => {
    if (!initialSource) return;
    return deferPdfOpen(() => {
      if (initialSource.generation !== openGenerationRef.current) return;
      const opening = openPdfSource(initialSource);
      const generation = generationRef.current;
      void opening.finally(() => {
        if (generation === generationRef.current && initialSource.generation === openGenerationRef.current) {
          focusReader();
        }
      });
      onInitialSourceConsumed(initialSource);
    });
  }, [focusReader, initialSource, onInitialSourceConsumed, openPdfSource]);

  const closeDocument = useCallback(() => {
    if (loading) return;
    generationRef.current += 1;
    search.cancelSearch();
    search.clear();
    const activeTask = loadingTaskRef.current;
    loadingTaskRef.current = null;
    committedTaskRef.current = null;
    pdfViewerRef.current?.setDocument(null);
    void releaseTask(activeTask);
    setDocument(null);
    onDocumentChange(null);
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
    zoomAnchorRef.current = null;
    queueRestoration(null);
  }, [loading, onDocumentChange, queueRestoration, releaseTask, search.cancelSearch, search.clear]);

  const goToPage = useCallback((page: number) => {
    cancelSearchReveal();
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
  }, [totalPages, cancelSearchReveal]);

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
  const scheduleSearchReveal = useCallback(() => {
    if (searchRevealFrameRef.current !== null) cancelAnimationFrame(searchRevealFrameRef.current);
    searchRevealFrameRef.current = requestAnimationFrame(() => {
      searchRevealFrameRef.current = null;
      const pending = pendingSearchRevealRef.current;
      const active = activeMatchElementRef.current;
      const viewer = viewerRef.current;
      const viewport = getPdfReadingViewport();
      if (!pending?.ready || !active || !viewer || !viewport || pending.pdf !== documentRef.current ||
        active.pdf !== pending.pdf || active.match !== pending.match || !active.element.isConnected ||
        pdfViewerRef.current?.pdfDocument !== pending.pdf) return;
      pendingSearchRevealRef.current = null;
      const bounds = active.element.getBoundingClientRect();
      if (pending.context || bounds.top < viewport.top + 4 || bounds.bottom > viewport.bottom - 4 ||
        bounds.left < viewport.left + 4 || bounds.right > viewport.right - 4) {
        viewer.scrollTo({ ...getSearchRevealScroll(bounds, viewport, viewer), behavior: "auto" });
      }
    });
  }, [getPdfReadingViewport]);
  scheduleSearchRevealRef.current = scheduleSearchReveal;
  const captureZoomAnchor = useCallback((pointer?: ZoomPoint) => {
    retainVisibleSearchMatch();
    if (zoomAnchorFrameRef.current !== null) cancelAnimationFrame(zoomAnchorFrameRef.current);
    zoomAnchorFrameRef.current = null;
    zoomAnchorRef.current = null;
    const pdfViewer = pdfViewerRef.current;
    const viewport = getPdfReadingViewport();
    if (!pdfViewer || !viewport || !pdfViewer.pagesCount) return;
    const point = pointer ? {
      x: Math.max(viewport.left, Math.min(viewport.right, pointer.x)),
      y: Math.max(viewport.top, Math.min(viewport.bottom, pointer.y)),
    } : { x: viewport.left + viewport.width / 2, y: viewport.top + viewport.height / 2 };
    const hit = pointer ? viewerRef.current?.ownerDocument.elementFromPoint(point.x, point.y)
      ?.closest<HTMLElement>(".page[data-page-number]") : null;
    const pointerIndex = hit && viewerRef.current?.contains(hit) ? Number(hit.dataset.pageNumber) - 1 : -1;
    const pageIndex = Math.max(0, pdfViewer.currentPageNumber - 1);
    // In continuous mode the page under the pointer need not be the current page.
    // In gaps/margins, retain the current group's geometry as the fallback.
    const pageIndices = pointerIndex >= 0 && pointerIndex < pdfViewer.pagesCount ? [pointerIndex] :
      getPageGroupIndices(pdfViewer.pagesCount, effectiveViewMode).find((group) => group.includes(pageIndex));
    if (!pageIndices) return;
    const pages = pageIndices.map((index) =>
      pageElementsRef.current[index] ?? pdfViewer.getPageView(index)?.div ?? null,
    );
    const bounds = getPageElementBounds(pages);
    if (!bounds || bounds.right <= bounds.left || bounds.bottom <= bounds.top) return;
    zoomAnchorRef.current = { pageIndices, bounds, point, pointer: pointer !== undefined };
    scrollAnchorRef.current = null;
  }, [effectiveViewMode, getPdfReadingViewport, retainVisibleSearchMatch]);


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

  const getPdfZoomOverflow = useCallback((): PdfZoomOverflow => {
    const viewport = getPdfReadingViewport();
    const bounds = getCurrentPageGroupBounds();
    if (!viewport || !bounds) return { horizontal: false, vertical: false };
    return {
      horizontal: bounds.right - bounds.left > viewport.width + 0.5,
      vertical: bounds.bottom - bounds.top > viewport.height + 0.5,
    };
  }, [getCurrentPageGroupBounds, getPdfReadingViewport]);

  const isPdfZoomedIn = useCallback(() => {
    const overflow = getPdfZoomOverflow();
    return overflow.horizontal || overflow.vertical;
  }, [getPdfZoomOverflow]);

  const panPdf = useCallback((direction: PdfPanDirection): boolean => {
    cancelSearchReveal();
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
  }, [getCurrentPageGroupBounds, getPdfReadingViewport, cancelSearchReveal]);
  const scrollPdfContinuous = useCallback((direction: PdfPanDirection) => {
    cancelSearchReveal();
    const distance = 48;
    viewerRef.current?.scrollBy({
      left: direction === "left" ? -distance : direction === "right" ? distance : 0,
      top: direction === "up" ? -distance : direction === "down" ? distance : 0,
      behavior: "auto",
    });
  }, [cancelSearchReveal]);

  const panPdfPage = useCallback((direction: -1 | 1): boolean => {
    cancelSearchReveal();
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
  }, [getCurrentPageGroupBounds, getPdfReadingViewport, cancelSearchReveal]);

  const scrollPdfToPageEdge = useCallback((edge: "top" | "bottom") => {
    cancelSearchReveal();
    const container = viewerRef.current;
    const viewport = getPdfReadingViewport();
    const bounds = getCurrentPageGroupBounds();
    if (!container || !viewport || !bounds) return;
    const delta = edge === "top" ? bounds.top - viewport.top : bounds.bottom - viewport.bottom;
    container.scrollBy({ top: delta, behavior: "auto" });
  }, [getCurrentPageGroupBounds, getPdfReadingViewport, cancelSearchReveal]);
  const pendingPageEdgeRef = useRef<"top" | "bottom" | null>(null);

  const confirmAndAlignPageEdge = useCallback((): boolean => {
    const edge = pendingPageEdgeRef.current;
    if (!edge) return true;
    const container = viewerRef.current;
    const viewport = getPdfReadingViewport();
    const bounds = getCurrentPageGroupBounds();
    if (!container || !viewport || !bounds || bounds.bottom <= bounds.top) return false;

    const pageHeight = bounds.bottom - bounds.top;
    const delta = edge === "top" ? bounds.top - viewport.top : bounds.bottom - viewport.bottom;

    if (Math.abs(delta) <= 1.0) {
      pendingPageEdgeRef.current = null;
      return true;
    }

    const pageFitsInViewport = pageHeight <= viewport.height + 0.5 &&
      bounds.top >= viewport.top - 1.0 &&
      bounds.bottom <= viewport.bottom + 1.0;

    const prevTop = container.scrollTop;
    container.scrollBy({ top: delta, behavior: "auto" });

    const updatedViewport = getPdfReadingViewport();
    const updatedBounds = getCurrentPageGroupBounds();
    if (!updatedViewport || !updatedBounds) return false;

    const remaining = edge === "top"
      ? updatedBounds.top - updatedViewport.top
      : updatedBounds.bottom - updatedViewport.bottom;

    if (Math.abs(remaining) <= 1.0) {
      pendingPageEdgeRef.current = null;
      return true;
    }

    if (pageFitsInViewport && Math.abs(container.scrollTop - prevTop) <= 0.5) {
      pendingPageEdgeRef.current = null;
      return true;
    }

    return false;
  }, [getCurrentPageGroupBounds, getPdfReadingViewport]);

  const navigatePageWithBoundary = useCallback((direction: -1 | 1) => {
    const targetPage = getAdjacentPageNumber(pageNumberRef.current, direction, totalPages, effectiveViewMode);
    if (targetPage === pageNumberRef.current) return;
    pendingPageEdgeRef.current = direction < 0 ? "bottom" : "top";
    goToPage(targetPage);
  }, [effectiveViewMode, goToPage, totalPages]);

  const handleZoomChange = useCallback((direction: number, pointer?: ZoomPoint) => {
    const basis = zoomState.mode === "manual" ? zoomState.basis : zoomState.mode;
    const factor = zoomState.mode === "manual" ? zoomState.factor : 1;
    const nextFactor = getNextZoomFactor(factor, direction);
    if (nextFactor === factor) return;
    captureZoomAnchor(pointer);
    setZoomState({ mode: "manual", basis, factor: nextFactor });
  }, [captureZoomAnchor, zoomState]);
  const zoomChangeRef = useRef(handleZoomChange);
  zoomChangeRef.current = handleZoomChange;

  const cancelWheelZoom = useCallback(() => {
    if (wheelZoomFrameRef.current !== null) cancelAnimationFrame(wheelZoomFrameRef.current);
    if (zoomAnchorFrameRef.current !== null) cancelAnimationFrame(zoomAnchorFrameRef.current);
    zoomAnchorFrameRef.current = null;
    if (zoomAnchorRef.current?.pointer) zoomAnchorRef.current = null;
    wheelZoomFrameRef.current = null;
    pendingWheelZoomRef.current = null;
    wheelZoomStateRef.current.distance = 0;
    wheelZoomStateRef.current.lastEventAt = Number.NEGATIVE_INFINITY;
  }, []);

  const handlePdfWheel = useCallback((event: WheelEvent) => {
    const target = event.target;
    const modified = event.ctrlKey || event.metaKey || event.altKey || event.shiftKey;
    const blocked = overlay !== null || event.defaultPrevented || !event.cancelable ||
      !pdfViewerRef.current || (target instanceof Element && target.closest(
        ".status-bar, .command-palette, input, textarea, select, button, [contenteditable], [role='textbox']",
      ) !== null);
    if (event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey &&
      !blocked && pdfViewerRef.current!.pagesCount > 0) {
      const startingZoom = wheelZoomStateRef.current.lastEventAt === Number.NEGATIVE_INFINITY;
      const direction = getWheelZoomDirection(wheelZoomStateRef.current, {
        deltaY: event.deltaY, deltaMode: event.deltaMode, now: performance.now(),
      }, event.deltaMode === 2 ? getPdfReadingViewport()?.height ?? 0 : 0);
      if (direction === null) {
        cancelWheelZoom();
        return;
      }
      // Own valid Ctrl+Wheel even below the threshold and at zoom limits:
      // never fall through to scrolling, page turns, or WebKit page zoom.
      event.preventDefault();
      if (startingZoom) pagedWheelStateRef.current = createPagedWheelState();
      const point = { x: event.clientX, y: event.clientY };
      if (pendingWheelZoomRef.current) pendingWheelZoomRef.current.point = point;
      if (direction !== 0) {
        pendingWheelZoomRef.current = { direction, point };
        if (wheelZoomFrameRef.current === null) {
          wheelZoomFrameRef.current = requestAnimationFrame(() => {
            wheelZoomFrameRef.current = null;
            const pending = pendingWheelZoomRef.current;
            pendingWheelZoomRef.current = null;
            // Merge a frame's events into one 5% step, with no deferred backlog.
            if (pending) zoomChangeRef.current(pending.direction, pending.point);
          });
        }
      }
      return;
    }
    cancelWheelZoom();
    const nativeOnly = continuousScrolling || modified || blocked;
    const viewport = nativeOnly ? null : getPdfReadingViewport();
    const bounds = nativeOnly ? null : getCurrentPageGroupBounds();
    const pageBounds = {
      width: bounds ? bounds.right - bounds.left : 0,
      height: bounds ? bounds.bottom - bounds.top : 0,
    };
    const action = getPagedWheelAction(pagedWheelStateRef.current, {
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      deltaMode: event.deltaMode,
      now: performance.now(),
      continuousScrolling,
      modified,
      blocked,
    }, pageBounds, viewport ?? pageBounds);
    // PDF.js PAGE mode mounts only the active group. Native overflow therefore
    // scrolls and clamps within that group, without a competing custom scroll.
    if (action === null) return;
    event.preventDefault();
    if (action !== 0) navigatePageWithBoundary(action);
  }, [continuousScrolling, overlay, getPdfReadingViewport, getCurrentPageGroupBounds, navigatePageWithBoundary, cancelWheelZoom]);

  useEffect(() => {
    const viewport = viewerRef.current;
    if (!viewport) return;
    viewport.addEventListener("wheel", handlePdfWheel, { passive: false });
    return () => {
      viewport.removeEventListener("wheel", handlePdfWheel);
      cancelWheelZoom();
    };
  }, [handlePdfWheel, cancelWheelZoom]);
  useEffect(() => {
    pagedWheelStateRef.current = createPagedWheelState();
    // A wheel-driven page change must not rearm its own continuing burst.
  }, [continuousScrolling, overlay, document, zoomState, viewerSize, effectiveViewMode]);
  useLayoutEffect(() => {
    // Cancel before a queued zoom frame can act on a changed reader context.
    cancelWheelZoom();
  }, [continuousScrolling, overlay, document, viewerSize, effectiveViewMode, cancelWheelZoom]);

  useLayoutEffect(() => {
    confirmAndAlignPageEdge();
  }, [pageNumber, confirmAndAlignPageEdge]);

  const handlePageRendered = useCallback((renderedPage: number) => {
    if (renderedPage === pageNumberRef.current && pendingPageEdgeRef.current) {
      confirmAndAlignPageEdge();
    }
    retryRestoration(renderedPage);
  }, [confirmAndAlignPageEdge, retryRestoration]);

  const registerActiveMatchElement = useCallback((index: number, element: HTMLDivElement | null) => {
    const match = matches[index];
    if (index !== activeMatchRef.current || !element?.isConnected || !document || !match ||
      pdfViewerRef.current?.pdfDocument !== document) return;
    activeMatchElementRef.current = { element, match, pdf: document };
    if (pendingSearchRevealRef.current) scheduleSearchReveal();
  }, [matches, activeMatchRef, document, scheduleSearchReveal]);



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
    const theme = commandTheme(command);
    if (theme) {
      setRecolorSettings((current) => {
        const next = applyPdfTheme(current, theme);
        saveRecolorSettings(next);
        return next;
      });
      return;
    }
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
    if (command.disabled) return;
    if (command.id === "document_appearance" || command.id === "pdf_advanced_appearance" || command.id === "back_to_commands") {
      setPaletteMode(command.id === "document_appearance" ? "themes" : command.id === "pdf_advanced_appearance" ? "advanced-appearance" : "commands");
      setCommandQuery("");
      setCommandIndex(0);
      return;
    }
    if (commandTheme(command.id) || command.id === "toggle_recolor" || command.id.startsWith("recolor_toggle_")) {
      runReaderCommand(command.id);
      return;
    }
    setPaletteMode("commands");
    setOverlay(null);
    runReaderCommand(command.id);
    if (command.id !== "open_document" && command.id !== "search" && command.id !== "goto_page_with_page_number" && command.id !== "recolor_set_lightcolor" && command.id !== "recolor_set_darkcolor") {
      requestAnimationFrame(() => viewerRef.current?.focus());
    }
  }, [runReaderCommand]);

  const closeOverlay = useCallback(() => {
    setOverlay(null);
    setPaletteMode("commands");
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
      reportInvalidPage: setJumpError,
      executePaletteCommand,
      runCommand: runReaderCommand,
      isPdfZoomedIn,
      getPdfZoomOverflow,
      panPdf,
      panPdfPage,
      navigatePageWithBoundary,
      scrollPdfToPageEdge,
      scrollPdfContinuous,
      setCommandQuery,
      setCommandIndex,
      setOverlay: (next) => {
        if (next === "commands") setPaletteMode("commands");
        setOverlay(next);
      },
    },
  );

  const dismissError = () => setError("");
  const searchStatusText = searching ? "Searching…" : matches.length
    ? `${activeMatch + 1} / ${matches.length} matches`
    : searchedQuery ? "No matches" : "";
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
        style={{
          "--recolor-light-color": recolorSettings.recolor ? recolorSettings.recolorLightcolor : undefined,
          "--pdf-search-boundary": searchAppearance.boundary,
        } as React.CSSProperties}
      >
        <div
          className="document-viewport"
          ref={viewerRef}
          onScroll={handleViewportScroll}
          onWheelCapture={cancelSearchReveal}
          onPointerDownCapture={cancelSearchReveal}
          onTouchStartCapture={cancelSearchReveal}
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
          <footer className="status-bar" data-overlay={overlay ?? undefined} aria-live="polite">
            <span className="status-document">
              <span className="status-page">{document ? `Page ${pageNumber} / ${totalPages}` : "Ctrl+O Open PDF or EPUB"}</span>
              {recolorSettings.recolor && <span className="status-preset" title={themeLabel}>
                · {themeLabel}
              </span>}
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
                  cancelSearchReveal();
                  search.setQuery(event.currentTarget.value);
                }}
              />
            </>}
            {searchStatusText && <span className="search-status" role="status" title={searchStatusText}>{searchStatusText}</span>}
            {overlay === "jump" && <>
              <span className="status-prefix">Go to</span>
              <input
                ref={jumpInputRef}
                className="status-input"
                aria-label="Page number"
                aria-invalid={jumpError ? true : undefined}
                aria-describedby={jumpError ? jumpFeedbackId : jumpRangeId}
                inputMode="numeric"
                placeholder={totalPages ? `1–${totalPages}` : "No document"}
                value={jumpInput}
                disabled={!document}
                onChange={(event) => {
                  setJumpInput(event.currentTarget.value);
                  setJumpError("");
                }}
              />
              <span id={jumpRangeId} className="status-range" hidden={!!jumpError}>{totalPages ? `1–${totalPages}` : "—"}</span>
              <span id={jumpFeedbackId} className={jumpError ? "status-feedback" : "visually-hidden"} role="alert" title={jumpError}>{jumpError}</span>
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
            {loading && <span className="status-loading">Opening PDF…</span>}
            {overlay === null && <button className="status-commands" aria-label="Open reader commands (:)" onClick={() => {
              setPaletteMode("commands");
              setCommandQuery("");
              setCommandIndex(0);
              setOverlay("commands");
            }}>Commands :</button>}
          </footer>
          {overlay === "commands" && <ReaderCommandPalette
            commands={visibleCommands}
            commandStates={commandStates}
            commandIndex={commandIndex}
            query={commandQuery}
            placeholder={paletteMode === "themes" ? "Filter document themes" : paletteMode === "advanced-appearance" ? "Filter advanced PDF appearance" : "Filter commands"}
            ariaLabel={paletteMode === "themes" ? "Document themes" : paletteMode === "advanced-appearance" ? "Advanced PDF appearance" : "Reader commands"}
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
