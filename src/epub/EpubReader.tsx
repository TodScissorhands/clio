import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Contents, Rendition } from "epubjs";
import type { EpubBook } from "./engine";
import { createEpubPositionSession, epubLocationCfi, resolveEpubCfi } from "./readingPosition";
import { attachEpubKeyboard } from "./iframeKeyboard";
import { createEpubStatusResolver } from "./readingStatus";
import type { EpubChapterTarget, EpubReadingStatus } from "./readingStatus";
import { createEpubStyles } from "./styles";
import { DEFAULT_EPUB_PREFERENCES, loadEpubPreferences, saveEpubPreferences } from "./preferences";
import type { EpubPreferences } from "./preferences";
import { DOCUMENT_THEMES } from "../reader/appearance";
import { applyEpubPreferenceCommand, commandTheme, epubPreferenceCommands, epubPreferenceMenuCommands, searchableReaderCommands, themeCommands } from "../reader/appearanceCommands";
import type { EpubPreferenceField } from "../reader/appearanceCommands";
import {
  filterReaderCommands,
  EPUB_READER_COMMANDS,
  useReaderKeyboard,
} from "../reader/interactions";
import type { ReaderCommand, ReaderCommandId, ReaderOverlay } from "../reader/interactions";
import { ReaderCommandPalette } from "../reader/ReaderCommandPalette";
import { getEpubCommandStates } from "../reader/commandState";
import "../reader/ReaderStatus.css";
import "./EpubReader.css";

type PaletteMode = "commands" | "chapters" | "themes" | "preferences" | EpubPreferenceField;

