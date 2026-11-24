import type { Dispatch, SetStateAction } from "react";
import { useRef, useState } from "react";
import type { ReaderCommand } from "./interactions";

export type IndexMode = "normal" | "filter" | "command";
export function commandAlias(command: ReaderCommand): string {
  const aliases: Record<string, string> = {
    open_document: "open", close_document: "close", search: "search", go_to_chapter: "chapter",
    goto_page_with_page_number: "page", document_appearance: "theme", epub_reading_preferences: "typography",
    fit_to_page_width: "fit width",
  };
  if (command.key === "index-layout") return "layout";
  if (command.key === "index-page-layout") return "page layout";
  if (command.id.startsWith("theme_")) return `theme ${command.id.slice(6).replace(/_/g, " ").replace(/ dark$/, "")}`;
  return aliases[command.id] ?? command.id.replace(/_/g, " ");
}
export function commandLineMatches(query: string, catalog: ReaderCommand[]): ReaderCommand[] {
  const text = query.trim().toLowerCase().replace(/\s+/g, " ");
  const exact = catalog.filter(command => commandAlias(command) === text);
  return exact.length ? exact : catalog.filter(command => commandAlias(command).startsWith(text));
}
export function moveIndex(commands: ReaderCommand[], index: number, distance: number): number {
  const enabled = commands.flatMap((command, i) => command.disabled ? [] : [i]);
  if (!enabled.length) return 0;
  const current = enabled.indexOf(index);
  return enabled[((current < 0 ? (distance > 0 ? -1 : 0) : current) + distance % enabled.length + enabled.length) % enabled.length]!;
}
export function useClioIndex() {
  const [mode, setMode] = useState<IndexMode>("normal");
  const pendingG = useRef(false);
  const history = useRef<{ screen: string; query: string; index: number; mode: IndexMode }[]>([]);
  const visibleRows = useRef(6);
  const selectedExplicitly = useRef(false);
  const reset = () => { setMode("normal"); pendingG.current = false; history.current = []; selectedExplicitly.current = false; };
  const key = (event: KeyboardEvent, commands: ReaderCommand[], index: number, query: string,
    setQuery: (value: string) => void, setIndex: Dispatch<SetStateAction<number>>,
    execute: (command: ReaderCommand) => void, back: (closeRoot?: boolean) => void) => {
    if (event.target instanceof HTMLElement && event.target.closest("button") && ["Enter", " "].includes(event.key)) return;
    const normal = mode === "normal";
    const ctrl = event.ctrlKey && !event.altKey && !event.metaKey;
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
    const previousG = pendingG.current;
    pendingG.current = false;
    const move = (distance: number) => { setIndex(current => moveIndex(commands, current, distance)); selectedExplicitly.current = true; };
    let handled = true;
    if (event.key === "Escape") {
      if (!normal) { setMode("normal"); setQuery(""); selectedExplicitly.current = false; }
      else back(true);
    } else if (plain && (event.key === "ArrowDown" || normal && event.key === "j") || !normal && ctrl && event.key.toLowerCase() === "n") move(1);
    else if (plain && (event.key === "ArrowUp" || normal && event.key === "k") || !normal && ctrl && event.key.toLowerCase() === "p") move(-1);
    else if (normal && plain && event.key === "g") {
      if (previousG && !event.repeat) setIndex(commands.findIndex(command => !command.disabled));
      else pendingG.current = !event.repeat;
    } else if (normal && plain && event.key === "G") setIndex(commands.reduce((last, command, i) => command.disabled ? last : i, 0));
    else if (normal && ctrl && ["d", "u"].includes(event.key.toLowerCase())) move(Math.max(1, Math.floor(visibleRows.current / 2)) * (event.key.toLowerCase() === "d" ? 1 : -1));
    else if (normal && plain && ["h", "ArrowLeft"].includes(event.key)) back(false);
    else if (normal && plain && ["/", ":"].includes(event.key)) { setMode(event.key === "/" ? "filter" : "command"); setQuery(""); setIndex(0); selectedExplicitly.current = false; }
    else if (plain && event.key === "Enter" || normal && plain && ["l", "ArrowRight"].includes(event.key)) {
      const command = commands[index];
      const chooser = command && ["document_appearance", "pdf_advanced_appearance", "epub_reading_preferences", "epub_preference_field", "go_to_chapter"].includes(command.id) || command?.key === "index-page-layout";
      if (command && !command.disabled && (event.key === "Enter" || chooser) && (mode !== "command" || commands.length === 1 || selectedExplicitly.current)) execute(command);
    } else if (mode === "command" && event.key === "Tab") {
      const names = commands.map(commandAlias);
      let prefix = names[0] ?? query;
      for (const name of names) while (!name.startsWith(prefix)) prefix = prefix.slice(0, -1);
      setQuery(prefix); selectedExplicitly.current = false;
    } else handled = false;
    if (handled) event.preventDefault();
  };
  return { mode, setMode, reset, clearSequence: () => { pendingG.current = false; }, key, history, visibleRows, selectedExplicitly };
}
