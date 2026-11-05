import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";

export type ReaderOverlay = "search" | "jump" | "commands" | "recolor-color" | null;
export type ReaderKind = "pdf" | "epub";
export type ReaderCommandId =
  | "open_document"
  | "close_document"
  | "search"
  | "next_item"
  | "previous_item"
  | "goto_page_with_page_number"
  | "next_page"
  | "previous_page"
  | "goto_beginning"
  | "goto_end"
  | "zoom_in"
  | "zoom_out"
  | "fit_to_page_width"
  | "single_page_view"
  | "two_page_spread"
  | "fit_to_page"
  | "fit_to_spread"
  | "toggle_night_mode"
  | "toggle_continuous_scrolling"
  | "previous_chapter"
  | "next_chapter"
  | "go_to_chapter"
  | "paged_layout"
  | "continuous_layout"
  | "select_chapter"
  | "document_appearance"
  | "epub_reading_preferences"
  | "back_to_commands"
  | "theme_original"
  | "theme_light"
  | "theme_dark"
  | "theme_sepia"
  | "theme_zathura_dark"
  | "theme_gruvbox_dark"
  | "theme_solarized_dark"
  | "theme_rose_pine_dawn"
  | "epub_set_font_family"
  | "epub_size_publisher"
  | "epub_set_line_height"
  | "epub_set_alignment"
  | "epub_set_margins"
  | "epub_set_column_width"
  | "epub_text_larger"
  | "epub_text_smaller"
  | "epub_reset_typography"
  | "toggle_recolor"
  | "pdf_advanced_appearance"
  | "recolor_toggle_keephue"
  | "recolor_toggle_reverse_video"
  | "recolor_toggle_adjust_lightness"
  | "recolor_set_lightcolor"
  | "recolor_set_darkcolor";
export type ReaderCommand = {
  id: ReaderCommandId;
  shortcut: string;
  scope?: ReaderKind;
  label?: string;
  key?: string;
  depth?: number;
  targetHref?: string;
  value?: string;
  state?: { active: boolean; text: string };
  disabled?: boolean;
};

export const READER_COMMANDS: ReaderCommand[] = [
  { id: "open_document", shortcut: "Ctrl+O", label: "Open document" },
  { id: "close_document", shortcut: "Ctrl+W", label: "Close document" },
  { id: "search", shortcut: "/ · Ctrl+F", label: "Search document" },
  { id: "next_item", shortcut: "n · Enter", label: "Next search match" },
  { id: "previous_item", shortcut: "N · Shift+Enter", label: "Previous search match" },
  { id: "goto_page_with_page_number", shortcut: "g", label: "Go to page number" },
  { id: "next_page", shortcut: "Ctrl+PageDown · Shift+J", label: "Next page" },
  { id: "previous_page", shortcut: "Ctrl+PageUp · Shift+K", label: "Previous page" },
  { id: "goto_beginning", shortcut: "Home", label: "Go to beginning" },
  { id: "goto_end", shortcut: "End", label: "Go to end" },
  { id: "zoom_in", shortcut: "+", label: "Zoom in" },
  { id: "zoom_out", shortcut: "-", label: "Zoom out" },
  { id: "fit_to_page_width", shortcut: "=", label: "Fit to page width" },
  { id: "single_page_view", shortcut: "", label: "Single page view" },
  { id: "two_page_spread", shortcut: "", label: "Two page spread" },
  { id: "fit_to_page", shortcut: "w", label: "Fit to page" },
  { id: "fit_to_spread", shortcut: "F", label: "Fit to spread" },
  { id: "toggle_continuous_scrolling", shortcut: "", label: "Toggle continuous scrolling" },
  { id: "toggle_night_mode", shortcut: "i", label: "Toggle application appearance" },
  { id: "document_appearance", shortcut: "", label: "Document theme…" },
  { id: "pdf_advanced_appearance", shortcut: "", label: "Advanced PDF appearance…" },
];