type EpubReaderProps = {
  book: EpubBook;
  path: string | null;
  onClose: () => void;
  onOpenDocument: (restoreFocus?: () => void) => void;
  nightMode: boolean;
  onToggleNightMode: () => void;
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

export function EpubReader({ book, path, onClose, onOpenDocument, nightMode, onToggleNightMode }: EpubReaderProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
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
  const [preferences, setPreferences] = useState(loadEpubPreferences);
  const preferencesRef = useRef(preferences);
  const storageWarningRef = useRef(false);
  const [presentation, setPresentation] = useState({ book, applied: DEFAULT_EPUB_PREFERENCES, retained: "", ready: false });
  const applied = presentation.book === book ? presentation.applied : DEFAULT_EPUB_PREFERENCES;
  const retained = presentation.book === book ? presentation.retained : "";
  const choosePreferences = useCallback((next: EpubPreferences) => {
    preferencesRef.current = next;
    setPreferences(next);
    if (!saveEpubPreferences(next) && !storageWarningRef.current) {
      storageWarningRef.current = true;
      setError("Reading preferences are available for this session but could not be saved.");
    }
    resizeSchedulerRef.current();
  }, []);
  const [readingStatus, setReadingStatus] = useState<{ book: EpubBook; value: EpubReadingStatus }>({
    book,
    value: { label: "EPUB", page: null, total: null },
  });
  const commandStates = useMemo(() => ({
    ...getEpubCommandStates(layoutMode),
    toggle_night_mode: { active: nightMode, text: nightMode ? "Dark chrome" : "Light chrome" },
  }), [layoutMode, nightMode]);

  const chapterCommands = useMemo((): ReaderCommand[] => [
    { id: "back_to_commands", scope: "epub", shortcut: "", label: "Back to commands" },
    ...chapters.map((chapter, index): ReaderCommand => ({
      id: "select_chapter",
      scope: "epub",
      key: `toc-${index}-${chapter.href}`,
      label: chapter.label,
      shortcut: "",
      depth: chapter.depth,
      targetHref: chapter.href,
    })),
  ], [chapters]);
  const themes = themeCommands("epub", applied.theme, preferences.theme, retained || "Requested — waiting for layout");
  const preferenceChoices = epubPreferenceCommands(preferences, applied, retained);
  const preferenceMenu = epubPreferenceMenuCommands(preferences, applied, retained);
  const fieldCommand = preferenceMenu.find((command) => command.value === paletteMode);
  const fieldLabel = fieldCommand?.label?.replace(/…$/, "");
  const rootCommands = EPUB_READER_COMMANDS.map((command) => {
    if (layoutMode === "continuous" && (command.id === "next_page" || command.id === "previous_page")) {
      return { ...command, label: command.id === "next_page" ? "Next screen" : "Previous screen" };
    }
    return command;
  });
  const visibleCommands = filterReaderCommands(commandQuery, true, "epub",
    paletteMode === "chapters" ? chapterCommands
      : paletteMode === "themes" ? themes : paletteMode === "preferences" ? preferenceMenu
        : fieldCommand ? epubPreferenceCommands(preferences, applied, retained, paletteMode as EpubPreferenceField)
          : searchableReaderCommands(rootCommands, [themes, preferenceMenu, preferenceChoices], commandQuery));

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
      case "toggle_night_mode":
        onToggleNightMode();
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
  }, [focusReader, navigateSpine, onClose, onOpenDocument, onToggleNightMode, scrollContinuous, turnPage]);


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
    if (command.disabled) return;
    if (command.id === "epub_preference_field" && command.value &&
        preferenceMenu.some((entry) => entry.value === command.value)) {
      setPaletteMode(command.value as EpubPreferenceField);
      setCommandQuery("");
      setCommandIndex(0);
      return;
    }
    if (command.id === "document_appearance" || command.id === "epub_reading_preferences" ||
        command.id === "back_to_commands" || command.id === "back_to_preferences") {
      setPaletteMode(command.id === "document_appearance" ? "themes"
        : command.id === "epub_reading_preferences" || command.id === "back_to_preferences" ? "preferences" : "commands");
      setCommandQuery("");
      setCommandIndex(0);
      return;
    }
    const theme = commandTheme(command.id);
    const next = theme ? { ...preferencesRef.current, theme } : applyEpubPreferenceCommand(preferencesRef.current, command);
    if (next) {
      choosePreferences(next);
      return;
    }
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
  }, [choosePreferences, navigateToHref, preferenceMenu, runReaderCommand]);

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
    const styles = createEpubStyles(book, rendition);
    let fixedLayout = false;
    let verticalWriting = false;
    let appliedRequest: EpubPreferences | null = null;
    let failedRequest: EpubPreferences | null = null;
    let appliedPreferences = DEFAULT_EPUB_PREFERENCES;
    let requestedLayout = layoutModeRef.current;
    let presentationFrame: number | null = null;
    let resizeReady = false;
    const effectivePreferences = (requested: EpubPreferences): EpubPreferences => fixedLayout
      ? DEFAULT_EPUB_PREFERENCES
      : verticalWriting ? { ...DEFAULT_EPUB_PREFERENCES, theme: requested.theme } : requested;
    const retainedReason = () => fixedLayout ? "Fixed-layout publication" : verticalWriting ? "Vertical writing" : "";
    const publishPresentation = (ready: boolean) => {
      if (active) setPresentation({ book, applied: appliedPreferences, retained: retainedReason(), ready });
    };
    publishPresentation(false);
    const applyGeometry = (preferences: EpubPreferences) => {
      const gutters = { publisher: "", compact: "min(8px, 10%)", comfortable: "min(16px, 10%)", generous: "min(32px, 10%)" };
      const columns = { publisher: "", narrow: "32rem", comfortable: "44rem", wide: "60rem" };
      if (surfaceRef.current) surfaceRef.current.style.paddingInline = gutters[preferences.margins];
      viewport.style.maxWidth = columns[preferences.columnWidth];
      const rect = viewport.getBoundingClientRect();
      const size = { width: Math.max(1, Math.floor(rect.width)), height: Math.max(1, Math.floor(rect.height)) };
      const previous = lastAppliedSizeRef.current;
      if (!previous || size.width !== previous.width || size.height !== previous.height) {
        rendition.resize(size.width, size.height);
        lastAppliedSizeRef.current = size;
      }
      pendingResizeRef.current = null;
      resizeReady = false;
    };
    const schedulePresentation = () => {
      if (!active || presentationFrame !== null) return;
      presentationFrame = requestAnimationFrame(() => {
        presentationFrame = null;
        drainPresentation();
      });
    };
    const drainPresentation = () => {
      if (!active || !initialDisplayReadyRef.current || navigationInFlightRef.current > 0) return;
      const request = preferencesRef.current;
      const next = effectivePreferences(request);
      const nextLayout = requestedLayout;
      const preferenceChange = request !== appliedRequest && request !== failedRequest;
      const layoutChange = nextLayout !== layoutModeRef.current;
      const resize = resizeReady && hasPendingResize();
      if (!preferenceChange && !layoutChange && !resize) return;
      const previous = appliedPreferences;
      const previousLayout = layoutModeRef.current;
      const metricsChange = layoutChange || resize ||
        next.fontFamily !== previous.fontFamily || next.fontScale !== previous.fontScale ||
        next.lineHeight !== previous.lineHeight || next.alignment !== previous.alignment ||
        next.margins !== previous.margins || next.columnWidth !== previous.columnWidth;
      if (!metricsChange) {
        try {
          styles.apply(next);
          appliedPreferences = next;
          appliedRequest = request;
          failedRequest = null;
          publishPresentation(true);
        } catch (cause) {
          styles.apply(previous);
          failedRequest = request;
          setError(`Could not apply EPUB preferences: ${errorMessage(cause)}`);
        }
        return;
      }
      const cfi = position.capture(currentCfi());
      if (!cfi) {
        setPresentation({ book, applied: previous, retained: "Waiting for a reading location", ready: true });
        return;
      }
      invalidateStatus();
      let completed = false;
      navigationInFlightRef.current += 1;
      void position.preserve(cfi, async () => {
        try {
          styles.apply(next);
          applyGeometry(next);
          if (layoutChange) rendition.flow(nextLayout === "paged" ? "paginated" : "scrolled-continuous");
          await afterLayout();
          if (!active) return null;
          await rendition.display(cfi);
          await afterLayout();
          if (!active) return null;
          appliedPreferences = next;
          appliedRequest = request;
          failedRequest = null;
          layoutModeRef.current = nextLayout;
          setLayoutMode(nextLayout);
          completed = true;
          publishPresentation(true);
          return currentCfi();
        } catch (cause) {
          if (!active) return null;
          styles.apply(previous);
          applyGeometry(previous);
          if (layoutChange) rendition.flow(previousLayout === "paged" ? "paginated" : "scrolled-continuous");
          await afterLayout();
          if (!active) return null;
          await rendition.display(cfi);
          await afterLayout();
          throw cause;
        }
      }).catch((cause: unknown) => {
        if (!active) return;
        failedRequest = request;
        if (requestedLayout === nextLayout) requestedLayout = previousLayout;
        publishPresentation(true);
        setError(`Could not preserve EPUB reading position while applying preferences: ${errorMessage(cause)}`);
      }).finally(() => {
        if (!active) return;
        navigationInFlightRef.current = Math.max(0, navigationInFlightRef.current - 1);
        layoutFailed = !completed;
        layoutPending = !completed || hasPendingResize();
        if (completed) publishFreshStatus();
        schedulePresentation();
      });
    };
    changeLayoutRef.current = (mode) => {
      requestedLayout = mode;
      schedulePresentation();
    };
    resizeSchedulerRef.current = schedulePresentation;
    const resizeObserver = new ResizeObserver(() => {
      const rect = viewport.getBoundingClientRect();
      const size = { width: Math.max(1, Math.floor(rect.width)), height: Math.max(1, Math.floor(rect.height)) };
      const previous = lastAppliedSizeRef.current;
      if (previous?.width === size.width && previous.height === size.height) return;
      invalidateStatus();
      pendingResizeRef.current = size;
      if (resizeTimerRef.current !== null) window.clearTimeout(resizeTimerRef.current);
      resizeTimerRef.current = window.setTimeout(() => {
        resizeTimerRef.current = null;
        resizeReady = true;
        schedulePresentation();
      }, 140);
    });
    resizeObserver.observe(viewport);

    const disposeKeyboard = attachEpubKeyboard(rendition, viewport, (document) => {
      const view = document.defaultView;
      if (!verticalWriting && view && [document.documentElement, document.body].some((element) =>
        element && /^(vertical|sideways)/.test(view.getComputedStyle(element).writingMode))) {
        verticalWriting = true;
        appliedRequest = null;
        styles.apply(effectivePreferences(preferencesRef.current));
        schedulePresentation();
      }
      const disposeStyle = styles.registerDocument(document);
      const disposeKeys = registerKeyboardTarget(document);
      return () => { disposeKeys(); disposeStyle(); };
    });
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
      schedulePresentation();
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
          // started resolves before attachTo(); saved geometry needs the attached stage.
          await rendition.q.enqueue(() => undefined);
          const metadata = await book.loaded.metadata;
          if (!active) return;
          fixedLayout = metadata.layout === "pre-paginated" || rendition.settings.layout === "pre-paginated" ||
            book.packaging.spine.some((section) => section.properties.includes("rendition:layout-pre-paginated"));
          appliedPreferences = effectivePreferences(preferencesRef.current);
          styles.apply(appliedPreferences);
          applyGeometry(appliedPreferences);
          appliedRequest = preferencesRef.current;
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
            publishPresentation(true);
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
        if (active) publishPresentation(true);
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
      if (presentationFrame !== null) cancelAnimationFrame(presentationFrame);
      if (resizeTimerRef.current !== null) {
        window.clearTimeout(resizeTimerRef.current);
        resizeTimerRef.current = null;
      }
      resizeSchedulerRef.current = () => {};
      changeLayoutRef.current = () => {};
      window.removeEventListener("pagehide", onPageHide);
      disposeKeyboard();
      styles.dispose();
      rendition.off("relocated", onRelocated);
      deferBookDestroy();
    };
  }, [book, path, registerKeyboardTarget]);

  const status = readingStatus.book === book ? readingStatus.value : { label: "EPUB", page: null, total: null };
  const backdrop = DOCUMENT_THEMES.find((theme) => theme.id === applied.theme)?.background ?? "#fff";
  const loading = presentation.book !== book || !presentation.ready;

  return (
    <section className="epub-reader" aria-label="EPUB reader">
      {error && <div className="epub-reader__error" role="alert">{error}</div>}
      <div className="epub-reader__surface" ref={surfaceRef} style={{ background: backdrop }}>
        <div className="epub-reader__viewport" ref={viewportRef} tabIndex={-1} aria-label="EPUB reading area" aria-busy={loading} style={{ background: backdrop }} />
      </div>
      <footer className="status-bar epub-status" aria-label="EPUB reading status" aria-live="off">
        {loading && <span role="status">Opening EPUB…</span>}
        <span className="visually-hidden">
          {status.label}{status.page !== null && ` — First visible page ${status.page} of ${status.total} in this section`}
        </span>
        <span className="status-document" aria-hidden="true">
          <span className="epub-status__chapter" title={status.label}>{status.label}</span>
          {status.page !== null && <span className="epub-status__detail"> · Page {status.page} / {status.total} in section</span>}
        </span>
        {overlay === null && <button className="status-commands" aria-label="Open reader commands (:)" onClick={openCommandPalette}>Commands :</button>}
      </footer>
      {overlay === "commands" && <ReaderCommandPalette
        commands={visibleCommands}
        commandStates={paletteMode === "commands" ? commandStates : undefined}
        commandIndex={commandIndex}
        query={commandQuery}
        placeholder={paletteMode === "chapters" ? "Filter chapters" : paletteMode === "themes" ? "Filter document themes" : paletteMode === "preferences" ? "Filter reading preferences" : fieldLabel ? `Filter ${fieldLabel.toLowerCase()}` : "Filter commands"}
        ariaLabel={paletteMode === "chapters" ? "Choose a chapter" : paletteMode === "themes" ? "Document themes" : paletteMode === "preferences" ? "Reading preferences" : fieldLabel ?? "Reader commands"}
        emptyMessage={paletteMode === "chapters" ? "No matching chapters" : "No commands"}
        onQueryChange={setCommandQuery}
        onCommandIndexChange={setCommandIndex}
        onExecute={executePaletteCommand}
      />}
    </section>
  );
}
