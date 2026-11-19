import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { loadEpubReadingPosition, saveEpubReadingPosition } from "../platform/readingPosition";
import { invoke } from "@tauri-apps/api/core";
import type { View, Book, SearchMatch, SearchIterator, TOCItem } from "foliate-js/view.js";
import { applyFoliatePreferences, foliatePreferenceRetention, prepareFoliateSession, restoreFoliateTypography } from "./foliateSession";
import type { FoliateSession } from "./foliateSession";
import { createFoliateStatusLabeler } from "./foliateStatus";
import { Overlayer } from "foliate-js/overlayer.js";
import { DEFAULT_EPUB_PREFERENCES, loadEpubPreferences, saveEpubPreferences } from "./preferences";
import { DOCUMENT_THEMES } from "../reader/appearance";
import { applyEpubPreferenceCommand, commandTheme, epubPreferenceCommands, epubPreferenceMenuCommands, searchableReaderCommands, themeCommands } from "../reader/appearanceCommands";
import type { EpubPreferenceField } from "../reader/appearanceCommands";
import { getEpubCommandStates } from "../reader/commandState";
import { EPUB_READER_COMMANDS, filterReaderCommands, useReaderKeyboard } from "../reader/interactions";
import type { ReaderCommand, ReaderCommandId, ReaderOverlay } from "../reader/interactions";
import { ReaderCommandPalette } from "../reader/ReaderCommandPalette";
import "../reader/Reader.css";
import "../reader/ReaderStatus.css";
import "../App.css";
import "./FoliateReader.css";

