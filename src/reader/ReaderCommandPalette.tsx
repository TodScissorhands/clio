import { useId, useLayoutEffect, useRef } from "react";
import { clampCommandIndex } from "./interactions";
import type { ReaderCommand } from "./interactions";
import type { ReaderCommandStates } from "./commandState";

type ReaderCommandPaletteProps = {
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
  const listRef = useRef<HTMLDivElement>(null);
  const pointerSelectionRef = useRef(false);
  const chooserRef = useRef(placeholder);
  const listId = useId();
  const hintId = `${listId}-hint`;
  const activeIndex = clampCommandIndex(commandIndex, commands.length);
  const activeId = commands.length ? `${listId}-option-${activeIndex}` : undefined;

  useLayoutEffect(() => {
    if (commandIndex !== activeIndex) onCommandIndexChange(activeIndex);
  }, [activeIndex, commandIndex, onCommandIndexChange]);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    const input = inputRef.current;
    if (!dialog || !input) return;
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
      if (event.target !== input) input.focus({ preventScroll: true });
    };
    document.addEventListener("focusin", keepFilterFocus, true);
    input.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("focusin", keepFilterFocus, true);
      for (const { element, inert } of background) element.inert = inert;
    };
  }, []);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    if (chooserRef.current !== placeholder) {
      chooserRef.current = placeholder;
      pointerSelectionRef.current = false;
    }
    const revealActiveOption = () => {
      const option = list.querySelector<HTMLElement>('[aria-selected="true"]');
      if (!option) return;
      const row = option.getBoundingClientRect();
      const top = list.getBoundingClientRect().top + list.clientTop;
      const bottom = top + list.clientHeight;
      // An oversized wrapped row cannot fit; avoid oscillating between its edges.
      if (row.height > list.clientHeight) {
        if (row.top > top) list.scrollTop += row.top - top;
        else if (row.bottom < bottom) list.scrollTop += row.bottom - bottom;
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

  return (
    <div
      ref={dialogRef}
      className="command-palette"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      onKeyDownCapture={(event) => {
        if (event.key === "Tab") {
          event.preventDefault();
          inputRef.current?.focus({ preventScroll: true });
        } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          pointerSelectionRef.current = false;
        }
      }}
    >
      <input
        ref={inputRef}
        className="command-filter"
        role="combobox"
        aria-label={placeholder}
        aria-describedby={hintId}
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
      />
      <p id={hintId} className="command-hint">↑↓ Select · Enter Run · Escape Back to reader</p>
      <div ref={listRef} id={listId} className="command-list" role="listbox" aria-label={ariaLabel}>
        {commands.map((command, index) => {
          const state = command.state ?? commandStates?.[command.id];
          const rowId = `${listId}-option-${index}`;
          return <div
          key={command.key ?? command.id}
          id={rowId}
          role="option"
          aria-selected={activeIndex === index}
          aria-disabled={command.disabled || undefined}
          aria-labelledby={`${rowId}-label ${rowId}-shortcut`}
          aria-describedby={state ? `${rowId}-state` : undefined}
          className="command-row"
          style={command.depth ? { paddingLeft: 6 + command.depth * 14 } : undefined}
          onMouseMove={(event) => {
            // Scrolling/reflow can put another row under a stationary pointer.
            // Only actual pointer movement should override keyboard selection.
            if (!event.movementX && !event.movementY) return;
            pointerSelectionRef.current = true;
            onCommandIndexChange(index);
          }}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (command.disabled) return;
            onCommandIndexChange(index);
            onExecute(command);
          }}
        >
          <span className="command-content">
            <span id={`${rowId}-label`} className="command-label">{command.label ?? command.id}</span>
            {state && <span id={`${rowId}-state`} className="command-state">
              {state.active && <span className="command-state-mark" aria-hidden="true">✓</span>}
              <span className="command-state-text">{state.text}</span>
            </span>}
          </span>
          <span id={`${rowId}-shortcut`} className="command-shortcut">{command.shortcut}</span>
        </div>;
        })}
      </div>
      {!commands.length && <p className="command-empty" role="status">{emptyMessage}</p>}
    </div>
  );
}
