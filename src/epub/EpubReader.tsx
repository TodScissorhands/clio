import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Contents, Rendition } from "epubjs";
import type { EpubBook } from "./engine";
import { createEpubPositionSession, epubLocationCfi, resolveEpubCfi } from "./readingPosition";
import { attachEpubKeyboard } from "./iframeKeyboard";
import { createEpubStatusResolver } from "./readingStatus";
import type { EpubChapterTarget, EpubReadingStatus } from "./readingStatus";
import {
  filterReaderCommands,
  useReaderKeyboard,
} from "../reader/interactions";
import type { ReaderCommand, ReaderCommandId, ReaderOverlay } from "../reader/interactions";
import { ReaderCommandPalette } from "../reader/ReaderCommandPalette";
import { getEpubCommandStates } from "../reader/commandState";
import "../reader/ReaderStatus.css";
import "./EpubReader.css";

type PaletteMode = "commands" | "chapters";

type EpubReaderProps = {
  book: EpubBook;
  path: string | null;
  onClose: () => void;
  onOpenDocument: (restoreFocus?: () => void) => void;
};
export type SpineSection = { index: number; href?: string; linear: boolean };

export function normalizeSpineLinear(linear: unknown): boolean {
  if (typeof linear === "boolean") return linear;
  if (typeof linear === "string") return linear.trim().toLowerCase() === "yes";
  return true;
}

export function findAdjacentLinearSection(
  spine: SpineSection[],
  currentIndex: number,
  direction: -1 | 1,
): SpineSection | null {
  const currentPosition = spine.findIndex((section) => section.index === currentIndex);
  if (currentPosition < 0) return null;
  for (
    let position = currentPosition + direction;
    position >= 0 && position < spine.length;
    position += direction
  ) {
    const section = spine[position];
    if (section.linear && typeof section.href === "string" && section.href.trim()) {
      return section;
    }
  }
  return null;
}
type EpubLayoutMode = "paged" | "continuous";
type ViewportSize = { width: number; height: number };


