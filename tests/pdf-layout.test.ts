import { describe, expect, test } from "bun:test";
import { PixelsPerInch } from "pdfjs-dist";
import { calculateFitScale, getCenterPreservingScrollDelta, hasViewportSizeChanged, isScaleEffectivelyEqual, measureAvailableViewport } from "../src/reader/layout";
import type { RectBounds } from "../src/reader/layout";

const page = { width: 612, height: 792 };
const windowCases = [
  { name: "full-width", available: { width: 1120, height: 700 } },
  { name: "half-width", available: { width: 520, height: 700 } },
];

describe("PDF fractional fit scales", () => {
  for (const { name, available } of windowCases) {
    test(`fits page width at ${name} without rounding the viewer scale`, () => {
      const clioScale = calculateFitScale("fit-width", [page], "single", available);
      const viewerScale = clioScale / PixelsPerInch.PDF_TO_CSS_UNITS;
      const renderedWidth = page.width * viewerScale * PixelsPerInch.PDF_TO_CSS_UNITS;

      expect(viewerScale).toBeGreaterThan(0);
      expect(viewerScale).not.toBe(Math.round(viewerScale));
      expect(renderedWidth).toBeCloseTo(available.width, 8);
      expect(viewerScale * PixelsPerInch.PDF_TO_CSS_UNITS).toBeCloseTo(clioScale, 12);
    });

    test(`fits full page at ${name}`, () => {
      const clioScale = calculateFitScale("fit-page", [page], "single", available);
      const viewerScale = clioScale / PixelsPerInch.PDF_TO_CSS_UNITS;
      const renderedWidth = page.width * viewerScale * PixelsPerInch.PDF_TO_CSS_UNITS;
      const renderedHeight = page.height * viewerScale * PixelsPerInch.PDF_TO_CSS_UNITS;

      expect(renderedWidth).toBeLessThanOrEqual(available.width + 1e-9);
      expect(renderedHeight).toBeLessThanOrEqual(available.height + 1e-9);
    });
  }
  test("fits mixed page dimensions using the active page and spread", () => {
    const portrait = { width: 612, height: 792 };
    const landscape = { width: 792, height: 612 };
    const available = { width: 1100, height: 900 };

    expect(calculateFitScale("fit-page", [portrait, landscape], "single", available, 1))
      .toBeCloseTo(900 / 792, 10);
    expect(calculateFitScale("fit-page", [portrait, landscape], "single", available, 2))
      .toBeCloseTo(1100 / 792, 10);
    expect(calculateFitScale("fit-width", [portrait, landscape], "single", available, 2))
      .toBeCloseTo(1100 / 792, 10);
    expect(calculateFitScale("fit-page", [portrait, landscape], "single", available, 99))
      .toBeCloseTo(1100 / 792, 10);

    const pages = [portrait, landscape, { width: 612, height: 1000 }];
    const spreadScale = (1100 - 4) / (612 + 792);
    expect(calculateFitScale("fit-spread", pages, "spread", available, 1))
      .toBeCloseTo(spreadScale, 10);
    expect(calculateFitScale("fit-width", pages, "spread", available, 2))
      .toBeCloseTo(spreadScale, 10);
    expect(calculateFitScale("fit-spread", pages, "spread", available, 3))
      .toBeCloseTo(0.9, 10);
  });

  test("measures PDF padding once without subtracting the fixed status bar", () => {
    const originalGetComputedStyle = globalThis.getComputedStyle;
    globalThis.getComputedStyle = (() => ({
      paddingLeft: "24px",
      paddingRight: "24px",
      paddingTop: "24px",
      paddingBottom: "28px",
    }) as CSSStyleDeclaration) as typeof globalThis.getComputedStyle;
    const viewer = {
      clientWidth: 1200,
      clientHeight: 700,
      querySelector: () => ({}),
    } as unknown as HTMLDivElement;

    try {
      expect(measureAvailableViewport(viewer)).toEqual({ width: 1152, height: 648 });
    } finally {
      globalThis.getComputedStyle = originalGetComputedStyle;
    }
  });
  test("keeps the same normalized page point at viewport center across fractional zoom", () => {
    const before: RectBounds = { left: 100, top: 50, right: 500, bottom: 650 };
    const center = { x: 300, y: 350 };
    const normalizedX = (center.x - before.left) / (before.right - before.left);
    const normalizedY = (center.y - before.top) / (before.bottom - before.top);

    for (const after of [
      { left: 80, top: 30, right: 680, bottom: 930 },
      { left: 120, top: 70, right: 320, bottom: 370 },
    ]) {
      const delta = getCenterPreservingScrollDelta(before, after, center);
      expect(after.left + normalizedX * (after.right - after.left) - delta.left).toBeCloseTo(center.x, 10);
      expect(after.top + normalizedY * (after.bottom - after.top) - delta.top).toBeCloseTo(center.y, 10);
    }
  });
});

