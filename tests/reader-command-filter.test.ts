import { describe, expect, test } from "bun:test";
import { EPUB_READER_COMMANDS, filterReaderCommands } from "../src/reader/interactions";
import type { ReaderCommand } from "../src/reader/interactions";
import { epubPreferenceCommands, searchableReaderCommands, themeCommands } from "../src/reader/appearanceCommands";
import { DEFAULT_EPUB_PREFERENCES } from "../src/epub/preferences";

describe("reader command discovery", () => {
  test.each([
    ["zoom in", "zoom_in"],
    ["  FIT   TO PAGE WIDTH  ", "fit_to_page_width"],
    ["next search match", "next_item"],
    ["zoom_in", "zoom_in"],
    ["goto_page_with_page_number", "goto_page_with_page_number"],
    ["Ctrl+O", "open_document"],
    ["Shift+Enter", "previous_item"],
  ])("%s finds %s without changing execution identifiers", (query, id) => {
    expect(filterReaderCommands(query, true).map((command) => command.id)).toContain(id);
  });

  test("no document and no matching commands keep unavailable actions out of results", () => {
    expect(filterReaderCommands("zoom in", false)).toEqual([]);
    expect(filterReaderCommands("not a reader command", true)).toEqual([]);
    expect(filterReaderCommands("Ctrl+O", false).map((command) => command.id)).toEqual(["open_document"]);
  });
});

describe("EPUB command discovery", () => {
  const themes = themeCommands("epub", "original");
  const preferences = epubPreferenceCommands(DEFAULT_EPUB_PREFERENCES, DEFAULT_EPUB_PREFERENCES);
  const discover = (query: string) => filterReaderCommands(query, true, "epub",
    searchableReaderCommands(EPUB_READER_COMMANDS, [themes, preferences], query));

  test("the root exposes appearance choosers and page navigation, not every appearance choice", () => {
    const root = discover("");
    expect(root.map((command) => command.id)).toEqual(expect.arrayContaining([
      "document_appearance", "epub_reading_preferences", "next_page", "previous_page",
    ]));
    expect(root.some((command) => command.id.startsWith("theme_") || command.id === "epub_set_font_family")).toBe(false);
    expect(discover("PageDown").map((command) => command.id)).toContain("next_page");
    expect(discover("PageUp").map((command) => command.id)).toContain("previous_page");
    expect(discover("Ctrl+O").map((command) => command.id)).toContain("open_document");
    expect(discover("Ctrl+W").map((command) => command.id)).toContain("close_document");
  });

  test("root searches find named themes and distinct preference values without Back rows", () => {
    expect(discover("gruvbox").map((command) => command.id)).toEqual(["theme_gruvbox_dark"]);
    expect(discover("theme_solarized_dark").map((command) => command.id)).toEqual(["theme_solarized_dark"]);
    expect(discover("Font: Serif").map((command) => command.value)).toEqual(["serif"]);
    expect(discover("epub_set_font_family").map((command) => command.value)).toEqual(["publisher", "serif", "sans"]);
    expect(discover("back")).toEqual([]);
    const matches = discover("publisher");
    expect(new Set(matches.map((command) => command.key ?? command.id)).size).toBe(matches.length);
  });

  test("chooser filtering stays local and setting descriptions are not search aliases", () => {
    expect(filterReaderCommands("gruvbox", true, "epub", preferences)).toEqual([]);
    expect(filterReaderCommands("font", true, "epub", themes)).toEqual([]);
    expect(discover("current")).toEqual([]);
    expect(discover("saved size")).toEqual([]);
  });
});

describe("chapter destination discovery", () => {
  const chapters: ReaderCommand[] = [
    { id: "select_chapter", scope: "epub", key: "opening", label: "Opening", targetHref: "text/start.xhtml", shortcut: "" },
    { id: "select_chapter", scope: "epub", key: "nested", label: "A selective history", targetHref: "text/history.xhtml#early", depth: 1, shortcut: "" },
    { id: "select_chapter", scope: "epub", key: "ending", label: "Ending", targetHref: "text/end.xhtml", shortcut: "" },
  ];

  test("matches titles and destination metadata, not the shared action identifier", () => {
    expect(filterReaderCommands("select", true, "epub", chapters)).toEqual([chapters[1]!]);
    expect(filterReaderCommands("select_chapter", true, "epub", chapters)).toEqual([]);
    expect(filterReaderCommands("history.xhtml", true, "epub", chapters)).toEqual([chapters[1]!]);
  });

  test("retains destination order and nesting while handling empty results", () => {
    expect(filterReaderCommands("ing", true, "epub", chapters)).toEqual([chapters[0]!, chapters[2]!]);
    expect(filterReaderCommands("  ", true, "epub", chapters)).toEqual(chapters);
    expect(filterReaderCommands("absent", true, "epub", chapters)).toEqual([]);
    expect(filterReaderCommands("", true, "epub", [])).toEqual([]);
  });
});