function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function EpubReader({ book, path, onClose, onOpenDocument }: EpubReaderProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const focusReader = useCallback(() => {
    requestAnimationFrame(() => viewportRef.current?.focus());
  }, []);
  const renditionRef = useRef<Rendition | null>(null);
  const activeRef = useRef(false);
  const pendingDestroyRef = useRef<{ book: EpubBook; timeout: number } | null>(null);
  const layoutModeRef = useRef<EpubLayoutMode>("paged");
  const initialDisplayReadyRef = useRef(false);
  const pageTurnInFlightRef = useRef(false);
  const navigationInFlightRef = useRef(0);
  const pendingResizeRef = useRef<ViewportSize | null>(null);
  const lastAppliedSizeRef = useRef<ViewportSize | null>(null);
  const resizeTimerRef = useRef<number | null>(null);
  const resizeSchedulerRef = useRef<() => void>(() => {});
  const changeLayoutRef = useRef<(mode: EpubLayoutMode) => void>(() => {});
  const [chapters, setChapters] = useState<EpubChapterTarget[]>([]);
  const [spineItems, setSpineItems] = useState<SpineSection[]>([]);
  const [currentSpineIndex, setCurrentSpineIndex] = useState<number | null>(null);
  const [overlay, setOverlay] = useState<ReaderOverlay>(null);
  const [commandQuery, setCommandQuery] = useState("");
  const [commandIndex, setCommandIndex] = useState(0);
  const [paletteMode, setPaletteMode] = useState<PaletteMode>("commands");
  const [layoutMode, setLayoutMode] = useState<EpubLayoutMode>("paged");
  const [error, setError] = useState("");
  const [readingStatus, setReadingStatus] = useState<{ book: EpubBook; value: EpubReadingStatus }>({
    book,
    value: { label: "EPUB", page: null, total: null },
  });
  const commandStates = useMemo(() => getEpubCommandStates(layoutMode), [layoutMode]);

  const chapterCommands = useMemo(() => chapters.map((chapter, index): ReaderCommand => ({
    id: "select_chapter",
    scope: "epub",
    key: `toc-${index}-${chapter.href}`,
    label: chapter.label,
    shortcut: "",
    depth: chapter.depth,
    targetHref: chapter.href,
  })), [chapters]);
  const visibleCommands = filterReaderCommands(
    commandQuery,
    true,
    "epub",
    paletteMode === "chapters" ? chapterCommands : undefined,
  );

  const navigateToHref = useCallback((href: string) => {
    const rendition = renditionRef.current;
    if (!rendition || navigationInFlightRef.current > 0) return;
    navigationInFlightRef.current += 1;
    void rendition.display(href)
      .then(() => {
        if (activeRef.current && renditionRef.current === rendition && rendition.location?.start) {
          setCurrentSpineIndex(rendition.location.start.index);
        }
      })
      .catch((cause: unknown) => {
        if (activeRef.current && renditionRef.current === rendition) setError(`Could not open chapter: ${errorMessage(cause)}`);
      })
      .finally(() => {
        if (renditionRef.current !== rendition) return;
        navigationInFlightRef.current = Math.max(0, navigationInFlightRef.current - 1);
        resizeSchedulerRef.current();
      });
  }, []);

  const navigateSpine = useCallback((direction: -1 | 1) => {
    if (currentSpineIndex === null) return;
    const target = findAdjacentLinearSection(spineItems, currentSpineIndex, direction);
    if (!target?.href) return;
    navigateToHref(target.href);
  }, [currentSpineIndex, navigateToHref, spineItems]);
  const scrollContinuous = useCallback((direction: -1 | 1, amount: "page" | "line") => {
    const container = viewportRef.current?.querySelector<HTMLElement>(".epub-container");
    if (!container) return;
    const distance = amount === "page" ? Math.max(1, container.clientHeight * 0.85) : 48;
    container.scrollBy({ top: direction * distance, behavior: "auto" });
  }, []);

  const turnPage = useCallback((direction: -1 | 1) => {
    const rendition = renditionRef.current;
    if (!rendition || navigationInFlightRef.current > 0 || pageTurnInFlightRef.current) return;
    pageTurnInFlightRef.current = true;
    navigationInFlightRef.current += 1;
    const turn = direction > 0 ? rendition.next() : rendition.prev();
    void turn
      .catch((cause: unknown) => {
        if (activeRef.current && renditionRef.current === rendition) setError(`Could not change page: ${errorMessage(cause)}`);
      })
      .finally(() => {
        if (renditionRef.current !== rendition) return;
        pageTurnInFlightRef.current = false;
        navigationInFlightRef.current = Math.max(0, navigationInFlightRef.current - 1);
        resizeSchedulerRef.current();
      });
  }, []);

  const runReaderCommand = useCallback((command: ReaderCommandId) => {
    switch (command) {
      case "open_document":
        onOpenDocument(focusReader);
        break;
      case "previous_chapter":
        navigateSpine(-1);
        break;
      case "next_chapter":
        navigateSpine(1);
        break;
      case "next_page":
      case "previous_page": {
        const direction = command === "next_page" ? 1 : -1;
        if (layoutModeRef.current === "continuous") scrollContinuous(direction, "page");
        else turnPage(direction);
        break;
      }
      case "go_to_chapter":
        setPaletteMode("chapters");
        setCommandQuery("");
        setCommandIndex(0);
        break;
      case "close_document":
        onClose();
        break;
      case "paged_layout":
        changeLayoutRef.current("paged");
        break;
      case "continuous_layout":
        changeLayoutRef.current("continuous");
        break;
      default:
        break;
    }
  }, [focusReader, navigateSpine, onClose, onOpenDocument, scrollContinuous, turnPage]);


  const openCommandPalette = useCallback(() => {
    setPaletteMode("commands");
    setCommandQuery("");
    setCommandIndex(0);
    setOverlay("commands");
  }, []);

  const closeOverlay = useCallback(() => {
    setOverlay(null);
    setPaletteMode("commands");
    requestAnimationFrame(() => viewportRef.current?.focus());
  }, []);

  const executePaletteCommand = useCallback((command: ReaderCommand) => {
    if (command.id === "go_to_chapter") {
      setPaletteMode("chapters");
      setCommandQuery("");
      setCommandIndex(0);
      return;
    }
    if (command.id === "select_chapter" && command.targetHref) {
      setOverlay(null);
      setPaletteMode("commands");
      navigateToHref(command.targetHref);
      requestAnimationFrame(() => viewportRef.current?.focus());
      return;
    }
    setOverlay(null);
    runReaderCommand(command.id);
    if (command.id !== "close_document") requestAnimationFrame(() => viewportRef.current?.focus());
  }, [navigateToHref, runReaderCommand]);

  const registerKeyboardTarget = useReaderKeyboard(
    {
      readerKind: "epub",
      overlay,
      commands: visibleCommands,
      searchReady: false,
      matchCount: 0,
      jumpInput: "",
      pageCount: 0,
      commandIndex,
      epubLayoutMode: layoutMode,
    },
    {
      closeOverlay,
      moveMatch: () => {},
      runSearch: () => {},
      goToPage: () => {},
      executePaletteCommand,
      runCommand: runReaderCommand,
      scrollContinuous,
      setCommandQuery,
      setCommandIndex,
      setOverlay: (nextOverlay) => {
        if (nextOverlay === "commands") openCommandPalette();
        else setOverlay(nextOverlay);
      },
    },
  );
  

  useEffect(() => {
    const pendingDestroy = pendingDestroyRef.current;
    let existingRendition = renditionRef.current;
    if (pendingDestroy) {
      window.clearTimeout(pendingDestroy.timeout);
      pendingDestroyRef.current = null;
      if (pendingDestroy.book !== book) {
        pendingDestroy.book.destroy();
        existingRendition = null;
        renditionRef.current = null;
      }
    }
    const viewport = viewportRef.current;
    if (!viewport) {
      book.destroy();
      return;
    }
    let active = true;
    activeRef.current = true;
    initialDisplayReadyRef.current = false;
    let statusResolver: ReturnType<typeof createEpubStatusResolver> | null = null;
    let layoutPending = true;
    let layoutFailed = false;
    let lastStatusLocation: unknown = null;
    setReadingStatus({ book, value: { label: "EPUB", page: null, total: null } });
    const position = createEpubPositionSession(path, (cause) => {
      if (active) setError(`Could not save EPUB reading position: ${errorMessage(cause)}`);
    });
    const currentCfi = () => {
      try {
        return epubLocationCfi(book, rendition?.currentLocation()) ?? epubLocationCfi(book, rendition?.location);
      } catch {
        return null;
      }
    };
    const capturePosition = () => {
      if (initialDisplayReadyRef.current) position.capture(currentCfi());
    };
    // epub.js display() resolves before its RAF-based relocated event.
    const afterLayout = () => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    let rendition: Rendition | null = existingRendition;
    const deferBookDestroy = () => {
      const timeout = window.setTimeout(() => {
        if (pendingDestroyRef.current?.timeout !== timeout) return;
        pendingDestroyRef.current = null;
        book.destroy();
      }, 0);
      pendingDestroyRef.current = { book, timeout };
    };
    try {
      if (!rendition) {
        const rect = viewport.getBoundingClientRect();
        const initialSize = {
          width: Math.max(1, Math.floor(rect.width)),
          height: Math.max(1, Math.floor(rect.height)),
        };
        initialDisplayReadyRef.current = false;
        navigationInFlightRef.current = 0;
        pageTurnInFlightRef.current = false;
        pendingResizeRef.current = null;
        lastAppliedSizeRef.current = initialSize;
        layoutModeRef.current = "paged";
        setLayoutMode("paged");
        const renditionOptions = {
          width: initialSize.width,
          height: initialSize.height,
          manager: "continuous",
          flow: "paginated",
          allowScriptedContent: false,
          resizeOnOrientationChange: false,
          offset: Math.max(500, initialSize.height),
        };
        rendition = book.renderTo(viewport, renditionOptions);
        renditionRef.current = rendition;
      }
    } catch (cause) {
      setError(`Could not render EPUB: ${errorMessage(cause)}`);
      return () => {
        active = false;
        activeRef.current = false;
        void position.close();
        deferBookDestroy();
      };
    }
    if (!rendition) return;
    const hasPendingResize = () => {
      const pending = pendingResizeRef.current;
      const applied = lastAppliedSizeRef.current;
      return !!pending && (!applied || pending.width !== applied.width || pending.height !== applied.height);
    };
    const publishStatus = (location: unknown, pagesReady = !layoutPending && !layoutFailed && initialDisplayReadyRef.current) => {
      if (!active || renditionRef.current !== rendition || !statusResolver) return;
      const contents = rendition.getContents() as unknown as Contents[];
      const value = statusResolver.read(location, contents, pagesReady && layoutModeRef.current === "paged");
      setReadingStatus((current) => current.book === book &&
        current.value.label === value.label && current.value.page === value.page && current.value.total === value.total
        ? current : { book, value });
    };
    const invalidateStatus = () => {
      layoutPending = true;
      setReadingStatus((current) => current.book !== book || current.value.page === null
        ? current : { book, value: { ...current.value, page: null, total: null } });
    };
    const publishFreshStatus = () => {
      let location: unknown = null;
      try {
        location = rendition.currentLocation();
      } catch {
        // A fresh display snapshot may be unavailable while the manager is reflowing.
      }
      if (location && typeof location === "object" && "then" in location && typeof location.then === "function") {
        location = null;
      }
      if (location) lastStatusLocation = location;
      publishStatus(location ?? lastStatusLocation, !!location && !layoutPending && !layoutFailed && initialDisplayReadyRef.current);
    };
    const reflow = (apply: () => void) => {
      if (!active || !initialDisplayReadyRef.current || navigationInFlightRef.current > 0) return;
      const cfi = position.capture(currentCfi());
      invalidateStatus();
      let completed = false;
      navigationInFlightRef.current += 1;
      void position.preserve(cfi, async () => {
        apply();
        if (cfi) await rendition.display(cfi);
        await afterLayout();
        completed = true;
        return currentCfi();
      }).catch((cause: unknown) => {
        if (active) setError(`Could not preserve EPUB reading position: ${errorMessage(cause)}`);
      }).finally(() => {
        if (!active) return;
        navigationInFlightRef.current = Math.max(0, navigationInFlightRef.current - 1);
        layoutFailed = !completed;
        layoutPending = !completed || hasPendingResize();
        if (completed) publishFreshStatus();
        if (active) resizeSchedulerRef.current();
      });
    };
    changeLayoutRef.current = (mode) => {
      if (layoutModeRef.current === mode) return;
      reflow(() => {
        layoutModeRef.current = mode;
        setLayoutMode(mode);
        rendition.flow(mode === "paged" ? "paginated" : "scrolled-continuous");
      });
    };
    const scheduleResize = () => {
      if (
        !active ||
        !initialDisplayReadyRef.current ||
        navigationInFlightRef.current > 0 ||
        !pendingResizeRef.current
      ) return;
      if (resizeTimerRef.current !== null) window.clearTimeout(resizeTimerRef.current);
      resizeTimerRef.current = window.setTimeout(() => {
        resizeTimerRef.current = null;
        if (!active || !initialDisplayReadyRef.current || navigationInFlightRef.current > 0) return;
        const size = pendingResizeRef.current;
        if (!size) return;
        pendingResizeRef.current = null;
        const previous = lastAppliedSizeRef.current;
        if (previous?.width === size.width && previous.height === size.height) {
          if (!layoutFailed) {
            layoutPending = false;
            publishFreshStatus();
          }
          return;
        }
        try {
          reflow(() => rendition.resize(size.width, size.height));
          lastAppliedSizeRef.current = size;
        } catch (cause) {
          if (active) setError(`Could not resize EPUB: ${errorMessage(cause)}`);
        }
      }, 140);
    };
    resizeSchedulerRef.current = scheduleResize;
    const resizeObserver = new ResizeObserver(() => {
      const rect = viewport.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      const applied = lastAppliedSizeRef.current;
      if (!applied || width !== applied.width || height !== applied.height) invalidateStatus();
      pendingResizeRef.current = { width, height };
      scheduleResize();
    });
    resizeObserver.observe(viewport);

    const disposeKeyboard = attachEpubKeyboard(rendition, viewport, registerKeyboardTarget);
    const onRelocated = (location: unknown) => {
      if (!active || renditionRef.current !== rendition) return;
      lastStatusLocation = location;
      publishStatus(location);
      if (!location || typeof location !== "object" || !("start" in location)) return;
      const start = location.start;
      if (start && typeof start === "object" && "index" in start && typeof start.index === "number") {
        setCurrentSpineIndex(start.index);
      }
      if (active && initialDisplayReadyRef.current) position.update(epubLocationCfi(book, location));
    };
    rendition.on("relocated", onRelocated);

    void book.loaded.navigation
      .then(async (navigation) => {
        if (!active) return;
        const spine: SpineSection[] = [];
        book.spine.each((section: { index: number; href?: string; linear?: unknown }) => {
          spine.push({
            index: section.index,
            href: section.href,
            linear: normalizeSpineLinear(section.linear),
          });
        });
        statusResolver = createEpubStatusResolver(book, navigation.toc, spine);
        const tocTargets = statusResolver.chapters;
        const targets = tocTargets.length > 0
          ? tocTargets
          : spine.filter((section) => section.linear && typeof section.href === "string" && section.href.trim())
            .map((section) => ({ href: section.href!, label: `Section ${section.index + 1}`, depth: 0 }));
        setChapters(targets);
        setSpineItems(spine);
        navigationInFlightRef.current += 1;
        let displayReady = false;
        try {
          let savedCfi: string | null = null;
          try {
            savedCfi = await position.load();
          } catch (cause) {
            if (active) setError(`Could not restore EPUB reading position: ${errorMessage(cause)}`);
          }
          if (!active) return;
          let restoredCfi = await resolveEpubCfi(book, savedCfi);
          if (!active) return;
          try {
            await rendition.display(restoredCfi ?? targets[0]?.href);
          } catch (cause) {
            if (!restoredCfi) throw cause;
            if (!active) return;
            restoredCfi = null;
            await rendition.display(targets[0]?.href);
          }
          await afterLayout();
          displayReady = true;
          if (active) {
            const visibleCfi = currentCfi();
            position.start(restoredCfi ?? visibleCfi, visibleCfi);
            if (rendition.location?.start) setCurrentSpineIndex(rendition.location.start.index);
            viewport.focus();
          }
        } finally {
          if (active) {
            navigationInFlightRef.current = Math.max(0, navigationInFlightRef.current - 1);
            initialDisplayReadyRef.current = true;
            layoutFailed = !displayReady;
            layoutPending = !displayReady || hasPendingResize();
            if (displayReady) publishFreshStatus();
            resizeSchedulerRef.current();
          }
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(`Could not render EPUB: ${errorMessage(cause)}`);
      });

    const onPageHide = () => {
      capturePosition();
      void position.flush();
    };
    window.addEventListener("pagehide", onPageHide);

    return () => {
      capturePosition();
      void position.close();
      active = false;
      activeRef.current = false;
      resizeObserver.disconnect();
      if (resizeTimerRef.current !== null) {
        window.clearTimeout(resizeTimerRef.current);
        resizeTimerRef.current = null;
      }
      resizeSchedulerRef.current = () => {};
      changeLayoutRef.current = () => {};
      window.removeEventListener("pagehide", onPageHide);
      disposeKeyboard();
      rendition.off("relocated", onRelocated);
      deferBookDestroy();
    };
  }, [book, path, registerKeyboardTarget]);

  const status = readingStatus.book === book ? readingStatus.value : { label: "EPUB", page: null, total: null };

  return (
    <section className="epub-reader" aria-label="EPUB reader">
      {error && <div className="epub-reader__error" role="alert">{error}</div>}
      <div className="epub-reader__viewport" ref={viewportRef} tabIndex={-1} aria-label="EPUB reading area" />
      {overlay !== "commands" && <footer className="status-bar epub-status" aria-label="EPUB reading status" aria-live="off">
        <span className="visually-hidden">
          {status.label}{status.page !== null && ` — First visible page ${status.page} of ${status.total} in this section`}
        </span>
        <span className="status-document" aria-hidden="true">
          <span className="epub-status__chapter" title={status.label}>{status.label}</span>
          {status.page !== null && <span className="epub-status__detail"> · Page {status.page} / {status.total} in section</span>}
        </span>
      </footer>}
      {overlay === "commands" && <ReaderCommandPalette
        commands={visibleCommands}
        commandStates={paletteMode === "commands" ? commandStates : undefined}
        commandIndex={commandIndex}
        query={commandQuery}
        placeholder={paletteMode === "chapters" ? "Filter chapters" : "Filter commands"}
        ariaLabel={paletteMode === "chapters" ? "Choose a chapter" : "Reader commands"}
        emptyMessage={paletteMode === "chapters" ? "No matching chapters" : "No commands"}
        onQueryChange={setCommandQuery}
        onCommandIndexChange={setCommandIndex}
        onExecute={executePaletteCommand}
      />}
    </section>
  );
}
