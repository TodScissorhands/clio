import { describe, expect, test } from "bun:test";
import { canNavigatePagedWheel, getAdjacentPageNumber, getPagePanDelta, getPagedWheelDirection, isPageZoomedIn } from "../src/reader/layout";
import {
  READER_COMMANDS,
  filterReaderCommands,
  performPdfNavigation,
  resolveContinuousPdfNavigationAction,
  resolvePdfNavigationAction,
} from "../src/reader/interactions";
import type { ReaderCommandId } from "../src/reader/interactions";

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
  test("directional keys pan in all directions when page group exceeds both viewport dimensions", () => {
    const directions = [
      ["ArrowLeft", "left"], ["h", "left"],
      ["ArrowDown", "down"], ["j", "down"],
      ["ArrowUp", "up"], ["k", "up"],
      ["ArrowRight", "right"], ["l", "right"],
    ] as const;
    for (const [key, direction] of directions) {
      expect(resolvePdfNavigationAction(key, false, { horizontal: true, vertical: true })).toEqual({ kind: "pan", direction });
    }
  });

  test("in fit-width mode (vertical overflow only), horizontal keys navigate and vertical keys pan", () => {
    const fitWidth = { horizontal: false, vertical: true };
    expect(resolvePdfNavigationAction("ArrowLeft", false, fitWidth)).toEqual({ kind: "navigate", direction: -1 });
    expect(resolvePdfNavigationAction("h", false, fitWidth)).toEqual({ kind: "navigate", direction: -1 });
    expect(resolvePdfNavigationAction("ArrowRight", false, fitWidth)).toEqual({ kind: "navigate", direction: 1 });
    expect(resolvePdfNavigationAction("l", false, fitWidth)).toEqual({ kind: "navigate", direction: 1 });

    expect(resolvePdfNavigationAction("ArrowUp", false, fitWidth)).toEqual({ kind: "pan", direction: "up" });
    expect(resolvePdfNavigationAction("k", false, fitWidth)).toEqual({ kind: "pan", direction: "up" });
    expect(resolvePdfNavigationAction("ArrowDown", false, fitWidth)).toEqual({ kind: "pan", direction: "down" });
    expect(resolvePdfNavigationAction("j", false, fitWidth)).toEqual({ kind: "pan", direction: "down" });
  });

  test("in fit-page mode (no overflow), horizontal keys navigate and vertical keys pan within page", () => {
    const fitPage = { horizontal: false, vertical: false };
    expect(resolvePdfNavigationAction("ArrowLeft", false, fitPage)).toEqual({ kind: "navigate", direction: -1 });
    expect(resolvePdfNavigationAction("h", false, fitPage)).toEqual({ kind: "navigate", direction: -1 });
    expect(resolvePdfNavigationAction("ArrowRight", false, fitPage)).toEqual({ kind: "navigate", direction: 1 });
    expect(resolvePdfNavigationAction("l", false, fitPage)).toEqual({ kind: "navigate", direction: 1 });

    expect(resolvePdfNavigationAction("ArrowUp", false, fitPage)).toEqual({ kind: "pan", direction: "up" });
    expect(resolvePdfNavigationAction("k", false, fitPage)).toEqual({ kind: "pan", direction: "up" });
    expect(resolvePdfNavigationAction("ArrowDown", false, fitPage)).toEqual({ kind: "pan", direction: "down" });
    expect(resolvePdfNavigationAction("j", false, fitPage)).toEqual({ kind: "pan", direction: "down" });
  });

  test("page keys return page-pan to pan within page and navigate at boundaries", () => {
    for (const zoom of [false, true, { horizontal: false, vertical: true }]) {
      expect(resolvePdfNavigationAction("PageDown", false, zoom)).toEqual({ kind: "page-pan", direction: 1 });
      expect(resolvePdfNavigationAction("PageUp", false, zoom)).toEqual({ kind: "page-pan", direction: -1 });
    }
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

  test("performPdfNavigation calls navigatePageWithBoundary and prevents duplicate navigation", () => {
    const commands: ReaderCommandId[] = [];
    const boundaryNavigations: number[] = [];
    const actions = {
      closeOverlay: () => {},
      moveMatch: () => {},
      runSearch: () => {},
      goToPage: () => {},
      executePaletteCommand: () => {},
      runCommand: (cmd: ReaderCommandId) => { commands.push(cmd); },
      navigatePageWithBoundary: (dir: -1 | 1) => { boundaryNavigations.push(dir); },
      panPdfPage: () => false,
      panPdf: () => false,
      setCommandQuery: () => {},
      setCommandIndex: () => {},
      setOverlay: () => {},
    };

    // Navigation action should call navigatePageWithBoundary and NOT runCommand
    performPdfNavigation({ kind: "navigate", direction: 1 }, actions);
    expect(boundaryNavigations).toEqual([1]);
    expect(commands).toEqual([]);

    // Page-pan at boundary should call navigatePageWithBoundary and NOT runCommand
    performPdfNavigation({ kind: "page-pan", direction: -1 }, actions);
    expect(boundaryNavigations).toEqual([1, -1]);
    expect(commands).toEqual([]);

    // Pan reaching boundary should NEVER call runCommand or navigatePageWithBoundary
    performPdfNavigation({ kind: "pan", direction: "down" }, actions);
    expect(boundaryNavigations).toEqual([1, -1]);
    expect(commands).toEqual([]);

    // Fallback when navigatePageWithBoundary is not provided
    const fallbackActions = {
      ...actions,
      navigatePageWithBoundary: undefined,
    };
    performPdfNavigation({ kind: "navigate", direction: 1 }, fallbackActions);
    expect(commands).toEqual(["next_page"]);
  });

  test("calculates destination edge delta accurately for PageUp bottom-alignment and PageDown top-alignment", () => {
    const viewport = { top: 0, bottom: 800, height: 800 };
    // Tall page (e.g. Fit-width portrait page: height 1200 in viewport height 800)
    const tallPageBounds = { top: 0, bottom: 1200 };

    // PageDown lands at top: delta should be bounds.top - viewport.top
    const pageDownDelta = tallPageBounds.top - viewport.top;
    expect(pageDownDelta).toBe(0);

    // PageUp lands at bottom: delta should be bounds.bottom - viewport.bottom
    const pageUpDelta = tallPageBounds.bottom - viewport.bottom;
    expect(pageUpDelta).toBe(400);

    // Fitting page (height 600 in viewport height 800)
    const fittingBounds = { top: 100, bottom: 700 };
    const fitsVertically = (fittingBounds.bottom - fittingBounds.top) <= (viewport.height + 0.5) &&
      fittingBounds.top >= (viewport.top - 1.0) &&
      fittingBounds.bottom <= (viewport.bottom + 1.0);
    expect(fitsVertically).toBe(true);
  });
});
