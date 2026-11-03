import { EpubCFI } from "epubjs";
import type { EpubBook } from "./engine";
import {
  loadEpubReadingPosition,
  saveEpubReadingPosition,
} from "../platform/readingPosition";

export type EpubPositionStore = {
  load: (path: string) => Promise<{ cfi: string } | null>;
  save: (path: string, position: { cfi: string }) => Promise<void>;
};

const store: EpubPositionStore = { load: loadEpubReadingPosition, save: saveEpubReadingPosition };
// Also orders the final save from an old reader before a new reader loads that path.
const pendingWrites = new Map<string, Promise<void>>();

export function isEpubCfi(value: unknown): value is string {
  if (typeof value !== "string" || !value.startsWith("epubcfi(") || !value.endsWith(")") || /[\x00-\x1f]|(?:\/|:)-/.test(value)) return false;
  try {
    const cfi = new EpubCFI(value);
    return !cfi.range && Number.isInteger(cfi.spinePos) && cfi.spinePos >= 0 &&
      cfi.base.steps.length === 2 && cfi.base.steps.every((step) => Number.isInteger(step.index) && step.index >= 0) &&
      cfi.toString() === value;
  } catch {
    return false;
  }
}

export function epubLocationCfi(book: EpubBook, location: unknown): string | null {
  if (!location || typeof location !== "object" || !("start" in location)) return null;
  const start = location.start;
  if (!start || typeof start !== "object" || !("cfi" in start) || !isEpubCfi(start.cfi)) return null;
  return book.spine.get(start.cfi) ? start.cfi : null;
}

export async function resolveEpubCfi(book: EpubBook, value: unknown): Promise<string | null> {
  if (!isEpubCfi(value)) return null;
  try {
    const cfi = new EpubCFI(value);
    const section = book.spine.get(value);
    if (!section || (cfi.base.steps[1].id && cfi.base.steps[1].id !== section.idref)) return null;
    // A syntactically valid CFI may refer to a removed section/node after a file is replaced.
    const range = await book.getRange(value);
    return range?.startContainer ? value : null;
  } catch {
    return null;
  }
}

export function createEpubPositionSession(
  path: string | null,
  onError: (cause: unknown) => void,
  storage: EpubPositionStore = store,
) {
  let enabled = false;
  let closed = false;
  let closing: Promise<void> | null = null;
  let latest: string | null = null;
  let displayed: string | null = null;
  let queued: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const cancelTimer = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  const flush = (): Promise<void> => {
    cancelTimer();
    if (!path) return Promise.resolve();
    if (!latest || latest === queued) return pendingWrites.get(path) ?? Promise.resolve();
    const cfi = latest;
    queued = cfi;
    const write = (pendingWrites.get(path) ?? Promise.resolve())
      .then(() => storage.save(path, { cfi }))
      .catch((cause: unknown) => {
        if (queued === cfi) queued = null;
        onError(cause);
      });
    pendingWrites.set(path, write);
    void write.then(() => {
      if (pendingWrites.get(path) === write) pendingWrites.delete(path);
    });
    return write;
  };
  const schedule = () => {
    cancelTimer();
    if (path && latest !== queued) timer = setTimeout(() => { void flush(); }, 700);
  };
  const update = (cfi: unknown) => {
    if (!enabled || closed || !isEpubCfi(cfi) || latest === cfi || displayed === cfi) return;
    latest = cfi;
    displayed = cfi;
    schedule();
  };

  return {
    async load(): Promise<string | null> {
      if (!path) return null;
      await pendingWrites.get(path);
      const position = await storage.load(path);
      return isEpubCfi(position?.cfi) ? position.cfi : null;
    },
    start(cfi: unknown, visibleCfi: unknown = cfi) {
      if (closed) return;
      latest = isEpubCfi(cfi) ? cfi : null;
      displayed = isEpubCfi(visibleCfi) ? visibleCfi : latest;
      enabled = true;
    },
    update,
    capture(cfi: unknown): string | null {
      update(cfi);
      return latest;
    },
    async preserve(cfi: unknown, reflow: () => Promise<string | null>) {
      update(cfi);
      enabled = false;
      cancelTimer();
      try {
        const visibleCfi = await reflow();
        // Pagination may put the anchor partway down a spread. Keep the exact
        // anchor until the user moves, rather than saving that spread's start.
        if (!closed && isEpubCfi(visibleCfi)) displayed = visibleCfi;
      } finally {
        if (!closed) {
          enabled = true;
          schedule();
        }
      }
    },
    flush() {
      return closed ? closing ?? Promise.resolve() : flush();
    },
    close() {
      if (closing) return closing;
      enabled = false;
      closed = true;
      closing = flush();
      return closing;
    },
  };
}
