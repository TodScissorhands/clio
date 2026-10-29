import { describe, expect, test } from "bun:test";
import {
  computeSvgColorMatrix,
  DEFAULT_RECOLOR_SETTINGS,
  formatHexColor,
  isValidHexColor,
  normalizeHexColor,
  parseHexColor,
  recolorImageDataCpu,
  recolorPixelZathura,
  RECOLOR_PRESETS,
  RECOLOR_WEIGHTS,
} from "../src/pdf/recolor";
import type { NormalizedRect, PdfRecolorPresetId } from "../src/pdf/recolor";
import * as pdfjs from "pdfjs-dist";
import { createSyntheticRecolorPdf } from "./fixtures/synthetic-recolor-doc";

function applyMatrixToRgba(matrixValues: string, [r, g, b, a]: [number, number, number, number]): [number, number, number, number] {
  const m = matrixValues.trim().split(/\s+/).map(Number);
  expect(m.length).toBe(20);

  const outR = m[0] * r + m[1] * g + m[2] * b + m[3] * a + m[4];
  const outG = m[5] * r + m[6] * g + m[7] * b + m[8] * a + m[9];
  const outB = m[10] * r + m[11] * g + m[12] * b + m[13] * a + m[14];
  const outA = m[15] * r + m[16] * g + m[17] * b + m[18] * a + m[19];

  return [outR, outG, outB, outA];
}

describe("Hex color parsing and validation", () => {
  test("validates 3 and 6 digit hex colors with or without #", () => {
    expect(isValidHexColor("#fff")).toBe(true);
    expect(isValidHexColor("fff")).toBe(true);
    expect(isValidHexColor("#14161B")).toBe(true);
    expect(isValidHexColor("14161b")).toBe(true);
    expect(isValidHexColor("")).toBe(false);
    expect(isValidHexColor("invalid")).toBe(false);
    expect(isValidHexColor("#12345")).toBe(false);
    expect(isValidHexColor("#1234567")).toBe(false);
  });

  test("normalizes 3-digit and unhashed hex strings to uppercase 6-digit with #", () => {
    expect(normalizeHexColor("fff")).toBe("#FFFFFF");
    expect(normalizeHexColor("#abc")).toBe("#AABBCC");
    expect(normalizeHexColor("14161b")).toBe("#14161B");
    expect(normalizeHexColor("#dcd7ba")).toBe("#DCD7BA");
    expect(normalizeHexColor("invalid", "#000000")).toBe("#000000");
  });

  test("parses hex strings to normalized [0, 1] RGB and formats back", () => {
    const [r, g, b] = parseHexColor("#14161B");
    expect(r).toBeCloseTo(20 / 255, 6);
    expect(g).toBeCloseTo(22 / 255, 6);
    expect(b).toBeCloseTo(27 / 255, 6);
    expect(formatHexColor([r, g, b])).toBe("#14161B");
  });
});

describe("Standard recoloring SVG 4x5 color matrix", () => {
  const presets: PdfRecolorPresetId[] = [
    "zathura-dark",
    "gruvbox-dark",
    "solarized-dark",
    "rose-pine-dawn",
    "sepia-warm",
  ];

  for (const presetId of presets) {
    const preset = RECOLOR_PRESETS[presetId];
    test(`maps pure white to ${preset.label} background and black to foreground`, () => {
      const matrix = computeSvgColorMatrix(preset.lightColor, preset.darkColor);
      const expectedLight = parseHexColor(preset.lightColor);
      const expectedDark = parseHexColor(preset.darkColor);

      // White input (1, 1, 1, 1) -> expectedLight
      const [whiteR, whiteG, whiteB, whiteA] = applyMatrixToRgba(matrix, [1, 1, 1, 1]);
      expect(whiteR).toBeCloseTo(expectedLight[0], 4);
      expect(whiteG).toBeCloseTo(expectedLight[1], 4);
      expect(whiteB).toBeCloseTo(expectedLight[2], 4);
      expect(whiteA).toBeCloseTo(1, 4);

      // Black input (0, 0, 0, 1) -> expectedDark
      const [blackR, blackG, blackB, blackA] = applyMatrixToRgba(matrix, [0, 0, 0, 1]);
      expect(blackR).toBeCloseTo(expectedDark[0], 4);
      expect(blackG).toBeCloseTo(expectedDark[1], 4);
      expect(blackB).toBeCloseTo(expectedDark[2], 4);
      expect(blackA).toBeCloseTo(1, 4);
    });
  }

  test("uses verified Zathura Cairo luminance weights (0.30, 0.59, 0.11)", () => {
    expect(RECOLOR_WEIGHTS[0]).toBe(0.30);
    expect(RECOLOR_WEIGHTS[1]).toBe(0.59);
    expect(RECOLOR_WEIGHTS[2]).toBe(0.11);
    expect(RECOLOR_WEIGHTS[0] + RECOLOR_WEIGHTS[1] + RECOLOR_WEIGHTS[2]).toBeCloseTo(1.0, 10);
  });

  test("interpolates neutral grays linearly between dark and light colors without color fringes", () => {
    const darkHex = "#DCD7BA";
    const lightHex = "#14161B";
    const matrix = computeSvgColorMatrix(lightHex, darkHex);
    const dark = parseHexColor(darkHex);
    const light = parseHexColor(lightHex);

    const [grayR, grayG, grayB] = applyMatrixToRgba(matrix, [0.5, 0.5, 0.5, 1]);
    expect(grayR).toBeCloseTo(0.5 * dark[0] + 0.5 * light[0], 4);
    expect(grayG).toBeCloseTo(0.5 * dark[1] + 0.5 * light[1], 4);
    expect(grayB).toBeCloseTo(0.5 * dark[2] + 0.5 * light[2], 4);
  });
});