export const EPUB_READER_COMMANDS: ReaderCommand[] = [
  { id: "open_document", shortcut: "o · Ctrl+O", scope: "epub", label: "Open document" },
  { id: "previous_chapter", shortcut: "Shift+N", scope: "epub", label: "Previous chapter" },
  { id: "next_chapter", shortcut: "n", scope: "epub", label: "Next chapter" },
  { id: "go_to_chapter", shortcut: "", scope: "epub", label: "Go to chapter" },
  { id: "next_page", shortcut: "PageDown", scope: "epub", label: "Next page" },
  { id: "previous_page", shortcut: "PageUp", scope: "epub", label: "Previous page" },
  { id: "document_appearance", shortcut: "", scope: "epub", label: "Document theme…" },
  { id: "epub_reading_preferences", shortcut: "", scope: "epub", label: "Reading preferences…" },
  { id: "paged_layout", shortcut: "", scope: "epub", label: "Paged layout" },
  { id: "continuous_layout", shortcut: "", scope: "epub", label: "Continuous layout" },
  { id: "toggle_night_mode", shortcut: "i", scope: "epub", label: "Toggle application appearance" },
  { id: "close_document", shortcut: "Ctrl+W", scope: "epub", label: "Close document" },
];

export function filterReaderCommands(
  query: string,
  hasDocument: boolean,
  readerKind: ReaderKind = "pdf",
  commandSet?: ReaderCommand[],
): ReaderCommand[] {
  const normalize = (text: string) => text.trim().toLocaleLowerCase().replace(/\s+/g, " ");
  const normalizedQuery = normalize(query);
  const commands = commandSet ?? (readerKind === "epub" ? EPUB_READER_COMMANDS : READER_COMMANDS);
  return commands.filter((command) => {
    if ((command.scope ?? "pdf") !== readerKind) return false;
    if (!hasDocument && command.id !== "open_document" && command.id !== "toggle_night_mode" &&
      !command.id.startsWith("recolor_") && !command.id.startsWith("theme_") && command.id !== "toggle_recolor" &&
      command.id !== "document_appearance" && command.id !== "pdf_advanced_appearance" && command.id !== "back_to_commands") return false;
    const terms = command.id === "select_chapter"
      ? `${command.label ?? ""} ${command.targetHref ?? ""}`
      : `${command.label ?? ""} ${command.id} ${command.id.replace(/_/g, " ")} ${command.shortcut}`;
    return normalize(terms).includes(normalizedQuery);
  });
}

export function clampCommandIndex(index: number, count: number): number {
  return Math.max(0, Math.min(index, count - 1));
}

type ReaderKeyboardState = {
  readerKind: ReaderKind;
  overlay: ReaderOverlay;
  commands: ReaderCommand[];
  searchReady: boolean;
  matchCount: number;
  jumpInput: string;
  pageCount: number;
  commandIndex: number;
  epubLayoutMode?: "paged" | "continuous";
  continuousScrolling?: boolean;
};

type ReaderKeyboardActions = {
  closeOverlay: () => void;
  moveMatch: (direction: number) => void;
  runSearch: () => void;
  goToPage: (page: number) => void;
  reportInvalidPage?: (message: string) => void;
  executePaletteCommand: (command: ReaderCommand) => void;
  runCommand: (command: ReaderCommandId) => void;
  scrollContinuous?: (direction: -1 | 1, amount: "page" | "line") => void;
  scrollPdfContinuous?: (direction: PdfPanDirection) => void;
  isPdfZoomedIn?: () => boolean;
  getPdfZoomOverflow?: () => PdfZoomOverflow;
  panPdf?: (direction: PdfPanDirection) => boolean;
  panPdfPage?: (direction: -1 | 1) => boolean;
  navigatePageWithBoundary?: (direction: -1 | 1) => void;
  scrollPdfToPageEdge?: (edge: "top" | "bottom") => void;
  setCommandQuery: (query: string) => void;
  setCommandIndex: Dispatch<SetStateAction<number>>;
  setOverlay: (overlay: ReaderOverlay) => void;
};

export type PdfZoomOverflow = {
  horizontal: boolean;
  vertical: boolean;
};

export type PdfPanDirection = "left" | "right" | "up" | "down";
export type PdfNavigationAction =
  | { kind: "pan"; direction: PdfPanDirection }
  | { kind: "page-pan"; direction: -1 | 1 }
  | { kind: "navigate"; direction: -1 | 1 }
  | { kind: "page-edge"; edge: "top" | "bottom" }
  | { kind: "document-edge"; edge: "top" | "bottom" };