type Props = { sessionId?: string; canonicalPath?: string | null; prepared?: FoliateSession; onClose?: () => void; onOpenDocument?: () => void; nightMode?: boolean; onToggleNightMode?: () => void };
export function FoliateReader({ sessionId, canonicalPath, prepared, onClose, onOpenDocument, nightMode, onToggleNightMode }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const viewRef = useRef<View | null>(null);
  const [book, setBook] = useState<Book | null>(null);
  const [mounted, setMounted] = useState<FoliateSession | null>(null);
  const [message, setMessage] = useState("Opening publication…");
  const [location, setLocation] = useState("");
  const [nativeNightMode, setNativeNightMode] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  const effectiveNightMode = nightMode ?? nativeNightMode;
  const [sectionPages, setSectionPages] = useState<{ page: number; total: number } | null>(null);
  const [preferences, setPreferences] = useState(loadEpubPreferences);
  const [mode, setMode] = useState<"paged" | "continuous">("paged");
  const [overlay, setOverlay] = useState<ReaderOverlay>(null);
  const [menu, setMenu] = useState<"root" | "toc" | "appearance" | "preferences" | "preference-field">("root");
  const [preferenceField, setPreferenceField] = useState<EpubPreferenceField>("fontScale");
  const [query, setQuery] = useState("");
  const [commandIndex, setCommandIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [activeMatch, setActiveMatch] = useState(-1);
  const [searching, setSearching] = useState(false);
  const searchGeneration = useRef(0);
  const searchIterator = useRef<SearchIterator | null>(null);
  const permitSave = useRef(false);
  const writeQueue = useRef(Promise.resolve());
  const registerRef = useRef<(doc: Document) => () => void>(() => () => {});
  const activeCfi = useRef<string | null>(null);
  const restoreHostFocus = useRef(false);
  const scrollStart = useRef<string | null>(null);
  const queuePosition = (view: View) => {
    const cfi = view.lastLocation?.cfi;
    if ((!sessionId && !canonicalPath) || !cfi || !permitSave.current || viewRef.current !== view) return;
    writeQueue.current = writeQueue.current.catch(() => {}).then(() => {
      if (viewRef.current !== view) return;
      return sessionId ? invoke<void>("save_epub_session_position", { sessionId, cfi })
        : saveEpubReadingPosition(canonicalPath!, { cfi, cfiModel: "foliate-html-v1" });
    }).catch(error => {
      if (viewRef.current === view) setMessage(`Position not saved: ${error}`);
    });
  };
  const turnPage = async (direction: number, distance?: number) => {
    const view = viewRef.current;
    if (!view) return;
    const before = view.lastLocation?.cfi;
    if (direction > 0) await view.next(distance);
    else await view.prev(distance);
    if (viewRef.current === view && view.lastLocation?.cfi !== before) {
      permitSave.current = true;
      queuePosition(view);
    }
  };

  const navigate = async (target: string | number) => {
    const view = viewRef.current;
    if (!view) return;
    const before = view.lastLocation?.cfi;
    const resolved = await view.goTo(target);
    if (resolved && viewRef.current === view && view.lastLocation?.cfi !== before) {
      permitSave.current = true;
      queuePosition(view);
    }
  };
  const moveMatch = (direction: number) => {
    if (!matches.length) return;
    const index = (activeMatch + direction + matches.length) % matches.length;
    setActiveMatch(index);
    void navigate(matches[index].cfi);
  };
  const runSearch = async () => {
    const view = viewRef.current;
    if (!view) return;
    const generation = ++searchGeneration.current;
    await searchIterator.current?.return("done");
    if (generation !== searchGeneration.current || view !== viewRef.current) return;
    view.clearSearch();
    if (activeCfi.current) await view.deleteAnnotation({ value: activeCfi.current });
    activeCfi.current = null;
    setMatches([]); setActiveMatch(-1);
    if (!searchQuery.trim()) { setSearching(false); return; }
    setSearching(true);
    const iterator = view.search({ query: searchQuery });
    searchIterator.current = iterator;
    const found: SearchMatch[] = [];
    try {
      for await (const result of iterator) {
        if (generation !== searchGeneration.current || view !== viewRef.current) return;
        if (typeof result === "object") {
          if ("subitems" in result) found.push(...result.subitems);
          else if ("cfi" in result) found.push(result);
          setMatches([...found]);
        }
      }
      if (found.length) { setActiveMatch(0); await navigate(found[0].cfi); }
    } catch (error) { if (generation === searchGeneration.current) setMessage(String(error)); }
    finally { if (generation === searchGeneration.current) setSearching(false); }
  };
  const closeOverlay = () => {
    setOverlay(null); setQuery(""); setMenu("root");
    restoreHostFocus.current = true;
  };
  const openMenu = (next: typeof menu) => {
    setMenu(next); setQuery(""); setCommandIndex(0); setOverlay("commands");
  };
  const runCommand = (id: ReaderCommandId) => {
    const view = viewRef.current;
    switch (id) {
      case "next_page": void turnPage(1); break;
      case "previous_page": void turnPage(-1); break;
      case "open_document":
        if (sessionId) void invoke("request_epub_open", { sessionId });
        else onOpenDocument?.();
        break;
      case "next_chapter": case "previous_chapter": {
        if (!view?.lastLocation) break;
        // Spread ownership can differ from the first-visible reading location.
        const current = view.resolveCFI(view.lastLocation.cfi).index;
        const direction = id === "next_chapter" ? 1 : -1;
        let next = current + direction;
        while (book && next >= 0 && next < book.sections.length && book.sections[next].linear === "no") next += direction;
        if (book && next >= 0 && next < book.sections.length) void navigate(next);
        break;
      }
      case "go_to_chapter": openMenu("toc"); break;
      case "document_appearance": openMenu("appearance"); break;
      case "epub_reading_preferences": openMenu("preferences"); break;
      case "paged_layout": setMode("paged"); break;
      case "continuous_layout": setMode("continuous"); break;
      case "search": setOverlay("search"); break;
      case "next_item": moveMatch(1); break;
      case "previous_item": moveMatch(-1); break;
      case "close_document":
        if (sessionId) void writeQueue.current.finally(() => invoke("close_epub_session", { sessionId }));
        else onClose?.();
        break;
      case "toggle_night_mode":
        if (onToggleNightMode) onToggleNightMode();
        else setNativeNightMode(current => !current);
        break;
    }
  };
  const tocCommands: ReaderCommand[] = [];
  const flatten = (items: TOCItem[], depth = 0) => {
    for (const item of items) {
      tocCommands.push({ id: "select_chapter", key: `chapter:${tocCommands.length}`, scope: "epub", shortcut: "", label: item.label, targetHref: item.href, depth });
      flatten(item.subitems ?? [], depth + 1);
    }
  };
  flatten(book?.toc ?? []);
  const retained = viewRef.current ? foliatePreferenceRetention(viewRef.current) : "";
  const applied = retained ? DEFAULT_EPUB_PREFERENCES : preferences;
  const themes = themeCommands("epub", applied.theme, preferences.theme, retained ? `Saved — ${retained.toLowerCase()} retained` : undefined);
  const preferenceChoices = epubPreferenceCommands(preferences, applied, retained);
  const root: ReaderCommand[] = EPUB_READER_COMMANDS.map(command => mode === "continuous" && (command.id === "next_page" || command.id === "previous_page")
    ? { ...command, label: command.id === "next_page" ? "Next screen" : "Previous screen" } : command);
  root.splice(2, 0, { id: "search", scope: "epub", label: "Search document", shortcut: "/ · Ctrl+F" });
  if (matches.length) root.splice(3, 0,
    { id: "next_item", scope: "epub", label: "Next search match", shortcut: "Enter in search" },
    { id: "previous_item", scope: "epub", label: "Previous search match", shortcut: "Shift+Enter in search" });
  const catalog = menu === "toc" ? [{ id: "back_to_commands" as const, scope: "epub" as const, label: "Back to commands", shortcut: "" }, ...tocCommands]
    : menu === "appearance" ? themes : menu === "preferences" ? epubPreferenceMenuCommands(preferences, applied, retained)
    : menu === "preference-field" ? epubPreferenceCommands(preferences, applied, retained, preferenceField)
    : searchableReaderCommands(root, [themes, preferenceChoices], query);
  const commands = filterReaderCommands(query, !!book, "epub", catalog);
  const execute = (command: ReaderCommand) => {
    if (command.disabled) return;
    if (command.id === "back_to_commands") { openMenu("root"); return; }
    if (command.id === "back_to_preferences") { openMenu("preferences"); return; }
    if (command.id === "epub_preference_field") {
      setPreferenceField(command.value as EpubPreferenceField);
      openMenu("preference-field"); return;
    }
    const theme = commandTheme(command.id);
    const updated = applyEpubPreferenceCommand(preferences, command);
    if (theme) { setPreferences({ ...preferences, theme }); return; }
    if (updated) { setPreferences(updated); return; }
    if (["go_to_chapter", "document_appearance", "epub_reading_preferences"].includes(command.id)) { runCommand(command.id); return; }
    if (command.id === "close_document") { setOverlay(null); runCommand(command.id); return; }
    closeOverlay();
    if (command.id === "select_chapter" && command.targetHref) void navigate(command.targetHref);
    else runCommand(command.id);
  };
  const register = useReaderKeyboard({ readerKind: "epub", overlay, commands, searchReady: !searching, matchCount: matches.length, jumpInput: "", pageCount: 0, commandIndex, epubLayoutMode: mode }, {
    closeOverlay, moveMatch, runSearch: () => void runSearch(), goToPage: () => {}, executePaletteCommand: execute,
    runCommand, scrollContinuous: (direction, amount) => {
      void turnPage(direction, amount === "line" ? 40 : undefined);
    }, setCommandQuery: setQuery, setCommandIndex, setOverlay,
  });
  registerRef.current = register;
  useLayoutEffect(() => {
    if (overlay === "search") searchInput.current?.focus({ preventScroll: true });
    else if (overlay === null && restoreHostFocus.current) {
      restoreHostFocus.current = false;
      host.current?.focus({ preventScroll: true });
    }
  }, [overlay]);

  useEffect(() => {
    let retired = false;
    let restoring = true;
    permitSave.current = false;
    scrollStart.current = null;
    let owned: FoliateSession | undefined;
    let view: View | undefined;
    const controller = new AbortController();
    const listeners = new AbortController();
    const registrations = new Map<Document, () => void>();
    const registerDocument = (doc: Document) => {
      for (const [previous, unregister] of registrations) {
        if (!previous.defaultView?.frameElement?.isConnected || previous.defaultView.document !== previous) {
          unregister(); registrations.delete(previous);
        }
      }
      if (doc.URL === "about:blank" || registrations.has(doc)) return;
      const unregister = registerRef.current(doc);
      const inputListeners = new AbortController();
      const noteScroll = (event: Event) => {
        if (event.isTrusted) scrollStart.current = viewRef.current?.lastLocation?.cfi ?? null;
      };
      doc.addEventListener("wheel", noteScroll, { passive: true, signal: inputListeners.signal });
      doc.addEventListener("touchstart", noteScroll, { passive: true, signal: inputListeners.signal });
      registrations.set(doc, () => { unregister(); inputListeners.abort(); restoreFoliateTypography(doc); });
    };
    const open = async () => {
      if (prepared) owned = prepared;
      else if (sessionId) {
        const bytes = await invoke<ArrayBuffer>("read_epub_session", { sessionId });
        if (retired) return;
        owned = await prepareFoliateSession(new File([bytes], "publication.epub", { type: "application/epub+zip" }), controller.signal);
      }
      if (!owned || retired) return;
      view = owned.view;
      view.addEventListener("draw-annotation", event => {
        const { annotation, draw, doc } = (event as CustomEvent<{
          annotation: { value: string };
          draw: (method: typeof Overlayer.highlight, options: { color: string }) => void;
          doc: Document;
        }>).detail;
        if (annotation.value === activeCfi.current) draw((rects, options) => {
          const element = Overlayer.highlight(rects, options);
          element.classList.add("clio-search-active");
          element.style.opacity = "1";
          element.setAttribute("stroke", doc.defaultView?.getComputedStyle(doc.body).color ?? "black");
          element.setAttribute("stroke-width", "2");
          return element;
        }, { color: "rgba(255,180,0,.4)" });
      }, { signal: listeners.signal });
      view.addEventListener("create-overlay", () => {
        if (activeCfi.current) void view?.addAnnotation({ value: activeCfi.current });
      }, { signal: listeners.signal });
      viewRef.current = view;
      host.current = owned.surface;
      owned.root.inert = false;
      owned.root.style.opacity = "";
      owned.root.style.pointerEvents = "";
      setMounted(owned);
      view.addEventListener("external-link", event => event.preventDefault(), { signal: listeners.signal });
      view.addEventListener("load", event => {
        if (!retired) registerDocument((event as CustomEvent<{ doc: Document }>).detail.doc);
      }, { signal: listeners.signal });
      for (const { doc } of view.renderer.getContents()) registerDocument(doc);
      view.addEventListener("link", event => {
        event.preventDefault();
        void navigate((event as CustomEvent<{ href: string }>).detail.href);
      }, { signal: listeners.signal });
      const statusLabel = createFoliateStatusLabeler(view);
      const updateLocation = (event?: Event) => {
        if (retired || !view?.lastLocation) return;
        const current = view.lastLocation;
        const live = view.renderer.getContents();
        for (const { doc } of live) registerDocument(doc);
        setLocation(statusLabel(current.cfi));
        const page = view.renderer.page ?? NaN;
        const total = view.renderer.pages ?? NaN;
        setSectionPages(view.renderer.getAttribute("flow") !== "scrolled" && Number.isInteger(page) && Number.isInteger(total) && page >= 0 && page < total
          ? { page: page + 1, total } : null);
        const reason = (event as CustomEvent<{ reason: string | null }> | undefined)?.detail.reason;
        const navigated = event && !restoring && (reason === "navigation" || reason === "page" || reason === "snap"
          || reason === "scroll" || reason === null || (scrollStart.current && current.cfi !== scrollStart.current));
        if (navigated) {
          permitSave.current = true;
          scrollStart.current = null;
        }
        // Once navigation permits saving, reflow/resize relocations must keep
        // the durable position aligned with the same first-visible CFI.
        if (event && !restoring) queuePosition(view);
      };
      view.renderer.addEventListener("relocate", updateLocation, { signal: listeners.signal });
      let saved: unknown = null;
      let positionWarning = "";
      try {
        saved = sessionId ? await invoke<unknown>("load_epub_session_position", { sessionId })
          : canonicalPath ? await loadEpubReadingPosition(canonicalPath) : null;
      } catch (error) {
        positionWarning = `Position storage unavailable: ${error}. Opening at start; existing position retained.`;
      }
      if (retired) return;
      permitSave.current = false;
      if (saved !== null) {
        try {
          if (!saved || typeof saved !== "object" || !("cfi" in saved) || typeof saved.cfi !== "string"
            || !/^epubcfi\(.+\)$/.test(saved.cfi)) throw Error("Invalid saved location");
          if ("cfiModel" in saved && saved.cfiModel !== "foliate-html-v1") throw Error("Unsupported CFI model");
          if (!("cfiModel" in saved) && !await owned.isLegacyCfiCompatible(saved.cfi)) throw Error("Legacy document structure changed");
          if (retired) return;
          const restored = await view.goTo(saved.cfi);
          if (retired) return;
          if (!restored) throw Error("Unresolved location");
          const targetDocument = view.renderer.getContents().find(({ index }) => index === restored.index)?.doc;
          if (!targetDocument || !restored.anchor) throw Error("Missing saved passage");
          const target = restored.anchor(targetDocument);
          const node = target && "startContainer" in target ? target.startContainer : target;
          if (!node || !(targetDocument.body ?? targetDocument.documentElement).contains(node)) throw Error("Unresolved saved passage");
          setMessage("");
        } catch {
          if (retired) return;
          await view.init({ showTextStart: true });
          if (retired) return;
          setMessage("Saved EPUB position could not be restored. Original retained until you navigate.");
        }
      } else { setMessage(positionWarning); }
      if (!retired) {
        restoring = false;
        setBook(owned.book);
        updateLocation();
        if (sessionId) await invoke("ready_epub_session", { sessionId, error: null });
      }
    };
    void open().catch(error => {
      if (!retired) {
        setMessage(`Cannot open publication: ${error}`);
        if (sessionId) void invoke("ready_epub_session", { sessionId, error: String(error) });
      }
    });
    return () => {
      retired = true;
      searchGeneration.current++;
      listeners.abort();
      void searchIterator.current?.return("done");
      for (const unregister of registrations.values()) unregister();
      viewRef.current = null;
      if (!prepared) { controller.abort(); owned?.dispose(); }
      host.current = null;
    };
  }, [sessionId, canonicalPath, prepared]);

  useEffect(() => {
    const view = viewRef.current;
    const cfi = matches[activeMatch]?.cfi ?? null;
    if (!view) return;
    const previous = activeCfi.current;
    activeCfi.current = cfi;
    if (previous) void view.deleteAnnotation({ value: previous });
    if (cfi) void view.addAnnotation({ value: cfi });
    return () => { if (cfi) void view.deleteAnnotation({ value: cfi }); };
  }, [activeMatch, matches]);

  useEffect(() => {
    const view = viewRef.current;
    if (!book || !view) return;
    saveEpubPreferences(preferences);
    applyFoliatePreferences(view, preferences, mode);
  }, [preferences, mode, book]);

  const excerpt = matches[activeMatch]?.excerpt;
  const snippet = excerpt ? `${excerpt.pre}${excerpt.match}${excerpt.post}` : "";
  const backdrop = DOCUMENT_THEMES.find(theme => theme.id === applied.theme)?.background ?? "#fff";
  useLayoutEffect(() => {
    if (!mounted) return;
    mounted.root.dataset.nightMode = effectiveNightMode ? "true" : "false";
    mounted.surface.style.background = backdrop;
    mounted.surface.setAttribute("aria-busy", String(!book));
  }, [mounted, effectiveNightMode, backdrop, book]);
  if (!mounted) return <main className="clio-app foliate-reader" aria-label="EPUB reader"><p role="status">{message}</p></main>;
  return createPortal(<>
    <footer className="status-bar epub-status" aria-label="EPUB reading status" aria-live="off">
      {overlay === "search" ? <form className="foliate-search" role="search" onSubmit={event => { event.preventDefault(); void runSearch(); }}>
        <label htmlFor="epub-search" className="visually-hidden">Search document</label>
        <input ref={searchInput} id="epub-search" className="status-input" aria-label="Search query" value={searchQuery} placeholder="Search document" onChange={event => {
          setSearchQuery(event.target.value);
          const generation = ++searchGeneration.current;
          setMatches([]); setActiveMatch(-1); setSearching(false);
          void searchIterator.current?.return("done").then(() => { if (generation === searchGeneration.current) viewRef.current?.clearSearch(); });
        }} />
        <button className="status-commands" type="submit">Find</button>
        <button className="status-commands" type="button" aria-label="Previous search match" onClick={() => moveMatch(-1)}>Previous</button>
        <button className="status-commands" type="button" aria-label="Next search match" onClick={() => moveMatch(1)}>Next</button>
        <button className="status-commands" type="button" onClick={closeOverlay}>Close search</button>
      </form> : <span className="status-document">
        <span className="visually-hidden">{location || "EPUB"}{mode === "paged" && sectionPages ? `. First visible page ${sectionPages.page} of ${sectionPages.total} in this section.` : ""}</span>
        <span className="epub-status__chapter" aria-hidden="true" title={location}>{location || "EPUB"}</span>
        {mode === "paged" && sectionPages && <span className="epub-status__detail" aria-hidden="true"> · Page {sectionPages.page} / {sectionPages.total} in section</span>}</span>}
      {(overlay === "search" || matches.length > 0) && <span className="search-status" role="status" aria-live="polite" title={snippet}>{activeMatch + 1}/{matches.length}{searching ? " — searching" : ""}</span>}
      {message && <span className="status-feedback" role="status">{message}</span>}
      {overlay === null && <button className="status-commands" aria-label="Open reader commands (:)" onClick={() => openMenu("root")}>Commands :</button>}
    </footer>
    {overlay === "search" && snippet && <div className="visually-hidden" role="status">{snippet}</div>}
    {overlay === "commands" && <ReaderCommandPalette commands={commands} commandStates={menu === "root" ? { ...getEpubCommandStates(mode), toggle_night_mode: { active: effectiveNightMode, text: effectiveNightMode ? "On" : "Off" } } : undefined}
      commandIndex={commandIndex} query={query} onQueryChange={setQuery} onCommandIndexChange={setCommandIndex} onExecute={execute}
      placeholder={menu === "toc" ? "Filter chapters" : menu === "preferences" || menu === "preference-field" ? "Filter reading preferences" : menu === "appearance" ? "Filter document themes" : "Filter commands"}
      ariaLabel={menu === "toc" ? "Choose a chapter" : menu === "preferences" || menu === "preference-field" ? "Reading preferences" : menu === "appearance" ? "Document themes" : "Reader commands"} />}
  </>, mounted.chrome);
}
