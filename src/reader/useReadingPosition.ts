import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";
import { pdfErrorMessage } from "../pdf/engine";
import type { ReadingPosition } from "../platform/readingPosition";
import { saveReadingPosition } from "../platform/readingPosition";

export function useReadingPosition({
  path,
  pageNumber,
  pageNumberRef,
  viewerRef,
  pageElementsRef,
  layoutVersion,
  onError,
}: {
  path: string | null;
  pageNumber: number;
  pageNumberRef: RefObject<number>;
  viewerRef: RefObject<HTMLDivElement | null>;
  pageElementsRef: RefObject<(HTMLDivElement | null)[]>;
  layoutVersion: unknown;
  onError: (message: string) => void;
}) {
  const positionSaveTimerRef = useRef<number | null>(null);
  const pendingRestoreRef = useRef<ReadingPosition | null>(null);
  const appliedRestorationScrollTopRef = useRef<number | null>(null);
  const initialPageRef = useRef<number | null>(null);
  const suppressPositionSaveRef = useRef(false);
  const retryRafRef = useRef<number | null>(null);

  const schedulePositionSave = useCallback(() => {
    if (!path || suppressPositionSaveRef.current || pendingRestoreRef.current !== null) return;
    if (positionSaveTimerRef.current !== null) window.clearTimeout(positionSaveTimerRef.current);
    const savePath = path;
    positionSaveTimerRef.current = window.setTimeout(() => {
      positionSaveTimerRef.current = null;
      if (!path || path !== savePath || suppressPositionSaveRef.current || pendingRestoreRef.current !== null) return;
      const viewer = viewerRef.current;
      const page = pageElementsRef.current[pageNumberRef.current - 1];
      if (!viewer || !page || !page.isConnected) return;
      const pageRect = page.getBoundingClientRect();
      if (pageRect.height <= 0) return;
      const offset = Math.max(0, Math.min(1,
        (viewer.getBoundingClientRect().top - pageRect.top) / pageRect.height,
      ));
      void saveReadingPosition(savePath, { page: pageNumberRef.current, offset })
        .catch((cause) => onError(`Could not save reading position: ${pdfErrorMessage(cause)}`));
    }, 700);
  }, [path, pageNumberRef, viewerRef, pageElementsRef, onError]);

  const handleViewportScroll = useCallback(() => {
    if (appliedRestorationScrollTopRef.current !== null) {
      const currentTop = viewerRef.current?.scrollTop ?? 0;
      if (Math.abs(currentTop - appliedRestorationScrollTopRef.current) < 1) {
        return;
      }
      appliedRestorationScrollTopRef.current = null;
    }
    if (!suppressPositionSaveRef.current) schedulePositionSave();
  }, [schedulePositionSave, viewerRef]);

  const queueRestoration = useCallback((position: ReadingPosition | null) => {
    if (positionSaveTimerRef.current !== null) {
      window.clearTimeout(positionSaveTimerRef.current);
      positionSaveTimerRef.current = null;
    }
    if (retryRafRef.current !== null) {
      cancelAnimationFrame(retryRafRef.current);
      retryRafRef.current = null;
    }
    pendingRestoreRef.current = position;
    initialPageRef.current = position?.page ?? null;
    appliedRestorationScrollTopRef.current = null;
    suppressPositionSaveRef.current = position !== null;
    viewerRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [viewerRef]);

  const applyRestoration = useCallback(() => {
    const restore = pendingRestoreRef.current;
    const viewer = viewerRef.current;
    if (!restore || !viewer) return false;
    const page = pageElementsRef.current[restore.page - 1];
    if (!page || !page.isConnected) return false;
    const pageRect = page.getBoundingClientRect();
    if (pageRect.height <= 0) return false;

    const viewerRect = viewer.getBoundingClientRect();
    viewer.scrollTop += (pageRect.top - viewerRect.top) + restore.offset * pageRect.height;
    appliedRestorationScrollTopRef.current = viewer.scrollTop;
    pendingRestoreRef.current = null;
    suppressPositionSaveRef.current = false;
    return true;
  }, [viewerRef, pageElementsRef]);

  const retryRestoration = useCallback((renderedPage: number) => {
    if (pendingRestoreRef.current?.page === renderedPage) {
      if (retryRafRef.current !== null) {
        cancelAnimationFrame(retryRafRef.current);
        retryRafRef.current = null;
      }
      if (!applyRestoration()) {
        retryRafRef.current = requestAnimationFrame(() => {
          retryRafRef.current = null;
          if (pendingRestoreRef.current?.page === renderedPage) {
            applyRestoration();
          }
        });
      }
    }
  }, [applyRestoration]);

  useLayoutEffect(() => {
    applyRestoration();
  }, [applyRestoration, layoutVersion]);

  useEffect(() => {
    if (appliedRestorationScrollTopRef.current !== null && initialPageRef.current !== null && pageNumber !== initialPageRef.current) {
      appliedRestorationScrollTopRef.current = null;
    }
    if (!suppressPositionSaveRef.current && pendingRestoreRef.current === null && appliedRestorationScrollTopRef.current === null) {
      schedulePositionSave();
    }
  }, [pageNumber, schedulePositionSave]);

  useEffect(() => {
    return () => {
      if (positionSaveTimerRef.current !== null) {
        window.clearTimeout(positionSaveTimerRef.current);
        positionSaveTimerRef.current = null;
      }
      if (retryRafRef.current !== null) {
        cancelAnimationFrame(retryRafRef.current);
        retryRafRef.current = null;
      }
      pendingRestoreRef.current = null;
      initialPageRef.current = null;
      appliedRestorationScrollTopRef.current = null;
      suppressPositionSaveRef.current = false;
    };
  }, [path]);

  return { schedulePositionSave, handleViewportScroll, queueRestoration, retryRestoration };
}