describe("Zathura hue-preserving recoloring (recolor-keephue)", () => {
  const dark = parseHexColor("#DCD7BA"); // Zathura Dark ink
  const light = parseHexColor("#14161B"); // Zathura Dark background

  test("preserves exact endpoints on white and black", () => {
    const whiteOut = recolorPixelZathura([1, 1, 1], dark, light, true, false);
    expect(whiteOut[0]).toBeCloseTo(light[0], 4);
    expect(whiteOut[1]).toBeCloseTo(light[1], 4);
    expect(whiteOut[2]).toBeCloseTo(light[2], 4);

    const blackOut = recolorPixelZathura([0, 0, 0], dark, light, true, false);
    expect(blackOut[0]).toBeCloseTo(dark[0], 4);
    expect(blackOut[1]).toBeCloseTo(dark[1], 4);
    expect(blackOut[2]).toBeCloseTo(dark[2], 4);
  });

  test("suppresses color fringes on antialiased neutral gray pixels", () => {
    const grayOut = recolorPixelZathura([0.5, 0.5, 0.5], dark, light, true, false);
    // Neutral gray must equal linear blend of endpoints
    expect(grayOut[0]).toBeCloseTo(0.5 * dark[0] + 0.5 * light[0], 4);
    expect(grayOut[1]).toBeCloseTo(0.5 * dark[1] + 0.5 * light[1], 4);
    expect(grayOut[2]).toBeCloseTo(0.5 * dark[2] + 0.5 * light[2], 4);
  });

  test("preserves chromatic hue directions for primary and secondary colors", () => {
    // Pure red (1, 0, 0): red channel must dominate
    const redOut = recolorPixelZathura([1, 0, 0], dark, light, true, false);
    expect(redOut[0]).toBeGreaterThan(redOut[1]);
    expect(redOut[0]).toBeGreaterThan(redOut[2]);

    // Pure green (0, 1, 0): green channel must dominate
    const greenOut = recolorPixelZathura([0, 1, 0], dark, light, true, false);
    expect(greenOut[1]).toBeGreaterThan(greenOut[0]);
    expect(greenOut[1]).toBeGreaterThan(greenOut[2]);

    // Pure blue (0, 0, 1): blue channel must dominate
    const blueOut = recolorPixelZathura([0, 0, 1], dark, light, true, false);
    expect(blueOut[2]).toBeGreaterThan(blueOut[0]);
    expect(blueOut[2]).toBeGreaterThan(blueOut[1]);
  });
});

describe("Zathura lightness adjustment (recolor-adjust-lightness)", () => {
  const dark = parseHexColor("#DCD7BA");
  const light = parseHexColor("#14161B");

  test("lifts dark saturated colors on dark backgrounds for readability", () => {
    const unadjustedGreen = recolorPixelZathura([0, 1, 0], dark, light, true, false);
    const adjustedGreen = recolorPixelZathura([0, 1, 0], dark, light, true, true);

    // Lightness adjustment lifts dark green channel
    expect(adjustedGreen[1]).toBeGreaterThan(unadjustedGreen[1]);

    const unadjustedCyan = recolorPixelZathura([0, 1, 1], dark, light, true, false);
    const adjustedCyan = recolorPixelZathura([0, 1, 1], dark, light, true, true);
    expect(adjustedCyan[0]).toBeGreaterThan(unadjustedCyan[0]);
    expect(adjustedCyan[1]).toBeGreaterThan(unadjustedCyan[1]);
  });

  test("preserves pure white and black endpoints when adjust-lightness is active", () => {
    const whiteOut = recolorPixelZathura([1, 1, 1], dark, light, true, true);
    expect(whiteOut[0]).toBeCloseTo(light[0], 4);
    expect(whiteOut[1]).toBeCloseTo(light[1], 4);
    expect(whiteOut[2]).toBeCloseTo(light[2], 4);

    const blackOut = recolorPixelZathura([0, 0, 0], dark, light, true, true);
    expect(blackOut[0]).toBeCloseTo(dark[0], 4);
    expect(blackOut[1]).toBeCloseTo(dark[1], 4);
    expect(blackOut[2]).toBeCloseTo(dark[2], 4);
  });
});

