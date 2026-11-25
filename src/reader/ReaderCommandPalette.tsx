import { usePaletteDrag } from "./usePaletteDrag";
import type { IndexMode } from "./clioIndex";
import { useId, useLayoutEffect, useRef } from "react";
import { clampCommandIndex } from "./interactions";
import type { ReaderCommand } from "./interactions";
import type { ReaderCommandStates } from "./commandState";

type ReaderCommandPaletteProps = {
  selectedKeys?: ReadonlySet<string>;
  feedback?: string;
  onInputMode?: (mode: "filter" | "command") => void;
  mode?: IndexMode;
  screen?: string;
  onBack?: () => void;
  onDismiss?: () => void;
  onVisibleRows?: (rows: number) => void;
  commands: ReaderCommand[];
  commandStates?: ReaderCommandStates;
  commandIndex: number;
  query: string;
  placeholder?: string;
  ariaLabel?: string;
  emptyMessage?: string;
  onQueryChange: (query: string) => void;
  onCommandIndexChange: (index: number) => void;
  onExecute: (command: ReaderCommand) => void;
};

export function ReaderCommandPalette({
  selectedKeys, feedback, onInputMode,
  mode = "filter", screen = "root", onBack, onDismiss, onVisibleRows,
  commands,
  commandStates,
  commandIndex,
  query,
  placeholder = "Filter commands",
  ariaLabel = "Reader commands",
  emptyMessage = "No commands",
  onQueryChange,
  onCommandIndexChange,
  onExecute,
}: ReaderCommandPaletteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const drag = usePaletteDrag(dialogRef, target => activateInput(target.dataset.promptActivation === "command" ? "command" : "filter"));
  const listRef = useRef<HTMLDivElement>(null);
  const pointerSelectionRef = useRef(false);
  const chooserRef = useRef(placeholder);
  const listId = useId();
  const scrollPositions = useRef(new Map<string, number>());
  const boundedIndex = clampCommandIndex(commandIndex, commands.length);
  const activeIndex = commands[boundedIndex]?.disabled ? Math.max(0, commands.findIndex(command => !command.disabled)) : boundedIndex;
  const activeId = commands[activeIndex] && !commands[activeIndex].disabled ? `${listId}-option-${activeIndex}` : undefined;

  useLayoutEffect(() => {
    if (commandIndex !== activeIndex) onCommandIndexChange(activeIndex);
  }, [activeIndex, commandIndex, onCommandIndexChange]);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    // Inert sibling branches, not ancestors: the palette can live inside either reader.
    const background: { element: HTMLElement; inert: boolean }[] = [];
    for (let branch: HTMLElement = dialog; branch.parentElement; branch = branch.parentElement) {
      for (const sibling of branch.parentElement.children) {
        if (sibling instanceof HTMLElement && sibling !== branch) {
          background.push({ element: sibling, inert: sibling.inert });
          sibling.inert = true;
        }
      }
      if (branch.parentElement === document.body) break;
    }
    const keepFilterFocus = (event: FocusEvent) => {
      if (!dialog.contains(event.target as Node)) (inputRef.current ?? listRef.current)?.focus({ preventScroll: true });
    };
    document.addEventListener("focusin", keepFilterFocus, true);
    return () => {
      document.removeEventListener("focusin", keepFilterFocus, true);
      for (const { element, inert } of background) element.inert = inert;
    };
  }, []);

  useLayoutEffect(() => { (inputRef.current ?? listRef.current)?.focus({ preventScroll: true }); }, [mode, screen]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    list.scrollTop = scrollPositions.current.get(screen) ?? 0;
  }, [screen]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    onVisibleRows?.(Math.max(1, Math.floor(list.clientHeight / 32)));
    if (chooserRef.current !== placeholder) {
      chooserRef.current = placeholder;
      pointerSelectionRef.current = false;
    }
    const revealActiveOption = () => {
      const option = list.querySelector<HTMLElement>('[data-focused="true"]');
      if (!option) return;
      const row = option.getBoundingClientRect();
      const top = list.getBoundingClientRect().top + list.clientTop;
      const bottom = top + list.clientHeight;
      // An oversized wrapped row cannot fit; avoid oscillating between its edges.
      if (row.height > list.clientHeight) {
        if (row.top > top + 1) list.scrollTop += Math.ceil(row.top - top);
        else if (row.bottom < bottom - 1) list.scrollTop += Math.floor(row.bottom - bottom);
      } else if (row.top < top) list.scrollTop -= Math.ceil(top - row.top);
      else if (row.bottom > bottom) list.scrollTop += Math.ceil(row.bottom - bottom);
    };
    if (!pointerSelectionRef.current) revealActiveOption();
    let width = list.clientWidth;
    let height = list.clientHeight;
    const observer = new ResizeObserver(() => {
      if (width === list.clientWidth && height === list.clientHeight) return;
      width = list.clientWidth;
      height = list.clientHeight;
      revealActiveOption();
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, [activeIndex, commands, placeholder]);

  const activateInput = (next: "filter" | "command") => {
    if (mode === "normal") { onQueryChange(""); onCommandIndexChange(0); onInputMode?.(next); }
    else inputRef.current?.focus({ preventScroll: true });
  };
  const promptKey = (event: React.KeyboardEvent, next: "filter" | "command") => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activateInput(next); }
  };
  return (
    <div className="command-dismiss" onPointerDown={(event) => { if (event.target === event.currentTarget) { event.preventDefault(); event.stopPropagation(); } }} onClick={(event) => { if (event.target === event.currentTarget) { event.preventDefault(); event.stopPropagation(); onDismiss?.(); } }}>
    <div
      ref={dialogRef}
      className="command-palette"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      onKeyDownCapture={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === "Tab") {
          event.preventDefault();
          const controls = [inputRef.current, listRef.current, ...Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('[data-prompt-activation][tabindex="0"], button') ?? [])].filter((node): node is HTMLElement => !!node);
          const current = controls.indexOf(document.activeElement as HTMLInputElement);
          const target = controls[(current + (event.shiftKey ? -1 : 1) + controls.length) % controls.length];
          (target ?? inputRef.current ?? listRef.current)?.focus({ preventScroll: true });
        } else if (["ArrowDown", "ArrowUp"].includes(event.key) || (event.target === listRef.current || mode === "normal") && ["j", "k", "g", "G", "d", "u"].includes(event.key) || event.ctrlKey && ["n", "p"].includes(event.key.toLowerCase())) {
          pointerSelectionRef.current = false;
        }
      }}
    >
      <div className="command-prompt" {...drag} onClick={event => { if (mode !== "normal" && event.target === event.currentTarget) inputRef.current?.focus({ preventScroll: true }); }}>
      {onBack && <button type="button" aria-label="Return to parent chooser" onClick={onBack}>‹</button>}
      <span className="command-prefix" data-prompt-activation="command" role="button" tabIndex={mode === "normal" ? 0 : -1} aria-label={mode === "normal" ? "Enter command mode" : "Focus command input"} onClick={() => activateInput("command")} onKeyDown={event => promptKey(event, "command")}>{mode === "filter" ? "/" : ":"}</span>
      {mode === "normal" ? <span className="command-context" data-prompt-activation="filter" role="button" tabIndex={0} aria-label="Filter reader commands" onClick={() => activateInput("filter")} onKeyDown={event => promptKey(event, "filter")}>{feedback || (screen === "root" || screen === "commands" ? "Clio Index" : ariaLabel)}</span> : <input
        ref={inputRef}
        className="command-filter"
        role="combobox"
        aria-label={placeholder}
        aria-autocomplete="list"
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={activeId}
        placeholder={placeholder}
        value={query}
        onChange={(event) => {
          pointerSelectionRef.current = false;
          onQueryChange(event.currentTarget.value);
          onCommandIndexChange(0);
        }}
      />}
      {selectedKeys && selectedKeys.size > 0 && <span className="command-selection-count" role="status">{selectedKeys.size} selected</span>}
      {feedback && <span className="visually-hidden" role="status">{feedback}</span>}
      </div>
      <div ref={listRef} id={listId} className="command-list" onScroll={event => { scrollPositions.current.set(screen, event.currentTarget.scrollTop); }} role="listbox" aria-multiselectable={selectedKeys ? true : undefined} tabIndex={0} aria-activedescendant={activeId} aria-label={ariaLabel}>
        {commands.map((command, index) => {
          const state = command.state ?? commandStates?.[command.id];
          const rowId = `${listId}-option-${index}`;
          return <div
          key={command.key ?? command.id}
          id={rowId}
          role="option"
          aria-selected={selectedKeys ? selectedKeys.has(command.key ?? command.id) : activeIndex === index && !command.disabled}
          data-focused={activeIndex === index && !command.disabled || undefined}
          aria-disabled={command.disabled || undefined}
          aria-labelledby={`${rowId}-label ${rowId}-shortcut`}
          aria-describedby={state ? `${rowId}-state` : undefined}
          className="command-row"
          data-applied={state?.active || undefined}
          style={command.depth ? { paddingLeft: 22 + Math.min(command.depth, 4) * 10 } : undefined}
          onMouseMove={(event) => {
            // Scrolling/reflow can put another row under a stationary pointer.
            // Only actual pointer movement should override keyboard selection.
            if (!event.movementX && !event.movementY) return;
            pointerSelectionRef.current = true;
            if (!command.disabled) onCommandIndexChange(index);
          }}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (command.disabled) return;
            onCommandIndexChange(index);
            onExecute(command);
          }}
        >
          <span className="command-content">
            <span id={`${rowId}-label`} className="command-label">{selectedKeys?.has(command.key ?? command.id) && <span aria-hidden="true">✓ </span>}{command.label ?? command.id}</span>
            {state && <span id={`${rowId}-state`} className="command-state">{state.active ? "Applied. " : ""}<span className="command-state-text">{state.text}</span></span>}
          </span>
          <span id={`${rowId}-shortcut`} className="command-shortcut">{state && !/^(Current|Not current)/.test(state.text) ? state.text.split(" — ")[0] : command.shortcut}</span>
        </div>;
        })}
      </div>
      {!commands.length && <p className="command-empty" role="status">{emptyMessage}</p>}
    </div>
    </div>
  );
}
