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
  const suppressPositionSaveRef = useRef(false);

  const schedulePositionSave = useCallback(() => {
    if (!path) return;
    if (positionSaveTimerRef.current !== null) window.clearTimeout(positionSaveTimerRef.current);
    const savePath = path;
    positionSaveTimerRef.current = window.setTimeout(() => {
      const viewer = viewerRef.current;
      const page = pageElementsRef.current[pageNumberRef.current - 1];
      positionSaveTimerRef.current = null;
      if (!viewer || !page) return;
      const pageRect = page.getBoundingClientRect();
      const offset = Math.max(0, Math.min(1,
        (viewer.getBoundingClientRect().top - pageRect.top) / pageRect.height,
      ));
      void saveReadingPosition(savePath, { page: pageNumberRef.current, offset })
        .catch((cause) => onError(`Could not save reading position: ${pdfErrorMessage(cause)}`));
    }, 700);
  }, [path, pageNumberRef, viewerRef, pageElementsRef, onError]);

  const handleViewportScroll = useCallback(() => {
    if (!suppressPositionSaveRef.current) schedulePositionSave();
  }, [schedulePositionSave]);

  const queueRestoration = useCallback((position: ReadingPosition | null) => {
    pendingRestoreRef.current = position;
    suppressPositionSaveRef.current = true;
    viewerRef.current?.scrollTo({ top: 0, behavior: "auto" });
    window.setTimeout(() => { suppressPositionSaveRef.current = false; }, 200);
  }, [viewerRef]);

  useLayoutEffect(() => {
    const restore = pendingRestoreRef.current;
    const viewer = viewerRef.current;
    const page = restore && pageElementsRef.current[restore.page - 1];
    if (!restore || !viewer || !page) return;
    viewer.scrollTop += page.getBoundingClientRect().top - viewer.getBoundingClientRect().top +
      restore.offset * page.getBoundingClientRect().height;
    pendingRestoreRef.current = null;
  }, [layoutVersion, viewerRef, pageElementsRef]);

  useEffect(() => {
    schedulePositionSave();
  }, [pageNumber, schedulePositionSave]);

  useEffect(() => () => {
    if (positionSaveTimerRef.current !== null) window.clearTimeout(positionSaveTimerRef.current);
  }, []);

  return { schedulePositionSave, handleViewportScroll, queueRestoration };
}
