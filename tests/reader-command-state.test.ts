import { describe, expect, test } from "bun:test";
import { DEFAULT_RECOLOR_SETTINGS, RECOLOR_PRESETS } from "../src/pdf/recolor";
import type { PdfRecolorPresetId, PdfRecolorSettings } from "../src/pdf/recolor";
import { getEpubCommandStates, getPdfCommandStates } from "../src/reader/commandState";
import type { ReaderCommandStates } from "../src/reader/commandState";
import type { ReaderCommandId } from "../src/reader/interactions";

type PdfState = Parameters<typeof getPdfCommandStates>[0];

function pdfStates(overrides: Partial<PdfState> = {}): ReaderCommandStates {
  return getPdfCommandStates({
    viewMode: "single",
    effectiveViewMode: "single",
    zoomMode: "fit-page",
    continuousScrolling: false,
    nightMode: false,
    recolorSettings: { ...DEFAULT_RECOLOR_SETTINGS },
    ...overrides,
  });
}

const stocks: [PdfRecolorPresetId, ReaderCommandId][] = [
  ["light", "theme_light"],
  ["dark", "theme_dark"],
  ["zathura-dark", "theme_zathura_dark"],
  ["gruvbox-dark", "theme_gruvbox_dark"],
  ["solarized-dark", "theme_solarized_dark"],
  ["rose-pine-dawn", "theme_rose_pine_dawn"],
  ["sepia-warm", "theme_sepia"],
];
const fits: [PdfState["zoomMode"], ReaderCommandId][] = [
  ["fit-page", "fit_to_page"],
  ["fit-width", "fit_to_page_width"],
  ["fit-spread", "fit_to_spread"],
];
const options: [keyof Pick<PdfRecolorSettings,
  "recolorKeephue" | "recolorReverseVideo" | "recolorAdjustLightness">, ReaderCommandId][] = [
  ["recolorKeephue", "recolor_toggle_keephue"],
  ["recolorReverseVideo", "recolor_toggle_reverse_video"],
  ["recolorAdjustLightness", "recolor_toggle_adjust_lightness"],
];

function stockSettings(id: PdfRecolorPresetId, recolor = true): PdfRecolorSettings {
  const preset = RECOLOR_PRESETS[id];
  return {
    ...DEFAULT_RECOLOR_SETTINGS,
    recolor,
    activePreset: id,
    recolorLightcolor: preset.lightColor,
    recolorDarkcolor: preset.darkColor,
  };
}