describe("Raster image preservation (recolor-reverse-video)", () => {
  const dark = parseHexColor("#DCD7BA");
  const light = parseHexColor("#14161B");

  test("preserves pixels inside image bounding boxes in original sRGB while recoloring outside", () => {
    // 4x4 image
    const width = 4;
    const height = 4;
    const data = new Uint8ClampedArray(width * height * 4);

    // Fill background with white (255, 255, 255)
    for (let i = 0; i < width * height; i += 1) {
      data[i * 4] = 255;
      data[i * 4 + 1] = 255;
      data[i * 4 + 2] = 255;
      data[i * 4 + 3] = 255;
    }

    // Place an embedded image in the bottom-right quadrant: x in [2, 3], y in [2, 3]
    // Normalized bounds: minX = 0.5, minY = 0.5, maxX = 1.0, maxY = 1.0
    // Fill image pixels with original photo color [64, 128, 192]
    for (let y = 2; y < 4; y += 1) {
      for (let x = 2; x < 4; x += 1) {
        const offset = (y * width + x) * 4;
        data[offset] = 64;
        data[offset + 1] = 128;
        data[offset + 2] = 192;
      }
    }

    const imageRects: NormalizedRect[] = [
      { minX: 0.5, minY: 0.5, maxX: 1.0, maxY: 1.0 },
    ];

    recolorImageDataCpu(
      data,
      width,
      height,
      dark,
      light,
      false,
      false,
      true, // reverseVideo enabled
      imageRects,
    );

    // Pixel at (0, 0) was white background outside image -> must be recolored to light background #14161B
    const bgOffset = 0;
    expect(data[bgOffset]).toBe(20);
    expect(data[bgOffset + 1]).toBe(22);
    expect(data[bgOffset + 2]).toBe(27);

    // Pixel at (2, 2) was inside image -> must remain original [64, 128, 192]
    const imgOffset = (2 * width + 2) * 4;
    expect(data[imgOffset]).toBe(64);
    expect(data[imgOffset + 1]).toBe(128);
    expect(data[imgOffset + 2]).toBe(192);
  });

  test("leaves scanned full-page raster image unrecolored (Zathura semantics)", () => {
    const width = 2;
    const height = 2;
    const data = new Uint8ClampedArray([
      200, 200, 200, 255,   180, 180, 180, 255,
      160, 160, 160, 255,   140, 140, 140, 255,
    ]);

    // Full-page image rect covers [0, 0] to [1, 1]
    const scannedPageRect: NormalizedRect[] = [
      { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    ];

    recolorImageDataCpu(
      data,
      width,
      height,
      dark,
      light,
      false,
      false,
      true,
      scannedPageRect,
    );

    // All pixels should remain in original scanned colors
    expect(data[0]).toBe(200);
    expect(data[4]).toBe(180);
    expect(data[8]).toBe(160);
    expect(data[12]).toBe(140);
  });
});

describe("Synthetic test PDF fixture", () => {
  test("generates valid 2-page document parseable by PDF.js with text, vector, and image", async () => {
    const pdfBytes = createSyntheticRecolorPdf();
    expect(pdfBytes.length).toBeGreaterThan(100);

    const task = pdfjs.getDocument({ data: pdfBytes });
    const doc = await task.promise;
    expect(doc.numPages).toBe(2);

    const page1 = await doc.getPage(1);
    const vp1 = page1.getViewport({ scale: 1 });
    expect(vp1.width).toBe(612);
    expect(vp1.height).toBe(792);

    const page2 = await doc.getPage(2);
    const vp2 = page2.getViewport({ scale: 1 });
    expect(vp2.width).toBe(612);
    expect(vp2.height).toBe(792);

    page1.cleanup();
    page2.cleanup();
    doc.cleanup();
    await task.destroy();
  });
});