export function resolvePdfNavigationAction(
  key: string,
  shiftKey: boolean,
  zoomState: boolean | PdfZoomOverflow,
): PdfNavigationAction | null {
  if (key === "J" || (shiftKey && key.toLowerCase() === "j")) return { kind: "navigate", direction: 1 };
  if (key === "K" || (shiftKey && key.toLowerCase() === "k")) return { kind: "navigate", direction: -1 };

  if (key === "PageDown") return { kind: "page-pan", direction: 1 };
  if (key === "PageUp") return { kind: "page-pan", direction: -1 };
  if (key === "Home") return { kind: "document-edge", edge: "top" };
  if (key === "End") return { kind: "document-edge", edge: "bottom" };

  const overflow: PdfZoomOverflow =
    typeof zoomState === "boolean"
      ? { horizontal: zoomState, vertical: zoomState }
      : zoomState;

  const isLeft = key === "ArrowLeft" || key.toLowerCase() === "h";
  const isRight = key === "ArrowRight" || key.toLowerCase() === "l";
  const isUp = key === "ArrowUp" || key.toLowerCase() === "k";
  const isDown = key === "ArrowDown" || key.toLowerCase() === "j";

  if (isUp) return { kind: "pan", direction: "up" };
  if (isDown) return { kind: "pan", direction: "down" };

  if (isLeft) {
    return overflow.horizontal ? { kind: "pan", direction: "left" } : { kind: "navigate", direction: -1 };
  }
  if (isRight) {
    return overflow.horizontal ? { kind: "pan", direction: "right" } : { kind: "navigate", direction: 1 };
  }

  return null;
}
export type ContinuousPdfNavigationAction =
  | { kind: "scroll"; direction: PdfPanDirection }
  | { kind: "navigate"; direction: -1 | 1 }
  | { kind: "native" };

export function resolveContinuousPdfNavigationAction(
  key: string,
  shiftKey: boolean,
): ContinuousPdfNavigationAction | null {
  if (key === "J" || (shiftKey && key.toLowerCase() === "j")) return { kind: "navigate", direction: 1 };
  if (key === "K" || (shiftKey && key.toLowerCase() === "k")) return { kind: "navigate", direction: -1 };
  if (key.startsWith("Arrow") || key === "PageUp" || key === "PageDown") return { kind: "native" };
  const direction: PdfPanDirection | null =
    key.toLowerCase() === "h" ? "left" :
    key.toLowerCase() === "l" ? "right" :
    key.toLowerCase() === "k" ? "up" :
    key.toLowerCase() === "j" ? "down" :
    null;
  return direction ? { kind: "scroll", direction } : null;
}

export function resolvePdfControlCommand(
  event: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
): ReaderCommandId | null {
  if (!event.ctrlKey || event.metaKey || event.altKey) return null;
  const key = !event.key || event.key === "Unidentified" ? event.code : event.key;
  // Prefer the character; numpad codes also cover legacy Add/Subtract key names.
  if (key === "+" || key === "=" || key === "Add" || key === "Equal" || event.code === "NumpadAdd") {
    return "zoom_in";
  }
  if (event.shiftKey) return null;
  if (key === "-" || key === "Subtract" || key === "Minus" || event.code === "NumpadSubtract") {
    return "zoom_out";
  }
  switch (key) {
    case "PageDown": return "next_page";
    case "PageUp": return "previous_page";
    case "Home": return "goto_beginning";
    case "End": return "goto_end";
    default: return null;
  }
}


type RepeatNavigationAction =
  | { kind: "command"; command: ReaderCommandId }
  | { kind: "pdf-key"; key: string; shiftKey: boolean };

export function performPdfNavigation(action: PdfNavigationAction, actions: ReaderKeyboardActions): void {
  switch (action.kind) {
    case "pan":
      actions.panPdf?.(action.direction);
      break;
    case "page-pan":
      if (!actions.panPdfPage?.(action.direction)) {
        if (actions.navigatePageWithBoundary) {
          actions.navigatePageWithBoundary(action.direction);
        } else {
          actions.runCommand(action.direction > 0 ? "next_page" : "previous_page");
        }
      }
      break;
    case "navigate":
      if (actions.navigatePageWithBoundary) {
        actions.navigatePageWithBoundary(action.direction);
      } else {
        actions.runCommand(action.direction > 0 ? "next_page" : "previous_page");
      }
      break;
    case "page-edge":
      actions.scrollPdfToPageEdge?.(action.edge);
      break;
    case "document-edge":
      actions.runCommand(action.edge === "top" ? "goto_beginning" : "goto_end");
      break;
  }
}

function performPdfKey(key: string, shiftKey: boolean, actions: ReaderKeyboardActions): boolean {
  const zoomState = actions.getPdfZoomOverflow?.() ?? (actions.isPdfZoomedIn?.() ?? false);
  const action = resolvePdfNavigationAction(key, shiftKey, zoomState);
  if (!action) return false;
  performPdfNavigation(action, actions);
  return true;
}