describe("PDF scale tolerance and viewport size delta", () => {
  test("treats scales within tolerance as effectively equal", () => {
    expect(isScaleEffectivelyEqual(1.25, 1.25)).toBe(true);
    expect(isScaleEffectivelyEqual(1.25, 1.25005)).toBe(true);
    expect(isScaleEffectivelyEqual(1.25, 1.25015)).toBe(false);
    expect(isScaleEffectivelyEqual(1.25, 1.24995)).toBe(true);
    expect(isScaleEffectivelyEqual(1.25, 1.24985)).toBe(false);
  });

  test("rejects non-finite and non-positive scale values", () => {
    expect(isScaleEffectivelyEqual(0, 0)).toBe(false);
    expect(isScaleEffectivelyEqual(-1, -1)).toBe(false);
    expect(isScaleEffectivelyEqual(Number.NaN, 1)).toBe(false);
    expect(isScaleEffectivelyEqual(1, Number.POSITIVE_INFINITY)).toBe(false);
  });

  test("ignores subpixel viewport fluctuations and detects whole-pixel shifts", () => {
    const base = { width: 800, height: 600 };
    expect(hasViewportSizeChanged(base, { width: 800.4, height: 600.3 })).toBe(false);
    expect(hasViewportSizeChanged(base, { width: 800, height: 600.99 })).toBe(false);
    expect(hasViewportSizeChanged(base, { width: 801, height: 600 })).toBe(true);
    expect(hasViewportSizeChanged(base, { width: 799, height: 600 })).toBe(true);
    expect(hasViewportSizeChanged(base, { width: 800, height: 601 })).toBe(true);
    expect(hasViewportSizeChanged(base, { width: 800, height: 599 })).toBe(true);
  });
});

describe("PDF viewport padding measurement (Phase 2)", () => {
  test("measures 8px normal outer padding correctly", () => {
    const originalGetComputedStyle = globalThis.getComputedStyle;
    globalThis.getComputedStyle = (() => ({
      paddingLeft: "8px",
      paddingRight: "8px",
      paddingTop: "8px",
      paddingBottom: "8px",
    }) as CSSStyleDeclaration) as typeof globalThis.getComputedStyle;
    const viewer = {
      clientWidth: 1200,
      clientHeight: 800,
      querySelector: () => ({}),
    } as unknown as HTMLDivElement;

    try {
      expect(measureAvailableViewport(viewer)).toEqual({ width: 1184, height: 784 });
    } finally {
      globalThis.getComputedStyle = originalGetComputedStyle;
    }
  });

  test("measures 4px narrow outer padding correctly (<960px breakpoint)", () => {
    const originalGetComputedStyle = globalThis.getComputedStyle;
    globalThis.getComputedStyle = (() => ({
      paddingLeft: "4px",
      paddingRight: "4px",
      paddingTop: "4px",
      paddingBottom: "4px",
    }) as CSSStyleDeclaration) as typeof globalThis.getComputedStyle;
    const viewer = {
      clientWidth: 800,
      clientHeight: 600,
      querySelector: () => ({}),
    } as unknown as HTMLDivElement;

    try {
      expect(measureAvailableViewport(viewer)).toEqual({ width: 792, height: 592 });
    } finally {
      globalThis.getComputedStyle = originalGetComputedStyle;
    }
  });
});

