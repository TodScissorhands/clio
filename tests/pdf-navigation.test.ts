import { describe, expect, test } from "bun:test";
import {
  createPagedWheelState,
  createWheelZoomState,
  getAdjacentPageNumber,
  getNextZoomFactor,
  getPagePanDelta,
  getPagedWheelAction,
  getWheelZoomDirection,
  isPageZoomedIn,
} from "../src/reader/layout";
import {
  filterReaderCommands,
  performPdfNavigation,
  resolveContinuousPdfNavigationAction,
  resolvePdfNavigationAction,
  resolvePdfControlCommand,
} from "../src/reader/interactions";
import type { ReaderCommandId } from "../src/reader/interactions";

// These deterministic helper regressions are not proof of physical touchpad behavior.
describe("PDF paged-mode wheel navigation", () => {
  const viewport = { width: 1000, height: 800 };
  const fittedGroup = { width: 900, height: 700 };
  const input = (deltaY: number, now: number, overrides: Partial<Parameters<typeof getPagedWheelAction>[1]> = {}) => ({
    deltaX: 0,
    deltaY,
    deltaMode: 0,
    now,
    continuousScrolling: false,
    modified: false,
    blocked: false,
    ...overrides,
  });

  test("deliberate vertical input requests one next or previous group", () => {
    expect(getPagedWheelAction(createPagedWheelState(), input(48, 0), fittedGroup, viewport)).toBe(1);
    expect(getPagedWheelAction(createPagedWheelState(), input(-48, 0), fittedGroup, viewport)).toBe(-1);
  });

  test("fractional pixel input accumulates to 48 CSS pixels instead of turning per event", () => {
    for (const direction of [-1, 1]) {
      const state = createPagedWheelState();
      for (let event = 0; event < 95; event++) {
        expect(getPagedWheelAction(state, input(direction * 0.5, event), fittedGroup, viewport)).toBe(0);
      }
      expect(getPagedWheelAction(state, input(direction * 0.5, 95), fittedGroup, viewport)).toBe(direction);
    }
  });

  test("a sustained burst turns only once even well beyond the former 150 ms throttle", () => {
    const state = createPagedWheelState();
    expect(getPagedWheelAction(state, input(120, 0), fittedGroup, viewport)).toBe(1);
    for (const now of [100, 200, 300, 400, 500, 600, 700, 800]) {
      expect(getPagedWheelAction(state, input(120, now), fittedGroup, viewport)).toBe(0);
    }
  });

  test("the 250 ms quiet interval is measured from the most recent event, not the turn", () => {
    const state = createPagedWheelState();
    expect(getPagedWheelAction(state, input(48, 0), fittedGroup, viewport)).toBe(1);
    for (const now of [200, 400, 649, 898]) {
      expect(getPagedWheelAction(state, input(48, now), fittedGroup, viewport)).toBe(0);
    }
    expect(getPagedWheelAction(state, input(-48, 1148), fittedGroup, viewport)).toBe(-1);
  });

  test("idle also discards unfinished accumulation", () => {
    const state = createPagedWheelState();
    expect(getPagedWheelAction(state, input(32, 0), fittedGroup, viewport)).toBe(0);
    expect(getPagedWheelAction(state, input(16, 250), fittedGroup, viewport)).toBe(0);
    expect(getPagedWheelAction(state, input(32, 251), fittedGroup, viewport)).toBe(1);
  });

  test("reversing before a turn starts fresh accumulation in the new direction", () => {
    const state = createPagedWheelState();
    expect(getPagedWheelAction(state, input(32, 0), fittedGroup, viewport)).toBe(0);
    expect(getPagedWheelAction(state, input(-16, 1), fittedGroup, viewport)).toBe(0);
    expect(getPagedWheelAction(state, input(-31.5, 2), fittedGroup, viewport)).toBe(0);
    expect(getPagedWheelAction(state, input(-0.5, 3), fittedGroup, viewport)).toBe(-1);
    expect(getPagedWheelAction(state, input(120, 4), fittedGroup, viewport)).toBe(0);
  });

  test("alternating subpixel jitter cannot build a turn", () => {
    const state = createPagedWheelState();
    for (let event = 0; event < 200; event++) {
      expect(getPagedWheelAction(state, input(event % 2 ? -0.5 : 0.5, event), fittedGroup, viewport)).toBe(0);
    }
  });

  test("pixel deltas stay unchanged and line deltas use 16 CSS pixels on both axes", () => {
    for (const deltaMode of [0, 1]) {
      const unit = deltaMode === 1 ? 16 : 1;
      const state = createPagedWheelState();
      expect(getPagedWheelAction(state, input(16 / unit, 0, { deltaX: 8 / unit, deltaMode }), fittedGroup, viewport)).toBe(0);
      expect(getPagedWheelAction(state, input(32 / unit, 1, { deltaX: 16 / unit, deltaMode }), fittedGroup, viewport)).toBe(1);
      expect(getPagedWheelAction(createPagedWheelState(), input(-48 / unit, 0, { deltaX: 32 / unit, deltaMode }), fittedGroup, viewport)).toBe(-1);
      expect(getPagedWheelAction(createPagedWheelState(), input(48 / unit, 0, { deltaX: 64 / unit, deltaMode }), fittedGroup, viewport)).toBeNull();
    }
  });

  test("page deltas use the viewport dimension for each axis before comparing dominance", () => {
    expect(getPagedWheelAction(createPagedWheelState(), input(0.06, 0, { deltaX: 0.04, deltaMode: 2 }), fittedGroup, viewport)).toBe(1);
    expect(getPagedWheelAction(createPagedWheelState(), input(-0.06, 0, { deltaMode: 2 }), fittedGroup, viewport)).toBe(-1);
    // Raw Y exceeds X, but normalized X=50 exceeds normalized Y=48.
    expect(getPagedWheelAction(createPagedWheelState(), input(0.06, 0, { deltaX: 0.05, deltaMode: 2 }), fittedGroup, viewport)).toBeNull();
    // Raw X exceeds Y, but normalized Y=50 exceeds normalized X=42.
    expect(getPagedWheelAction(createPagedWheelState(), input(0.05, 0, { deltaX: 0.07, deltaMode: 2 }), { width: 500, height: 900 }, { width: 600, height: 1000 })).toBe(1);
  });

  test("horizontal, equal-axis, and zero input stay native and clear pending distance", () => {
    for (const [deltaX, deltaY] of [[80, 0], [80, 48], [48, 48], [0, 0]] as const) {
      const state = createPagedWheelState();
      expect(getPagedWheelAction(state, input(32, 0), fittedGroup, viewport)).toBe(0);
      expect(getPagedWheelAction(state, input(deltaY, 1, { deltaX }), fittedGroup, viewport)).toBeNull();
      expect(getPagedWheelAction(state, input(16, 2), fittedGroup, viewport)).toBe(0);
      expect(getPagedWheelAction(state, input(32, 3), fittedGroup, viewport)).toBe(1);
    }
  });

  test("horizontal input keeps an already-turned burst latched until it becomes quiet", () => {
    const state = createPagedWheelState();
    expect(getPagedWheelAction(state, input(48, 0), fittedGroup, viewport)).toBe(1);
    expect(getPagedWheelAction(state, input(0, 240, { deltaX: 80 }), fittedGroup, viewport)).toBeNull();
    expect(getPagedWheelAction(state, input(-48, 480), fittedGroup, viewport)).toBe(0);
    expect(getPagedWheelAction(state, input(0, 720, { deltaX: -80 }), fittedGroup, viewport)).toBeNull();
    expect(getPagedWheelAction(state, input(48, 969), fittedGroup, viewport)).toBe(0);
    expect(getPagedWheelAction(state, input(48, 1219), fittedGroup, viewport)).toBe(1);
  });

  test("overflow on either axis leaves native scrolling, including clipped spreads at document edges", () => {
    for (const [pageNumber, direction] of [[1, -1], [5, 1]] as const) {
      expect(getAdjacentPageNumber(pageNumber, direction, 5, "spread")).toBe(pageNumber);
      for (const group of [
        { width: 900, height: 1200 },
        { width: 1200, height: 700 },
        { width: 1404, height: 900 },
      ]) {
        expect(getPagedWheelAction(createPagedWheelState(), input(direction * 120, 0), group, viewport)).toBeNull();
      }
    }
  });

  test("fitting tolerates half a CSS pixel, but larger overflow on either axis stays native", () => {
    expect(getPagedWheelAction(createPagedWheelState(), input(48, 0), { width: 1000.5, height: 800.5 }, viewport)).toBe(1);
    for (const group of [{ width: 1000.51, height: 700 }, { width: 900, height: 800.51 }]) {
      expect(getPagedWheelAction(createPagedWheelState(), input(48, 0), group, viewport)).toBeNull();
    }
  });

  test("mode, modifier, and blocked exclusions clear both pending distance and a turned latch", () => {
    for (const exclusion of [{ continuousScrolling: true }, { modified: true }, { blocked: true }]) {
      const pending = createPagedWheelState();
      expect(getPagedWheelAction(pending, input(32, 0), fittedGroup, viewport)).toBe(0);
      expect(getPagedWheelAction(pending, input(120, 1, exclusion), fittedGroup, viewport)).toBeNull();
      expect(getPagedWheelAction(pending, input(16, 2), fittedGroup, viewport)).toBe(0);
      expect(getPagedWheelAction(pending, input(32, 3), fittedGroup, viewport)).toBe(1);

      const turned = createPagedWheelState();
      expect(getPagedWheelAction(turned, input(48, 0), fittedGroup, viewport)).toBe(1);
      expect(getPagedWheelAction(turned, input(120, 1, exclusion), fittedGroup, viewport)).toBeNull();
      expect(getPagedWheelAction(turned, input(-48, 2), fittedGroup, viewport)).toBe(-1);
    }
  });

  test("nonfinite deltas and unsupported delta modes remain native without carrying distance", () => {
    for (const invalid of [
      { deltaX: Number.NaN }, { deltaX: Number.POSITIVE_INFINITY },
      { deltaY: Number.NaN }, { deltaY: Number.NEGATIVE_INFINITY },
      { deltaMode: -1 }, { deltaMode: 3 }, { deltaMode: 0.5 }, { deltaMode: Number.NaN },
    ]) {
      const state = createPagedWheelState();
      expect(getPagedWheelAction(state, input(32, 0), fittedGroup, viewport)).toBe(0);
      expect(getPagedWheelAction(state, input(48, 1, invalid), fittedGroup, viewport)).toBeNull();
      expect(getPagedWheelAction(state, input(16, 2), fittedGroup, viewport)).toBe(0);
      expect(getPagedWheelAction(state, input(32, 3), fittedGroup, viewport)).toBe(1);
    }
  });

  test("current group and viewport geometry determine fit, without leaking native-scroll carry", () => {
    const state = createPagedWheelState();
    expect(getPagedWheelAction(state, input(32, 0), fittedGroup, viewport)).toBe(0);
    expect(getPagedWheelAction(state, input(120, 1), { width: 1200, height: 700 }, viewport)).toBeNull();
    expect(getPagedWheelAction(state, input(16, 2), fittedGroup, viewport)).toBe(0);
    expect(getPagedWheelAction(state, input(32, 3), fittedGroup, viewport)).toBe(1);
    expect(getPagedWheelAction(state, input(120, 4), fittedGroup, { width: 800, height: 600 })).toBeNull();
    expect(getPagedWheelAction(state, input(-48, 5), fittedGroup, viewport)).toBe(-1);
  });

  test("a wheel turn uses logical spread adjacency, clamps at edges, and remains latched across groups", () => {
    const state = createPagedWheelState();
    let page = 1;
    const navigate = (deltaY: number, now: number) => {
      const action = getPagedWheelAction(state, input(deltaY, now), fittedGroup, viewport);
      if (action !== null && action !== 0) page = getAdjacentPageNumber(page, action, 5, "spread");
      return action;
    };
    expect(navigate(48, 0)).toBe(1);
    expect(page).toBe(3);
    expect(navigate(120, 100)).toBe(0);
    expect(page).toBe(3);
    expect(navigate(48, 350)).toBe(1);
    expect(page).toBe(5);
    expect(navigate(48, 600)).toBe(1);
    expect(page).toBe(5);
    expect(navigate(-48, 850)).toBe(-1);
    expect(page).toBe(3);
    expect(navigate(-48, 1100)).toBe(-1);
    expect(page).toBe(1);
    expect(navigate(-48, 1350)).toBe(-1);
    expect(page).toBe(1);
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

});

describe("conventional PDF Control shortcuts", () => {
  const control = (
    key: string,
    code = key,
    modifiers: Partial<Parameters<typeof resolvePdfControlCommand>[0]> = {},
  ) => ({ key, code, ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, ...modifiers });

  test("Ctrl page navigation moves one single page or logical spread and clamps at document edges", () => {
    for (const mode of ["single", "spread"] as const) {
      const next = resolvePdfControlCommand(control("PageDown"));
      const previous = resolvePdfControlCommand(control("PageUp"));
      expect(next).toBe("next_page");
      expect(previous).toBe("previous_page");
      const step = mode === "spread" ? 2 : 1;
      const forward = getAdjacentPageNumber(1, next === "next_page" ? 1 : -1, 5, mode);
      expect(forward).toBe(1 + step);
      expect(getAdjacentPageNumber(forward, previous === "previous_page" ? -1 : 1, 5, mode)).toBe(1);
      expect(getAdjacentPageNumber(1, -1, 5, mode)).toBe(1);
      expect(getAdjacentPageNumber(5, 1, 5, mode)).toBe(5);
    }
  });

  test("Ctrl document edges reuse the beginning and end commands", () => {
    expect(resolvePdfControlCommand(control("Home"))).toBe("goto_beginning");
    expect(resolvePdfControlCommand(control("End"))).toBe("goto_end");
  });

  test("Ctrl zoom-in accepts character, Shift+equals, equals alias, and numpad representations", () => {
    for (const event of [
      control("+", "Equal", { shiftKey: true }),
      control("+", "BracketRight"),
      control("=", "Equal", { shiftKey: true }),
      control("=", "Equal"),
      control("Unidentified", "Equal", { shiftKey: true }),
      control("", "Equal"),
      control("+", "NumpadAdd"),
      control("Add", "NumpadAdd"),
      control("Unidentified", "NumpadAdd"),
      control("Add", ""),
    ]) {
      expect(resolvePdfControlCommand(event)).toBe("zoom_in");
    }
  });

  test("Ctrl zoom-out accepts minus characters and numpad representations", () => {
    for (const event of [
      control("-", "Minus"),
      control("-", "Slash"),
      control("Unidentified", "Minus"),
      control("-", "NumpadSubtract"),
      control("Subtract", "NumpadSubtract"),
      control("Unidentified", "NumpadSubtract"),
      control("Subtract", ""),
    ]) {
      expect(resolvePdfControlCommand(event)).toBe("zoom_out");
    }
  });

  test("unmodified and unrelated modifier combinations are not claimed as Control shortcuts", () => {
    for (const key of ["PageDown", "PageUp", "Home", "End", "+", "=", "-", "ArrowRight", "j", "J", "o", "w", "f"]) {
      expect(resolvePdfControlCommand(control(key, key, { ctrlKey: false }))).toBeNull();
      expect(resolvePdfControlCommand(control(key, key, { altKey: true }))).toBeNull();
      expect(resolvePdfControlCommand(control(key, key, { metaKey: true }))).toBeNull();
      expect(resolvePdfControlCommand(control(key, key, { ctrlKey: false, metaKey: true }))).toBeNull();
    }
    for (const key of ["PageDown", "PageUp", "Home", "End", "-", "_"]) {
      expect(resolvePdfControlCommand(control(key, key, { shiftKey: true }))).toBeNull();
    }
    for (const key of ["ArrowLeft", "ArrowRight", "j", "k", "J", "K", "o", "w", "f", "0"]) {
      expect(resolvePdfControlCommand(control(key))).toBeNull();
    }
    expect(resolvePdfControlCommand(control("Dead", "Equal", { shiftKey: true }))).toBeNull();
    expect(resolvePdfControlCommand(control("_", "Minus", { shiftKey: true }))).toBeNull();
  });
});

describe("PDF Control-wheel zoom", () => {
  const pageHeight = 800;
  const input = (deltaY: number, now: number, deltaMode = 0) => ({ deltaY, now, deltaMode });

  test("up zooms in and down zooms out at the 48 CSS pixel threshold", () => {
    expect(getWheelZoomDirection(createWheelZoomState(), input(-48, 0), pageHeight)).toBe(1);
    expect(getWheelZoomDirection(createWheelZoomState(), input(48, 0), pageHeight)).toBe(-1);
  });

  test("pixel, 16-pixel line, and viewport-height page units accumulate equivalently", () => {
    for (const height of [800, 1200]) {
      for (const [deltaMode, unit] of [[0, 1], [1, 16], [2, height]]) {
        for (const sign of [-1, 1]) {
          const state = createWheelZoomState();
          expect(getWheelZoomDirection(state, input(sign * 16 / unit, 0, deltaMode), height)).toBe(0);
          expect(getWheelZoomDirection(state, input(sign * 32 / unit, 1, deltaMode), height)).toBe(-sign);
        }
      }
    }
  });

  test("tiny fractional deltas accumulate without zooming once per event", () => {
    for (const sign of [-1, 1]) {
      const state = createWheelZoomState();
      for (let event = 0; event < 95; event++) {
        expect(getWheelZoomDirection(state, input(sign * 0.5, event), pageHeight)).toBe(0);
      }
      expect(getWheelZoomDirection(state, input(sign * 0.5, 95), pageHeight)).toBe(-sign);
    }
  });

  test("a sustained stream can produce repeated steps without a page-turn latch", () => {
    for (const sign of [-1, 1]) {
      const state = createWheelZoomState();
      for (const now of [0, 1, 10, 199, 398]) {
        expect(getWheelZoomDirection(state, input(sign * 48, now), pageHeight)).toBe(-sign);
      }
      expect(getWheelZoomDirection(state, input(-sign * 48, 399), pageHeight)).toBe(sign);
    }
  });

  test("one huge event produces only one step and discards all overshoot", () => {
    for (const sign of [-1, 1]) {
      const state = createWheelZoomState();
      expect(getWheelZoomDirection(state, input(sign * 1_000_000, 0), pageHeight)).toBe(-sign);
      expect(getWheelZoomDirection(state, input(sign, 1), pageHeight)).toBe(0);
      expect(getWheelZoomDirection(state, input(sign * 46.5, 2), pageHeight)).toBe(0);
      expect(getWheelZoomDirection(state, input(sign * 0.5, 3), pageHeight)).toBe(-sign);
    }
  });

  test("reversal discards unfinished opposite motion", () => {
    for (const sign of [-1, 1]) {
      const state = createWheelZoomState();
      expect(getWheelZoomDirection(state, input(sign * 32, 0), pageHeight)).toBe(0);
      expect(getWheelZoomDirection(state, input(-sign * 16, 1), pageHeight)).toBe(0);
      expect(getWheelZoomDirection(state, input(-sign * 31.5, 2), pageHeight)).toBe(0);
      expect(getWheelZoomDirection(state, input(-sign * 0.5, 3), pageHeight)).toBe(sign);
    }
  });

  test("valid zero vertical input is owned but clears unfinished distance", () => {
    for (const deltaMode of [0, 1, 2]) {
      for (const zero of [0, -0]) {
        const state = createWheelZoomState();
        expect(getWheelZoomDirection(state, input(32, 0), pageHeight)).toBe(0);
        expect(getWheelZoomDirection(state, input(zero, 1, deltaMode), pageHeight)).toBe(0);
        expect(getWheelZoomDirection(state, input(16, 2), pageHeight)).toBe(0);
        expect(getWheelZoomDirection(state, input(32, 3), pageHeight)).toBe(-1);
      }
    }
  });

  test("199 ms preserves unfinished distance but 200 ms of idle discards it", () => {
    for (const sign of [-1, 1]) {
      const active = createWheelZoomState();
      expect(getWheelZoomDirection(active, input(sign * 32, 0), pageHeight)).toBe(0);
      expect(getWheelZoomDirection(active, input(sign * 16, 199), pageHeight)).toBe(-sign);

      const idle = createWheelZoomState();
      expect(getWheelZoomDirection(idle, input(sign * 32, 0), pageHeight)).toBe(0);
      expect(getWheelZoomDirection(idle, input(sign * 16, 200), pageHeight)).toBe(0);
      expect(getWheelZoomDirection(idle, input(sign * 32, 201), pageHeight)).toBe(-sign);
    }
  });

  test("nonfinite deltas and unsupported modes are unowned and reset accumulation", () => {
    for (const invalid of [
      { deltaY: Number.NaN },
      { deltaY: Number.POSITIVE_INFINITY },
      { deltaY: Number.NEGATIVE_INFINITY },
      { deltaMode: -1 },
      { deltaMode: 3 },
      { deltaMode: 0.5 },
      { deltaMode: Number.NaN },
      { deltaMode: Number.POSITIVE_INFINITY },
      { deltaMode: Number.NEGATIVE_INFINITY },
    ]) {
      const state = createWheelZoomState();
      expect(getWheelZoomDirection(state, input(32, 0), pageHeight)).toBe(0);
      expect(getWheelZoomDirection(state, { ...input(48, 1), ...invalid }, pageHeight)).toBeNull();
      expect(getWheelZoomDirection(state, input(16, 2), pageHeight)).toBe(0);
      expect(getWheelZoomDirection(state, input(32, 3), pageHeight)).toBe(-1);
    }
  });

  test("page mode requires a finite positive viewport height and resets on invalid geometry", () => {
    for (const height of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const state = createWheelZoomState();
      expect(getWheelZoomDirection(state, input(32, 0), pageHeight)).toBe(0);
      expect(getWheelZoomDirection(state, input(1, 1, 2), height)).toBeNull();
      expect(getWheelZoomDirection(state, input(16, 2), pageHeight)).toBe(0);
      expect(getWheelZoomDirection(state, input(32, 3), pageHeight)).toBe(-1);
      expect(getWheelZoomDirection(createWheelZoomState(), input(0, 0, 2), height)).toBeNull();
      expect(getWheelZoomDirection(createWheelZoomState(), input(48, 0), height)).toBe(-1);
      expect(getWheelZoomDirection(createWheelZoomState(), input(-3, 0, 1), height)).toBe(1);
    }
  });

  test("zoom factors use multiplicative 5% steps in both directions", () => {
    for (const factor of [0.75, 1, 1.5, 2.5]) {
      expect(getNextZoomFactor(factor, 1)).toBeCloseTo(factor * 1.05, 12);
      expect(getNextZoomFactor(factor, -1)).toBeCloseTo(factor / 1.05, 12);
      expect(getNextZoomFactor(getNextZoomFactor(factor, 1), -1)).toBeCloseTo(factor, 12);
    }
  });

  test("zoom steps clamp at 50% and 300% without preventing movement away from either limit", () => {
    expect(getNextZoomFactor(0.5, -1)).toBe(0.5);
    expect(getNextZoomFactor(0.51, -1)).toBe(0.5);
    expect(getNextZoomFactor(3, 1)).toBe(3);
    expect(getNextZoomFactor(2.99, 1)).toBe(3);
    expect(getNextZoomFactor(0.5, 1)).toBeCloseTo(0.525, 12);
    expect(getNextZoomFactor(3, -1)).toBeCloseTo(3 / 1.05, 12);
  });
});