describe("PDF command setting descriptions", () => {
  test.each(["single", "spread"] as const)("marks the displayed %s view, not its neighbor", (viewMode) => {
    const states = pdfStates({ viewMode, effectiveViewMode: viewMode });
    expect(states.single_page_view?.active).toBe(viewMode === "single");
    expect(states.two_page_spread?.active).toBe(viewMode === "spread");
    expect(states[viewMode === "single" ? "single_page_view" : "two_page_spread"]?.text).toMatch(/^Current$/i);
    expect(states[viewMode === "single" ? "two_page_spread" : "single_page_view"]?.text).toMatch(/not current/i);
  });

  test("a narrow window distinguishes the displayed single page from requested spread and retained fit", () => {
    const requested: Partial<PdfState> = { viewMode: "spread", zoomMode: "fit-spread" };
    const narrow = pdfStates({ ...requested, effectiveViewMode: "single" });
    expect(narrow.single_page_view?.active).toBe(true);
    expect(narrow.single_page_view?.text).toMatch(/displayed.*narrow/i);
    expect(narrow.two_page_spread?.active).toBe(false);
    expect(narrow.two_page_spread?.text).toMatch(/requested.*single page/i);
    expect(narrow.fit_to_spread?.active).toBe(true);
    expect(narrow.fit_to_spread?.text).toMatch(/current.*single.page fallback/i);
    expect(narrow.fit_to_page?.active).toBe(false);
    expect(narrow.fit_to_page_width?.active).toBe(false);

    const wide = pdfStates({ ...requested, effectiveViewMode: "spread" });
    expect(wide.single_page_view?.active).toBe(false);
    expect(wide.two_page_spread?.active).toBe(true);
    expect(wide.two_page_spread?.text).not.toMatch(/requested|single page/i);
    expect(wide.fit_to_spread?.active).toBe(true);
    expect(wide.fit_to_spread?.text).not.toMatch(/fallback/i);
  });

  test.each(fits)("%s is the only active fit independent of view and continuous scrolling", (zoomMode, commandId) => {
    for (const effectiveViewMode of ["single", "spread"] as const) {
      const states = pdfStates({ viewMode: "spread", effectiveViewMode, zoomMode, continuousScrolling: true });
      for (const [, id] of fits) expect(states[id]?.active).toBe(id === commandId);
    }
  });

  test("manual zoom does not claim any fit, including during narrow spread fallback", () => {
    for (const effectiveViewMode of ["single", "spread"] as const) {
      const states = pdfStates({ viewMode: "spread", effectiveViewMode, zoomMode: "manual" });
      for (const [, id] of fits) {
        expect(states[id]?.active).toBe(false);
        expect(states[id]?.text).toMatch(/not current.*custom zoom/i);
      }
    }
  });

  test("continuous scrolling, night appearance and PDF recoloring are independent", () => {
    for (const continuousScrolling of [false, true]) {
      for (const nightMode of [false, true]) {
        for (const recolor of [false, true]) {
          const states = pdfStates({ continuousScrolling, nightMode, recolorSettings: stockSettings("zathura-dark", recolor) });
          expect(states.toggle_continuous_scrolling?.active).toBe(continuousScrolling);
          expect(states.toggle_continuous_scrolling?.text).toMatch(continuousScrolling ? /^On$/i : /^Off$/i);
          expect(states.toggle_night_mode?.active).toBe(nightMode);
          expect(states.toggle_night_mode?.text).toMatch(nightMode ? /^On$/i : /^Off$/i);
          expect(states.toggle_recolor?.active).toBe(recolor);
          expect(states.theme_original?.active).toBe(!recolor);
        }
      }
    }
  });

  test.each(stocks)("%s is active only with its own enabled, matching colors", (presetId, commandId) => {
    const settings = stockSettings(presetId);
    // The settings loader normalizes these too; derivation must not depend on casing or a leading #.
    settings.recolorLightcolor = ` ${settings.recolorLightcolor.slice(1).toLowerCase()} `;
    settings.recolorDarkcolor = settings.recolorDarkcolor.toLowerCase();
    const enabled = pdfStates({ recolorSettings: settings });
    expect(enabled.toggle_recolor?.active).toBe(true);
    expect(enabled.toggle_recolor?.text).toContain(RECOLOR_PRESETS[presetId].label);
    expect(enabled.theme_original?.active).toBe(false);
    for (const [, id] of stocks) expect(enabled[id]?.active).toBe(id === commandId);
    expect(enabled[commandId]?.text).toMatch(/current/i);

    const disabled = pdfStates({ recolorSettings: { ...settings, recolor: false } });
    expect(disabled.toggle_recolor?.active).toBe(false);
    expect(disabled.toggle_recolor?.text).toMatch(/off/i);
    expect(disabled.theme_original?.active).toBe(true);
    expect(disabled.theme_original?.text).toMatch(/current/i);
    for (const [, id] of stocks) {
      expect(disabled[id]?.active).toBe(false);
      if (id === commandId) expect(disabled[id]?.text).toMatch(/saved.*off/i);
    }
  });

  test.each(stocks)("%s restored with either mismatched color is custom, not a stock or saved preset", (presetId, commandId) => {
    for (const color of ["recolorLightcolor", "recolorDarkcolor"] as const) {
      for (const recolor of [false, true]) {
        const settings = { ...stockSettings(presetId, recolor), [color]: "#123456" };
        const states = pdfStates({ recolorSettings: settings });
        for (const [, id] of stocks) expect(states[id]?.active).toBe(false);
        expect(states[commandId]?.text).toMatch(/not current/i);
        expect(states.toggle_recolor?.text).toMatch(recolor ? /custom/i : /off/i);
      }
    }
  });

  test.each(["custom", "original"] as const)("%s metadata does not identify a stock even when both colors match one", (activePreset) => {
    const states = pdfStates({ recolorSettings: { ...stockSettings("zathura-dark"), activePreset } });
    expect(states.toggle_recolor?.active).toBe(true);
    expect(states.toggle_recolor?.text).toMatch(/custom/i);
    expect(states.theme_original?.active).toBe(false);
    for (const [, id] of stocks) expect(states[id]?.active).toBe(false);
  });

  test("a seeded legacy Original identity remains custom when saved colors are enabled", () => {
    const original = { ...stockSettings("gruvbox-dark", false), activePreset: "original" as const };
    const disabled = pdfStates({ recolorSettings: original });
    expect(disabled.theme_original?.active).toBe(true);
    expect(disabled.theme_gruvbox_dark?.text).not.toMatch(/saved/i);
    const enabled = pdfStates({ recolorSettings: { ...original, recolor: true } });
    expect(enabled.toggle_recolor?.active).toBe(true);
    expect(enabled.toggle_recolor?.text).toMatch(/custom/i);
    expect(enabled.theme_original?.active).toBe(false);
    expect(enabled.theme_gruvbox_dark?.active).toBe(false);
  });

  test("an arbitrary custom color pair has no stock marker", () => {
    const states = pdfStates({ recolorSettings: {
      ...stockSettings("custom"), recolorLightcolor: "#abc", recolorDarkcolor: "#123",
    } });
    expect(states.toggle_recolor?.text).toMatch(/custom/i);
    for (const [, id] of stocks) expect(states[id]?.active).toBe(false);
  });

  test("saved hue, image and lightness options only become active while recoloring is enabled", () => {
    for (let mask = 0; mask < 8; mask++) {
      for (const recolor of [false, true]) {
        const settings = {
          ...stockSettings("zathura-dark", recolor),
          recolorKeephue: Boolean(mask & 1),
          recolorReverseVideo: Boolean(mask & 2),
          recolorAdjustLightness: Boolean(mask & 4),
        };
        const states = pdfStates({ recolorSettings: settings });
        for (const [option, id] of options) {
          const saved = settings[option];
          expect(states[id]?.active).toBe(recolor && saved);
          expect(states[id]?.text).toMatch(recolor
            ? saved ? /\bon\b/i : /\boff\b/i
            : saved ? /saved.*on.*off/i : /off/i);
        }
      }
    }
  });

  test("derivation neither mutates frozen inputs nor reuses stale state between updates", () => {
    const recolorSettings = Object.freeze({ ...stockSettings("sepia-warm"), recolorKeephue: true });
    const state: PdfState = Object.freeze({
      viewMode: "spread", effectiveViewMode: "single", zoomMode: "fit-spread",
      continuousScrolling: true, nightMode: true, recolorSettings,
    });
    const before = JSON.stringify(state);
    const first = getPdfCommandStates(state);
    const second = getPdfCommandStates({
      ...state, effectiveViewMode: "spread", zoomMode: "manual", nightMode: false,
      recolorSettings: { ...recolorSettings, recolor: false },
    });
    expect(JSON.stringify(state)).toBe(before);
    expect(first.two_page_spread?.active).toBe(false);
    expect(second.two_page_spread?.active).toBe(true);
    expect(first.fit_to_spread?.active).toBe(true);
    expect(second.fit_to_spread?.active).toBe(false);
    expect(first.toggle_night_mode?.active).toBe(true);
    expect(second.toggle_night_mode?.active).toBe(false);
    expect(first.recolor_toggle_keephue?.active).toBe(true);
    expect(second.recolor_toggle_keephue?.active).toBe(false);
  });

  test("navigation, file actions and zoom increments have no setting status", () => {
    const states = pdfStates();
    const oneShots: ReaderCommandId[] = [
      "open_document", "close_document", "search", "next_item", "previous_item",
      "goto_page_with_page_number", "next_page", "previous_page", "goto_beginning", "goto_end",
      "zoom_in", "zoom_out",
      "paged_layout", "continuous_layout", "select_chapter",
    ];
    for (const id of oneShots) expect(states[id]).toBeUndefined();
  });
});

describe("EPUB command setting descriptions", () => {
  test.each(["paged", "continuous"] as const)("only the %s layout is current", (layout) => {
    const states = getEpubCommandStates(layout);
    expect(states.paged_layout?.active).toBe(layout === "paged");
    expect(states.continuous_layout?.active).toBe(layout === "continuous");
    expect(states[layout === "paged" ? "paged_layout" : "continuous_layout"]?.text).toMatch(/^Current$/i);
    expect(states[layout === "paged" ? "continuous_layout" : "paged_layout"]?.text).toMatch(/not current/i);
    expect(Object.keys(states).sort()).toEqual(["continuous_layout", "paged_layout"]);
    expect(states.select_chapter).toBeUndefined();
    expect(states.next_chapter).toBeUndefined();
  });
});
