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
  const restorationLayoutFrameRef = useRef<number | null>(null);

  const pathRef = useRef(path);
  pathRef.current = path;
  const errorRef = useRef(onError);
  errorRef.current = onError;
  const ownerRef = useRef<object | null>(null);
  const savesRef = useRef(new Map<string, Promise<void>>());

  const capturePosition = useCallback(() => {
    const savePath = pathRef.current;
    if (!savePath || suppressPositionSaveRef.current || pendingRestoreRef.current ||
      appliedRestorationScrollTopRef.current !== null) return null;
    const viewer = viewerRef.current;
    const number = pageNumberRef.current;
    const page = pageElementsRef.current[number - 1];
    if (!Number.isInteger(number) || number < 1 || !viewer?.isConnected || !page?.isConnected) return null;
    const pageRect = page.getBoundingClientRect();
    const viewerRect = viewer.getBoundingClientRect();
    const offset = (viewerRect.top - pageRect.top) / pageRect.height;
    if (!Number.isFinite(offset) || pageRect.height <= 0 || viewerRect.height <= 0 ||
      pageRect.bottom <= viewerRect.top || pageRect.top >= viewerRect.bottom) return null;
    return { path: savePath, position: { page: number, offset: Math.max(0, Math.min(1, offset)) } };
  }, [pageNumberRef, viewerRef, pageElementsRef]);

  const enqueuePosition = useCallback((snapshot: { path: string; position: ReadingPosition }) => {
    const previous = savesRef.current.get(snapshot.path);
    const save = (previous ?? Promise.resolve()).catch(() => undefined)
      .then(() => saveReadingPosition(snapshot.path, snapshot.position));
    savesRef.current.set(snapshot.path, save);
    const owner = ownerRef.current;
    void save.catch(cause => {
      if (owner !== null && ownerRef.current === owner && pathRef.current === snapshot.path) {
        errorRef.current(`Could not save reading position: ${pdfErrorMessage(cause)}`);
      }
    }).finally(() => {
      if (savesRef.current.get(snapshot.path) === save) savesRef.current.delete(snapshot.path);
    });
    return save;
  }, []);

  const schedulePositionSave = useCallback(() => {
    if (!pathRef.current || suppressPositionSaveRef.current || pendingRestoreRef.current !== null) return;
    if (positionSaveTimerRef.current !== null) window.clearTimeout(positionSaveTimerRef.current);
    positionSaveTimerRef.current = window.setTimeout(() => {
      positionSaveTimerRef.current = null;
      const snapshot = capturePosition();
      if (snapshot) void enqueuePosition(snapshot);
    }, 700);
  }, [capturePosition, enqueuePosition]);

  const flushPositionSave = useCallback(async () => {
    if (positionSaveTimerRef.current !== null) {
      window.clearTimeout(positionSaveTimerRef.current);
      positionSaveTimerRef.current = null;
    }
    // Snapshot before awaiting anything: retirement may remove the live geometry.
    const snapshot = capturePosition();
    const pending = snapshot ? enqueuePosition(snapshot) : pathRef.current
      ? savesRef.current.get(pathRef.current) : undefined;
    if (!pending) return;
    let timeout: number | undefined;
    try {
      await Promise.race([pending, new Promise<never>((_, reject) => {
        timeout = window.setTimeout(() => reject(new Error("Reading-position save timed out; document retained.")), 5000);
      })]);
    } finally {
      window.clearTimeout(timeout);
    }
  }, [capturePosition, enqueuePosition]);

  const handleViewportScroll = useCallback(() => {
    if (restorationLayoutFrameRef.current !== null) return;
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
    ownerRef.current = {};
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
    // PDF.js scale/grouping changes can emit scroll after React's anchor work.
    // That movement is not a user departure from the restored position.
    if (appliedRestorationScrollTopRef.current === null) return;
    if (restorationLayoutFrameRef.current !== null) cancelAnimationFrame(restorationLayoutFrameRef.current);
    restorationLayoutFrameRef.current = requestAnimationFrame(() => {
      restorationLayoutFrameRef.current = null;
      if (appliedRestorationScrollTopRef.current !== null && viewerRef.current) {
        appliedRestorationScrollTopRef.current = viewerRef.current.scrollTop;
      }
    });
  }, [applyRestoration, layoutVersion, viewerRef]);

  useEffect(() => {
    if (appliedRestorationScrollTopRef.current !== null && initialPageRef.current !== null && pageNumber !== initialPageRef.current) {
      appliedRestorationScrollTopRef.current = null;
    }
    if (!suppressPositionSaveRef.current && pendingRestoreRef.current === null && appliedRestorationScrollTopRef.current === null) {
      schedulePositionSave();
    }
  }, [pageNumber, schedulePositionSave]);

  useLayoutEffect(() => {
    ownerRef.current = {};
    return () => {
      ownerRef.current = null;
      if (restorationLayoutFrameRef.current !== null) {
        cancelAnimationFrame(restorationLayoutFrameRef.current);
        restorationLayoutFrameRef.current = null;
      }
      if (positionSaveTimerRef.current !== null) {
        window.clearTimeout(positionSaveTimerRef.current);
        positionSaveTimerRef.current = null;
      }
      if (retryRafRef.current !== null) {
        cancelAnimationFrame(retryRafRef.current);
        retryRafRef.current = null;
      }
      // Explicit transitions flush first. Effect replay must not save or discard
      // pending restoration, and async cleanup cannot guarantee IPC completion.
    };
  }, [path]);

  return { schedulePositionSave, flushPositionSave, handleViewportScroll, queueRestoration, retryRestoration };
}
