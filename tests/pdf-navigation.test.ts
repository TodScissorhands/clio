import { describe, expect, test } from "bun:test";
import { canNavigatePagedWheel, getAdjacentPageNumber, getPagePanDelta, getPagedWheelDirection, isPageZoomedIn } from "../src/reader/layout";
import { READER_COMMANDS, filterReaderCommands, resolveContinuousPdfNavigationAction, resolvePdfNavigationAction } from "../src/reader/interactions";

describe("PDF paged-mode wheel navigation", () => {
  test("maps vertical wheel direction and leaves native or modified scrolling alone", () => {
    expect(getPagedWheelDirection(20, false, false)).toBe(1);
    expect(getPagedWheelDirection(-20, false, false)).toBe(-1);
    expect(getPagedWheelDirection(0, false, false)).toBeNull();
    expect(getPagedWheelDirection(20, true, false)).toBeNull();
    expect(getPagedWheelDirection(-20, false, true)).toBeNull();
  });

  test("allows one turn per 150 ms and requires fresh wheel input", () => {
    expect(canNavigatePagedWheel(0, Number.NEGATIVE_INFINITY)).toBe(true);
    expect(canNavigatePagedWheel(149, 0)).toBe(false);
    expect(canNavigatePagedWheel(150, 0)).toBe(true);
    expect(canNavigatePagedWheel(1000, 800)).toBe(true);
  });
});

describe("PDF keyboard navigation", () => {
  test("directional keys pan when the current page group exceeds the viewport", () => {
    const directions = [
      ["ArrowLeft", "left"], ["h", "left"],
      ["ArrowDown", "down"], ["j", "down"],
      ["ArrowUp", "up"], ["k", "up"],
      ["ArrowRight", "right"], ["l", "right"],
    ] as const;
    for (const [key, direction] of directions) {
      expect(resolvePdfNavigationAction(key, false, true)).toEqual({ kind: "pan", direction });
    }
  });

  test("directional keys navigate pages when the page group fits", () => {
    const directions = [
      ["ArrowLeft", -1], ["h", -1], ["ArrowUp", -1], ["k", -1],
      ["ArrowRight", 1], ["l", 1], ["ArrowDown", 1], ["j", 1],
    ] as const;
    for (const [key, direction] of directions) {
      expect(resolvePdfNavigationAction(key, false, false)).toEqual({ kind: "navigate", direction });
    }
  });

  test("page keys pan to zoomed page boundaries and navigate when fitted", () => {
    expect(resolvePdfNavigationAction("PageDown", false, true)).toEqual({ kind: "page-pan", direction: 1 });
    expect(resolvePdfNavigationAction("PageUp", false, true)).toEqual({ kind: "page-pan", direction: -1 });
    expect(resolvePdfNavigationAction("PageDown", false, false)).toEqual({ kind: "navigate", direction: 1 });
    expect(resolvePdfNavigationAction("PageUp", false, false)).toEqual({ kind: "navigate", direction: -1 });
  });

  test("uppercase J and K always navigate; Home and End navigate document edges regardless of zoom", () => {
    for (const zoomedIn of [false, true]) {
      expect(resolvePdfNavigationAction("J", true, zoomedIn)).toEqual({ kind: "navigate", direction: 1 });
      expect(resolvePdfNavigationAction("K", true, zoomedIn)).toEqual({ kind: "navigate", direction: -1 });
      expect(resolvePdfNavigationAction("Home", false, zoomedIn)).toEqual({ kind: "document-edge", edge: "top" });
      expect(resolvePdfNavigationAction("End", false, zoomedIn)).toEqual({ kind: "document-edge", edge: "bottom" });
    }
    expect(resolvePdfNavigationAction("x", false, false)).toBeNull();
  });

  test("command palette shortcut mappings match required bindings", () => {
    const byId = new Map(READER_COMMANDS.map((cmd) => [cmd.id, cmd.shortcut]));
    expect(byId.get("fit_to_page")).toBe("w");
    expect(byId.get("fit_to_page_width")).toBe("=");
    expect(byId.get("zoom_in")).toBe("+");
    expect(byId.get("zoom_out")).toBe("-");
    expect(byId.get("search")).toBe("/ · Ctrl+F");
    expect(byId.get("open_document")).toBe("Ctrl+O");
    expect(byId.get("close_document")).toBe("Ctrl+W");
    expect(byId.get("goto_beginning")).toBe("Home");
    expect(byId.get("goto_end")).toBe("End");
  });

  test("continuous mode scrolls with hjkl and leaves browser-scrolling keys native", () => {
    const directions = [
      ["h", "left"], ["j", "down"], ["k", "up"], ["l", "right"],
    ] as const;
    for (const [key, direction] of directions) {
      expect(resolveContinuousPdfNavigationAction(key, false)).toEqual({ kind: "scroll", direction });
    }
    for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown"]) {
      expect(resolveContinuousPdfNavigationAction(key, false)).toEqual({ kind: "native" });
    }
    expect(resolveContinuousPdfNavigationAction("J", true)).toEqual({ kind: "navigate", direction: 1 });
    expect(resolveContinuousPdfNavigationAction("K", true)).toEqual({ kind: "navigate", direction: -1 });
    expect(resolveContinuousPdfNavigationAction("Home", false)).toBeNull();
  });

  test("continuous scrolling toggle is PDF-only and available for open documents", () => {
    const command = filterReaderCommands("", true).find(({ id }) => id === "toggle_continuous_scrolling");
    expect(command?.label).toBe("Toggle continuous scrolling");
    expect(filterReaderCommands("", false).some(({ id }) => id === "toggle_continuous_scrolling")).toBe(false);
    expect(filterReaderCommands("", true, "epub").some(({ id }) => id === "toggle_continuous_scrolling")).toBe(false);
  });

  test("zoom detection uses rendered page bounds and the usable viewport", () => {
    const viewport = { width: 612, height: 792 };
    expect(isPageZoomedIn(viewport, viewport)).toBe(false);
    expect(isPageZoomedIn({ width: 612, height: 1100 }, viewport)).toBe(true);
    expect(isPageZoomedIn({ width: 1224, height: 792 }, viewport)).toBe(true);
  });

  test("vertical page pans stop exactly at the current page boundary", () => {
    expect(getPagePanDelta(0, 1600, 0, 800, 1, 680)).toBe(680);
    expect(getPagePanDelta(0, 1600, 680, 1480, 1, 680)).toBe(120);
    expect(getPagePanDelta(0, 1600, 800, 1600, 1, 680)).toBe(0);
    expect(getPagePanDelta(0, 1600, 800, 1600, -1, 680)).toBe(-680);
    expect(getPagePanDelta(0, 1600, 0, 800, -1, 680)).toBe(0);
  });

  test("spread navigation advances and clamps by the page pairs PDF.js displays", () => {
    expect(getAdjacentPageNumber(1, -1, 5, "spread")).toBe(1);
    expect(getAdjacentPageNumber(1, 1, 5, "spread")).toBe(3);
    expect(getAdjacentPageNumber(2, 1, 5, "spread")).toBe(3);
    expect(getAdjacentPageNumber(3, -1, 5, "spread")).toBe(1);
    expect(getAdjacentPageNumber(5, 1, 5, "spread")).toBe(5);
    expect(getAdjacentPageNumber(1, -1, 3, "single")).toBe(1);
    expect(getAdjacentPageNumber(3, 1, 3, "single")).toBe(3);
  });
});
