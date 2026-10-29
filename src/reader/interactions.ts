import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";

export type ReaderOverlay = "search" | "jump" | "commands" | null;
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
  | "select_chapter";

export type ReaderCommand = {
  id: ReaderCommandId;
  shortcut: string;
  scope?: ReaderKind;
  label?: string;
  key?: string;
  depth?: number;
  targetHref?: string;
};

export const READER_COMMANDS: ReaderCommand[] = [
  { id: "open_document", shortcut: "Ctrl+O" },
  { id: "close_document", shortcut: "Ctrl+W", label: "Close document" },
  { id: "search", shortcut: "/ · Ctrl+F" },
  { id: "next_item", shortcut: "n · Enter" },
  { id: "previous_item", shortcut: "N · Shift+Enter" },
  { id: "goto_page_with_page_number", shortcut: "g" },
  { id: "next_page", shortcut: "PageDown · ↓ · → · j · l · J" },
  { id: "previous_page", shortcut: "PageUp · ↑ · ← · h · k · K" },
  { id: "goto_beginning", shortcut: "Home" },
  { id: "goto_end", shortcut: "End" },
  { id: "zoom_in", shortcut: "+" },
  { id: "zoom_out", shortcut: "-" },
  { id: "fit_to_page_width", shortcut: "=" },
  { id: "single_page_view", shortcut: "" },
  { id: "two_page_spread", shortcut: "" },
  { id: "fit_to_page", shortcut: "w" },
  { id: "fit_to_spread", shortcut: "F" },
  { id: "toggle_continuous_scrolling", shortcut: "", label: "Toggle continuous scrolling" },
  { id: "toggle_night_mode", shortcut: "i" },
];

export const EPUB_READER_COMMANDS: ReaderCommand[] = [
  { id: "open_document", shortcut: "o · Ctrl+O", scope: "epub", label: "Open document" },
  { id: "previous_chapter", shortcut: "Shift+N", scope: "epub", label: "Previous chapter" },
  { id: "next_chapter", shortcut: "n", scope: "epub", label: "Next chapter" },
  { id: "go_to_chapter", shortcut: "", scope: "epub", label: "Go to chapter" },
  { id: "paged_layout", shortcut: "", scope: "epub", label: "Paged layout" },
  { id: "continuous_layout", shortcut: "", scope: "epub", label: "Continuous layout" },
  { id: "close_document", shortcut: "", scope: "epub", label: "Close document" },
];