function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const element = target as Element & { isContentEditable?: boolean };
  return Boolean(element.isContentEditable || element.closest?.(
    "input, textarea, select, button, [role='button'], [role='textbox'], [role='combobox'], [contenteditable='true']",
  ));
}

export function useReaderKeyboard(state: ReaderKeyboardState, actions: ReaderKeyboardActions): (target: Document) => () => void {
  const latestRef = useRef({ state, actions });
  const keyDownHandlerRef = useRef<(event: KeyboardEvent) => void>(() => {});
  const keyUpHandlerRef = useRef<(event: KeyboardEvent) => void>(() => {});
  latestRef.current = { state, actions };

  const registerKeyboardTarget = useCallback((target: Document) => {
    const eventTarget = target.defaultView;
    if (!eventTarget) return () => {};
    const onKeyDown = (event: KeyboardEvent) => keyDownHandlerRef.current(event);
    const onKeyUp = (event: KeyboardEvent) => keyUpHandlerRef.current(event);
    eventTarget.addEventListener("keydown", onKeyDown, true);
    eventTarget.addEventListener("keyup", onKeyUp, true);
    return () => {
      eventTarget.removeEventListener("keydown", onKeyDown, true);
      eventTarget.removeEventListener("keyup", onKeyUp, true);
    };
  }, []);

  const heldNavigationKeysRef = useRef(new Map<string, RepeatNavigationAction>());
  const pendingNavigationRef = useRef<{ code: string; action: RepeatNavigationAction } | null>(null);
  const repeatFrameRef = useRef<number | null>(null);
  const cancelNavigationRef = useRef<() => void>(() => {});

  useEffect(() => {
    const cancelPendingFrame = () => {
      if (repeatFrameRef.current !== null) {
        cancelAnimationFrame(repeatFrameRef.current);
        repeatFrameRef.current = null;
      }
      pendingNavigationRef.current = null;
    };
    const cancelNavigation = () => {
      cancelPendingFrame();
      heldNavigationKeysRef.current.clear();
    };
    cancelNavigationRef.current = cancelNavigation;
    const queueNavigationRepeat = (code: string, action: RepeatNavigationAction) => {
      pendingNavigationRef.current = { code, action };
      if (repeatFrameRef.current !== null) return;
      repeatFrameRef.current = requestAnimationFrame(() => {
        repeatFrameRef.current = null;
        const pending = pendingNavigationRef.current;
        pendingNavigationRef.current = null;
        if (!pending || heldNavigationKeysRef.current.get(pending.code) !== pending.action) return;

        const current = latestRef.current;
        if (current.state.overlay || isInteractiveTarget(document.activeElement)) {
          cancelNavigation();
          return;
        }
        if (pending.action.kind === "command") current.actions.runCommand(pending.action.command);
        else performPdfKey(pending.action.key, pending.action.shiftKey, current.actions);
      });
    };

    function onKeyDown(event: KeyboardEvent) {
      const current = latestRef.current;
      const { readerKind, overlay, commands, searchReady, matchCount, jumpInput, pageCount, commandIndex } = current.state;
      const { closeOverlay, moveMatch, runSearch, goToPage, executePaletteCommand, runCommand, scrollContinuous, setCommandQuery, setCommandIndex, setOverlay } = current.actions;
      const typing = isInteractiveTarget(event.target);
      if (typing || overlay) cancelNavigation();

      const modifier = event.ctrlKey || event.metaKey;
      const unmodified = !modifier && !event.altKey;

      if (event.key === "Escape" && overlay) {
        event.preventDefault();
        closeOverlay();
        return;
      }
      if (overlay === "search") {
        if (event.key === "Enter") {
          event.preventDefault();
          if (searchReady && matchCount) moveMatch(event.shiftKey ? -1 : 1);
          else runSearch();
        }
        return;
      }
      if (overlay === "jump") {
        if (event.key === "Enter") {
          event.preventDefault();
          const page = Number(jumpInput);
          if (/^\d+$/.test(jumpInput) && page >= 1 && page <= pageCount) {
            goToPage(page);
            closeOverlay();
          } else {
            current.actions.reportInvalidPage?.(pageCount
              ? `Enter a whole page number (1–${pageCount}).`
              : "No PDF is open.");
          }
        }
        return;
      }
      if (overlay === "recolor-color") {
        return;
      }
      if (overlay === "commands") {
        if (event.key === "ArrowDown" && commands.length) {
          event.preventDefault();
          setCommandIndex((index) => Math.min(clampCommandIndex(index, commands.length) + 1, commands.length - 1));
        } else if (event.key === "ArrowUp" && commands.length) {
          event.preventDefault();
          setCommandIndex((index) => Math.max(clampCommandIndex(index, commands.length) - 1, 0));
        } else if (event.key === "Enter") {
          event.preventDefault();
          const command = commands[clampCommandIndex(commandIndex, commands.length)];
          if (command && !command.disabled) executePaletteCommand(command);
        }
        return;
      }
      if (typing || overlay) return;
      const sharedKey = event.key.toLowerCase();
      if (modifier && !event.altKey && !event.shiftKey && (sharedKey === "o" || sharedKey === "w")) {
        event.preventDefault();
        runCommand(sharedKey === "o" ? "open_document" : "close_document");
        return;
      }
      if (unmodified && !event.shiftKey && sharedKey === "i") {
        event.preventDefault();
        runCommand("toggle_night_mode");
        return;
      }
      if (readerKind === "epub") {
        if (!typing && unmodified && (event.key === ":" || (event.code === "Semicolon" && event.shiftKey))) {
          event.preventDefault();
          setCommandQuery("");
          setCommandIndex(0);
          setOverlay("commands");
          return;
        }
        if (!typing && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "o") {
          event.preventDefault();
          runCommand("open_document");
          return;
        }
        if (typing || !unmodified) return;

        const key = event.key.toLowerCase();
        if (key === "n") {
          event.preventDefault();
          runCommand(event.shiftKey || event.key === "N" ? "previous_chapter" : "next_chapter");
          return;
        }
        const layoutMode = current.state.epubLayoutMode ?? "paged";
        if (layoutMode === "continuous") {
          const direction =
            event.key === "PageDown" || event.key === "ArrowDown" || key === "j"
              ? 1
              : event.key === "PageUp" || event.key === "ArrowUp" || key === "k"
                ? -1
                : 0;
          if (!direction) return;
          event.preventDefault();
          const amount = event.key === "PageDown" || event.key === "PageUp" ? "page" : "line";
          scrollContinuous?.(direction, amount);
          return;
        }
        const navigationCommand =
          event.key === "PageDown" || event.key === "ArrowRight" || key === "j"
            ? "next_page"
            : event.key === "PageUp" || event.key === "ArrowLeft" || key === "k"
              ? "previous_page"
              : null;
        if (!navigationCommand) return;
        event.preventDefault();
        const code = event.code || event.key;
        const repeatAction: RepeatNavigationAction = { kind: "command", command: navigationCommand };
        const heldAction = heldNavigationKeysRef.current.get(code);
        if (event.repeat && !heldAction) return;
        if (heldAction) {
          queueNavigationRepeat(code, heldAction);
        } else {
          heldNavigationKeysRef.current.set(code, repeatAction);
          runCommand(navigationCommand);
        }
        return;
      }
      if (typing || overlay) return;
      const key = event.key.toLowerCase();
      if (modifier && !event.altKey && !event.shiftKey) {
        if (key === "f") {
          event.preventDefault();
          runCommand("search");
          return;
        }
      }
      const controlCommand = resolvePdfControlCommand(event);
      const controlNavigation = controlCommand === "next_page" || controlCommand === "previous_page" ||
        controlCommand === "goto_beginning" || controlCommand === "goto_end";
      const pdfKey = controlCommand === "next_page" ? "J" :
        controlCommand === "previous_page" ? "K" :
        controlCommand === "goto_beginning" ? "Home" :
        controlCommand === "goto_end" ? "End" : event.key;
      if (current.state.continuousScrolling && (unmodified || controlNavigation)) {
        const action = resolveContinuousPdfNavigationAction(pdfKey, event.shiftKey);
        if (action?.kind === "native") return;
        if (action?.kind === "scroll") {
          event.preventDefault();
          current.actions.scrollPdfContinuous?.(action.direction);
          return;
        }
        if (action?.kind === "navigate") {
          event.preventDefault();
          const command: ReaderCommandId = action.direction > 0 ? "next_page" : "previous_page";
          const code = event.code || event.key;
          const repeatAction: RepeatNavigationAction = { kind: "command", command };
          const heldAction = heldNavigationKeysRef.current.get(code);
          if (event.repeat && !heldAction) return;
          if (heldAction) {
            queueNavigationRepeat(code, heldAction);
          } else {
            heldNavigationKeysRef.current.set(code, repeatAction);
            runCommand(command);
          }
          return;
        }
      }

      const zoomState = current.actions.getPdfZoomOverflow?.() ?? (current.actions.isPdfZoomedIn?.() ?? false);
      const pdfNavigationAction = resolvePdfNavigationAction(pdfKey, event.shiftKey, zoomState);
      if ((unmodified || controlNavigation) && pdfNavigationAction) {
        event.preventDefault();
        const code = event.code || event.key;
        const repeatAction: RepeatNavigationAction = {
          kind: "pdf-key",
          key: pdfKey,
          shiftKey: event.shiftKey,
        };
        const heldAction = heldNavigationKeysRef.current.get(code);
        if (event.repeat && !heldAction) return;
        if (heldAction) {
          queueNavigationRepeat(code, heldAction);
        } else {
          heldNavigationKeysRef.current.set(code, repeatAction);
          performPdfNavigation(pdfNavigationAction, current.actions);
        }
        return;
      }

      const zoomInKey = controlCommand === "zoom_in" || (!modifier && !event.altKey && event.key === "+");
      const zoomOutKey = controlCommand === "zoom_out" ||
        (unmodified && (event.key === "-" || (!event.shiftKey && event.code === "Minus")));
      if (zoomInKey || zoomOutKey) {
        event.preventDefault();
        const command: ReaderCommandId = zoomInKey ? "zoom_in" : "zoom_out";
        const code = event.code || event.key;
        const repeatAction: RepeatNavigationAction = { kind: "command", command };
        const heldAction = heldNavigationKeysRef.current.get(code);
        if (event.repeat && !heldAction) return;
        if (heldAction) {
          queueNavigationRepeat(code, heldAction);
        } else {
          heldNavigationKeysRef.current.set(code, repeatAction);
          runCommand(command);
        }
      } else if (unmodified && !event.shiftKey && key === "w") {
        event.preventDefault();
        runCommand("fit_to_page");
      } else if (unmodified && !event.shiftKey && key === "r") {
        event.preventDefault();
        runCommand("toggle_recolor");
      } else if (unmodified && !event.shiftKey && event.key === "=") {
        event.preventDefault();
        runCommand("fit_to_page_width");
      } else if (unmodified && key === "g" && !event.shiftKey) {
        event.preventDefault();
        runCommand("goto_page_with_page_number");
      } else if (unmodified && event.key === "/") {
        event.preventDefault();
        runCommand("search");
      } else if (unmodified && event.shiftKey && key === "f") {
        event.preventDefault();
        runCommand("fit_to_spread");
      } else if (unmodified && key === "n") {
        event.preventDefault();
        runCommand(event.shiftKey || event.key === "N" ? "previous_item" : "next_item");
      } else if (unmodified && (event.key === ":" || (event.code === "Semicolon" && event.shiftKey))) {
        event.preventDefault();
        setCommandQuery("");
        setCommandIndex(0);
        setOverlay("commands");
      }
    }

    function onKeyUp(event: KeyboardEvent) {
      const code = event.code || event.key;
      heldNavigationKeysRef.current.delete(code);
      if (pendingNavigationRef.current?.code === code) cancelPendingFrame();
    }

    keyDownHandlerRef.current = onKeyDown;
    keyUpHandlerRef.current = onKeyUp;
    const unregisterDocument = registerKeyboardTarget(document);
    const onFocusIn = (event: FocusEvent) => {
      if (latestRef.current.state.readerKind === "pdf" || isInteractiveTarget(event.target)) cancelNavigation();
    };
    const onFocusOut = () => {
      if (latestRef.current.state.readerKind === "pdf") cancelNavigation();
    };
    const onVisibilityChange = () => {
      if (document.hidden) cancelNavigation();
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("blur", cancelNavigation);
    return () => {
      unregisterDocument();
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      document.removeEventListener("focusout", onFocusOut);
      window.removeEventListener("blur", cancelNavigation);
      cancelNavigation();
    };
  }, [registerKeyboardTarget]);
  useLayoutEffect(() => {
    if (state.readerKind === "pdf" && state.overlay !== null) cancelNavigationRef.current();
  }, [state.readerKind, state.overlay]);
  return registerKeyboardTarget;
}
