import { expect, test } from "bun:test";
import { commandAlias, commandLineMatches, moveIndex } from "../src/reader/clioIndex";
import type { ReaderCommand } from "../src/reader/interactions";
const commands: ReaderCommand[] = [
  { id: "open_document", shortcut: "" },
  { id: "search", shortcut: "", disabled: true },
  { id: "document_appearance", shortcut: "" },
  { id: "theme_gruvbox_dark", shortcut: "" },
];
test("Index movement wraps and skips disabled actions in either direction", () => {
  expect(moveIndex(commands, 0, 1)).toBe(2);
  expect(moveIndex(commands, 0, -1)).toBe(3);
  expect(moveIndex(commands, 3, 1)).toBe(0);
  expect(moveIndex(commands, 0, 2)).toBe(3);
  expect(moveIndex(commands.map(c => ({ ...c, disabled: true })), 2, 1)).toBe(0);
});
test("command aliases resolve exact commands before prefixes and expose ambiguity", () => {
  expect(commandLineMatches("theme", commands).map(c => c.id)).toEqual(["document_appearance"]);
  expect(commandLineMatches("th", commands)).toHaveLength(2);
  expect(commandLineMatches("theme gru", commands).map(c => c.id)).toEqual(["theme_gruvbox_dark"]);
  expect(commandLineMatches("invalid", commands)).toEqual([]);
  expect(commandAlias({ id: "continuous_layout", key: "index-layout", shortcut: "" })).toBe("layout");
});