export function filterReaderCommands(
  query: string,
  hasDocument: boolean,
  readerKind: ReaderKind = "pdf",
  commandSet?: ReaderCommand[],
): ReaderCommand[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const commands = commandSet ?? (readerKind === "epub" ? EPUB_READER_COMMANDS : READER_COMMANDS);
  return commands.filter((command) =>
    (command.scope ?? "pdf") === readerKind &&
    (hasDocument || command.id === "open_document" || command.id === "toggle_night_mode") &&
    `${command.id} ${command.label ?? ""} ${command.shortcut}`.toLocaleLowerCase().includes(normalizedQuery),
  );
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
  executePaletteCommand: (command: ReaderCommand) => void;
  runCommand: (command: ReaderCommandId) => void;
  scrollContinuous?: (direction: -1 | 1, amount: "page" | "line") => void;
  scrollPdfContinuous?: (direction: PdfPanDirection) => void;
  isPdfZoomedIn?: () => boolean;
  panPdf?: (direction: PdfPanDirection) => boolean;
  panPdfPage?: (direction: -1 | 1) => boolean;
  scrollPdfToPageEdge?: (edge: "top" | "bottom") => void;
  setCommandQuery: (query: string) => void;
  setCommandIndex: Dispatch<SetStateAction<number>>;
  setOverlay: (overlay: ReaderOverlay) => void;
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
  zoomedIn: boolean,
): PdfNavigationAction | null {
  if (key === "J" || (shiftKey && key.toLowerCase() === "j")) return { kind: "navigate", direction: 1 };
  if (key === "K" || (shiftKey && key.toLowerCase() === "k")) return { kind: "navigate", direction: -1 };

  if (key === "PageDown") return zoomedIn ? { kind: "page-pan", direction: 1 } : { kind: "navigate", direction: 1 };
  if (key === "PageUp") return zoomedIn ? { kind: "page-pan", direction: -1 } : { kind: "navigate", direction: -1 };
  if (key === "Home") return { kind: "document-edge", edge: "top" };
  if (key === "End") return { kind: "document-edge", edge: "bottom" };

  const direction: PdfPanDirection | null =
    key === "ArrowLeft" || key.toLowerCase() === "h" ? "left" :
    key === "ArrowRight" || key.toLowerCase() === "l" ? "right" :
    key === "ArrowUp" || key.toLowerCase() === "k" ? "up" :
    key === "ArrowDown" || key.toLowerCase() === "j" ? "down" :
    null;
  if (!direction) return null;
  if (zoomedIn) return { kind: "pan", direction };
  return { kind: "navigate", direction: direction === "left" || direction === "up" ? -1 : 1 };
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


type RepeatNavigationAction =
  | { kind: "command"; command: ReaderCommandId }
  | { kind: "pdf-key"; key: string; shiftKey: boolean };

function performPdfNavigation(action: PdfNavigationAction, actions: ReaderKeyboardActions): void {
  switch (action.kind) {
    case "pan":
      if (!actions.panPdf?.(action.direction)) {
        actions.runCommand(action.direction === "right" || action.direction === "down" ? "next_page" : "previous_page");
      }
      break;
    case "page-pan":
      if (!actions.panPdfPage?.(action.direction)) {
        actions.runCommand(action.direction > 0 ? "next_page" : "previous_page");
      }
      break;
    case "navigate":
      actions.runCommand(action.direction > 0 ? "next_page" : "previous_page");
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
  const action = resolvePdfNavigationAction(key, shiftKey, actions.isPdfZoomedIn?.() ?? false);
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
          }
        }
        return;
      }
      if (overlay === "commands") {
        if (event.key === "ArrowDown" && commands.length) {
          event.preventDefault();
          setCommandIndex((index) => Math.min(index + 1, commands.length - 1));
        } else if (event.key === "ArrowUp" && commands.length) {
          event.preventDefault();
          setCommandIndex((index) => Math.max(index - 1, 0));
        } else if (event.key === "Enter") {
          event.preventDefault();
          const command = commands[commandIndex];
          if (command) executePaletteCommand(command);
        }
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
        if (key === "o") {
          event.preventDefault();
          runCommand("open_document");
          return;
        }
        if (key === "w") {
          event.preventDefault();
          runCommand("close_document");
          return;
        }
        if (key === "f") {
          event.preventDefault();
          runCommand("search");
          return;
        }
      }
      if (current.state.continuousScrolling && unmodified) {
        const action = resolveContinuousPdfNavigationAction(event.key, event.shiftKey);
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

      const zoomedIn = current.actions.isPdfZoomedIn?.() ?? false;
      const pdfNavigationAction = resolvePdfNavigationAction(event.key, event.shiftKey, zoomedIn);
      if (unmodified && pdfNavigationAction) {
        event.preventDefault();
        const code = event.code || event.key;
        const repeatAction: RepeatNavigationAction = {
          kind: "pdf-key",
          key: event.key,
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

      const zoomInKey = !modifier && !event.altKey && event.key === "+";
      const zoomOutKey = unmodified && (event.key === "-" || (!event.shiftKey && event.code === "Minus"));
      if (key === "i" && !event.shiftKey && !modifier && !event.altKey) {
        event.preventDefault();
        runCommand("toggle_night_mode");
      } else if (zoomInKey || zoomOutKey) {
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
