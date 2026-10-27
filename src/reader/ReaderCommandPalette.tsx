import { useEffect, useRef } from "react";
import type { ReaderCommand } from "./interactions";

type ReaderCommandPaletteProps = {
  commands: ReaderCommand[];
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

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="command-palette" role="dialog" aria-modal="true" aria-label={ariaLabel}>
      <input
        ref={inputRef}
        className="command-filter"
        aria-label={placeholder}
        placeholder={placeholder}
        value={query}
        onChange={(event) => {
          onQueryChange(event.currentTarget.value);
          onCommandIndexChange(0);
        }}
      />
      <div className="command-list" role="listbox" aria-label={ariaLabel}>
        {commands.map((command, index) => <button
          key={command.key ?? command.id}
          type="button"
          role="option"
          aria-selected={commandIndex === index}
          className="command-row"
          style={command.depth ? { paddingLeft: 6 + command.depth * 14 } : undefined}
          onMouseEnter={() => onCommandIndexChange(index)}
          onClick={() => onExecute(command)}
        >
          <span>{command.label ?? command.id}</span>
          <span className="command-shortcut">{command.shortcut}</span>
        </button>)}
        {!commands.length && <p className="command-empty">{emptyMessage}</p>}
      </div>
    </div>
  );
}
