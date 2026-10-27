import { describe, expect, test } from "bun:test";
import { PixelsPerInch } from "pdfjs-dist";
import { calculateFitScale, getCenterPreservingScrollDelta, measureAvailableViewport } from "../src/reader/layout";
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
    const spreadScale = (1100 - 16) / (612 + 792);
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
