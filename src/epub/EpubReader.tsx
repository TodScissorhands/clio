import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NavItem, Rendition } from "epubjs";
import type { EpubBook } from "./engine";
import { createEpubPositionSession, epubLocationCfi, resolveEpubCfi } from "./readingPosition";
import {
  filterReaderCommands,
  useReaderKeyboard,
} from "../reader/interactions";
import type { ReaderCommand, ReaderCommandId, ReaderOverlay } from "../reader/interactions";
import { ReaderCommandPalette } from "../reader/ReaderCommandPalette";
import "./EpubReader.css";

type ChapterTarget = { href: string; label: string; depth: number };
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

function flattenToc(items: NavItem[], book: EpubBook): ChapterTarget[] {
  const chapters: ChapterTarget[] = [];
  const visit = (entries: NavItem[], depth: number) => {
    for (const entry of entries) {
      const href = typeof entry.href === "string" ? entry.href.trim() : "";
      if (href) {
        try {
          if (book.spine.get(href)) {
            const label = typeof entry.label === "string" ? entry.label.trim() : "";
            chapters.push({ href, label: label || `Chapter ${chapters.length + 1}`, depth });
          }
        } catch {
          // Ignore malformed destinations and continue into nested navigation items.
        }
      }
      visit(Array.isArray(entry.subitems) ? entry.subitems : [], depth + 1);
    }
  };
  visit(items, 0);
  return chapters;
}

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
  const [chapters, setChapters] = useState<ChapterTarget[]>([]);
  const [spineItems, setSpineItems] = useState<SpineSection[]>([]);
  const [currentSpineIndex, setCurrentSpineIndex] = useState<number | null>(null);
  const [overlay, setOverlay] = useState<ReaderOverlay>(null);
  const [commandQuery, setCommandQuery] = useState("");
  const [commandIndex, setCommandIndex] = useState(0);
  const [paletteMode, setPaletteMode] = useState<PaletteMode>("commands");
  const [layoutMode, setLayoutMode] = useState<EpubLayoutMode>("paged");
  const [error, setError] = useState("");

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
    const reflow = (apply: () => void) => {
      if (!active || !initialDisplayReadyRef.current || navigationInFlightRef.current > 0) return;
      const cfi = position.capture(currentCfi());
      navigationInFlightRef.current += 1;
      void position.preserve(cfi, async () => {
        apply();
        if (cfi) await rendition.display(cfi);
        await afterLayout();
        return currentCfi();
      }).catch((cause: unknown) => {
        if (active) setError(`Could not preserve EPUB reading position: ${errorMessage(cause)}`);
      }).finally(() => {
        if (!active) return;
        navigationInFlightRef.current = Math.max(0, navigationInFlightRef.current - 1);
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
        if (previous?.width === size.width && previous.height === size.height) return;
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
      pendingResizeRef.current = { width, height };
      scheduleResize();
    });
    resizeObserver.observe(viewport);

    const keyboardCleanups = new Map<Document, () => void>();
    const getFrameDocument = (source: unknown): Document | null => {
      if (!source || typeof source !== "object") return null;
      const content = "contents" in source ? source.contents : source;
      if (!content || typeof content !== "object" || !("document" in content)) return null;
      const candidate = content.document;
      if (!candidate || typeof candidate !== "object" || !("addEventListener" in candidate) ||
        typeof candidate.addEventListener !== "function" || !("removeEventListener" in candidate) ||
        typeof candidate.removeEventListener !== "function") return null;
      return candidate as Document;
    };
    const registerFrameDocument = (frameDocument: Document | null) => {
      if (!frameDocument) return;
      frameDocument.documentElement.style.overflowAnchor = "none";
      if (frameDocument.body) frameDocument.body.style.overflowAnchor = "none";
      if (!keyboardCleanups.has(frameDocument)) {
        keyboardCleanups.set(frameDocument, registerKeyboardTarget(frameDocument));
      }
    };
    const onContent = (contents: unknown) => registerFrameDocument(getFrameDocument(contents));
    const onRemoved = (_section: unknown, view: unknown) => {
      const frameDocument = getFrameDocument(view);
      if (!frameDocument) return;
      keyboardCleanups.get(frameDocument)?.();
      keyboardCleanups.delete(frameDocument);
    };
    const onRelocated = (location: unknown) => {
      if (!location || typeof location !== "object" || !("start" in location)) return;
      const start = location.start;
      if (start && typeof start === "object" && "index" in start && typeof start.index === "number") {
        setCurrentSpineIndex(start.index);
      }
      if (active && initialDisplayReadyRef.current) position.update(epubLocationCfi(book, location));
    };
    rendition.hooks.content.register(onContent);
    rendition.on("removed", onRemoved);
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
        const tocTargets = flattenToc(navigation.toc, book);
        const targets = tocTargets.length > 0
          ? tocTargets
          : spine.filter((section) => section.linear && typeof section.href === "string" && section.href.trim())
            .map((section) => ({ href: section.href!, label: `Section ${section.index + 1}`, depth: 0 }));
        setChapters(targets);
        setSpineItems(spine);
        navigationInFlightRef.current += 1;
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
      rendition.hooks.content.deregister(onContent);
      rendition.off("removed", onRemoved);
      rendition.off("relocated", onRelocated);
      keyboardCleanups.forEach((cleanup) => cleanup());
      keyboardCleanups.clear();
      deferBookDestroy();
    };
  }, [book, path, registerKeyboardTarget]);

  return (
    <section className="epub-reader" aria-label="EPUB reader">
      {error && <div className="epub-reader__error" role="alert">{error}</div>}
      <div className="epub-reader__viewport" ref={viewportRef} tabIndex={-1} aria-label="EPUB reading area" />
      {overlay === "commands" && <ReaderCommandPalette
        commands={visibleCommands}
        commandIndex={commandIndex}
        query={commandQuery}
        placeholder={paletteMode === "chapters" ? "Filter chapters" : "Filter commands"}
        ariaLabel={paletteMode === "chapters" ? "Choose a chapter" : "Reader commands"}
        emptyMessage={paletteMode === "chapters" ? "No chapter destinations" : "No commands"}
        onQueryChange={setCommandQuery}
        onCommandIndexChange={setCommandIndex}
        onExecute={executePaletteCommand}
      />}
    </section>
  );
}