describe("PDF pointer anchoring geometry", () => {
  const before: RectBounds = { left: 100, top: 50, right: 500, bottom: 650 };
  const after: RectBounds = { left: 80, top: 30, right: 680, bottom: 930 };

  for (const { name, point, expected } of [
    { name: "page center", point: { x: 300, y: 350 }, expected: { left: 80, top: 130 } },
    { name: "off-center interior", point: { x: 180, y: 200 }, expected: { left: 20, top: 55 } },
    { name: "near left edge", point: { x: 104, y: 350 }, expected: { left: -18, top: 130 } },
    { name: "near right edge", point: { x: 496, y: 350 }, expected: { left: 178, top: 130 } },
    { name: "near top edge", point: { x: 300, y: 56 }, expected: { left: 80, top: -17 } },
    { name: "near bottom edge", point: { x: 300, y: 644 }, expected: { left: 80, top: 277 } },
    { name: "near top-left corner", point: { x: 104, y: 56 }, expected: { left: -18, top: -17 } },
    { name: "near bottom-right corner", point: { x: 496, y: 644 }, expected: { left: 178, top: 277 } },
  ]) {
    test(`anchors the ${name} rather than substituting the viewport center`, () => {
      const delta = getCenterPreservingScrollDelta(before, after, point);
      expect(delta.left).toBeCloseTo(expected.left, 10);
      expect(delta.top).toBeCloseTo(expected.top, 10);
    });
  }

  for (const { name, resized, expected } of [
    {
      name: "horizontal",
      resized: { left: -240, top: -300, right: 760, bottom: 900 },
      expected: { left: 20, top: 0 },
    },
    {
      name: "vertical",
      resized: { left: -200, top: -360, right: 600, bottom: 1140 },
      expected: { left: 0, top: 30 },
    },
    {
      name: "horizontal and vertical",
      resized: { left: -240, top: -360, right: 760, bottom: 1140 },
      expected: { left: 20, top: 30 },
    },
  ]) {
    test(`returns both scroll components correctly with ${name} overflow`, () => {
      const overflowingPage = { left: -200, top: -300, right: 600, bottom: 900 };
      expect(getCenterPreservingScrollDelta(overflowingPage, resized, { x: 40, y: 60 }))
        .toEqual(expected);
    });
  }

  test("anchors the right-hand page of a spread independently of its fixed gap", () => {
    // The left page grows from 400px to 600px wide at x=20; the gap stays 4px.
    // The right-page quarter point moves from (524, 190) to (774, 265).
    const rightPageBefore = { left: 424, top: 40, right: 824, bottom: 640 };
    const rightPageAfter = { left: 624, top: 40, right: 1224, bottom: 940 };
    expect(getCenterPreservingScrollDelta(rightPageBefore, rightPageAfter, { x: 524, y: 190 }))
      .toEqual({ left: 250, top: 75 });
  });

  test("anchors the left-hand page without including the other page or spread gap", () => {
    const leftPageBefore = { left: 20, top: 40, right: 420, bottom: 640 };
    const leftPageAfter = { left: 20, top: 40, right: 620, bottom: 940 };
    expect(getCenterPreservingScrollDelta(leftPageBefore, leftPageAfter, { x: 120, y: 190 }))
      .toEqual({ left: 50, top: 75 });
  });

  test("includes preceding content movement when anchoring a lower continuous page", () => {
    // The preceding page's bottom moves from 160 to 460; its following gap stays 20px.
    // The lower page's quarter point moves from (200, 330) to (230, 705).
    const lowerPageBefore = { left: 100, top: 180, right: 500, bottom: 780 };
    const lowerPageAfter = { left: 80, top: 480, right: 680, bottom: 1380 };
    expect(getCenterPreservingScrollDelta(lowerPageBefore, lowerPageAfter, { x: 200, y: 330 }))
      .toEqual({ left: 30, top: 375 });
  });

  test("returns negative corrections when zooming an overflowing page out", () => {
    const enlarged = { left: -240, top: -360, right: 760, bottom: 1140 };
    const reduced = { left: -200, top: -300, right: 600, bottom: 900 };
    expect(getCenterPreservingScrollDelta(enlarged, reduced, { x: 60, y: 90 }))
      .toEqual({ left: -20, top: -30 });
    expect(getCenterPreservingScrollDelta(enlarged, reduced, { x: 750, y: 1125 }))
      .toEqual({ left: -158, top: -237 });
  });

  test("accounts for page repositioning as well as shrinking during zoom out", () => {
    expect(getCenterPreservingScrollDelta(after, before, { x: 230, y: 255 }))
      .toEqual({ left: -30, top: -55 });
  });
});
