import { describe, expect, test } from "bun:test";
import { filterReaderCommands } from "../src/reader/interactions";
import type { ReaderCommand } from "../src/reader/interactions";

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
