import { describe, expect, test } from "bun:test";
import { DOCUMENT_THEMES } from "../src/reader/appearance";
import { applyPdfTheme, getPdfSearchAppearance, getPdfThemeState } from "../src/pdf/appearance";
import {
  DEFAULT_RECOLOR_SETTINGS,
  loadRecolorSettings,
  parseHexColor,
  recolorImageDataCpu,
  RECOLOR_PRESETS,
  saveRecolorSettings,
} from "../src/pdf/recolor";
import type { PdfRecolorSettings } from "../src/pdf/recolor";

const STORAGE_KEY = "clio:pdf-recolor-settings";
const namedThemes = DOCUMENT_THEMES.filter((theme) => theme.id !== "original");
const custom: PdfRecolorSettings = {
  ...DEFAULT_RECOLOR_SETTINGS,
  recolor: true,
  activePreset: "custom",
  recolorLightcolor: "#EEDDCF",
  recolorDarkcolor: "#123456",
};

function withWindow(value: object | undefined, run: () => void): void {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  if (value === undefined) Reflect.deleteProperty(globalThis, "window");
  else Object.defineProperty(globalThis, "window", { configurable: true, value });
  try {
    run();
  } finally {
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  }
}

function memoryStorage(initial?: string) {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(STORAGE_KEY, initial);
  const reads: string[] = [];
  const writes: [string, string][] = [];
  return {
    data,
    reads,
    writes,
    storage: {
      getItem(key: string): string | null {
        reads.push(key);
        return data.get(key) ?? null;
      },
      setItem(key: string, value: string): void {
        writes.push([key, value]);
        data.set(key, value);
      },
    },
  };
}

function renderedPixels(settings: PdfRecolorSettings): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 62, 125, 213, 191]);
  if (settings.recolor) {
    recolorImageDataCpu(
      pixels, 3, 1, parseHexColor(settings.recolorDarkcolor), parseHexColor(settings.recolorLightcolor),
      settings.recolorKeephue, settings.recolorAdjustLightness, settings.recolorReverseVideo,
      [{ minX: 0.6, minY: 0, maxX: 1, maxY: 1 }],
    );
  }
  return pixels;
}

describe("PDF document themes", () => {
  test("starts in native colors with the saved Zathura appearance distinct from effective Original", () => {
    expect(getPdfThemeState(DEFAULT_RECOLOR_SETTINGS)).toEqual({
      effective: "original", saved: "zathura-dark", advanced: false,
    });
  });

  for (const theme of namedThemes) {
    test(`${theme.label} applies the shared pair and retained persistent ID without changing advanced flags`, () => {
      const input = Object.freeze({ ...custom, recolorKeephue: true, recolorReverseVideo: true, recolorAdjustLightness: true });
      const result = applyPdfTheme(input, theme.id);
      const persistentId = theme.id === "sepia" ? "sepia-warm" : theme.id;
      expect(result).toEqual({
        ...input, recolor: true, activePreset: persistentId,
        recolorLightcolor: theme.background, recolorDarkcolor: theme.foreground,
      });
      expect(RECOLOR_PRESETS[persistentId].lightColor).toBe(theme.background);
      expect(RECOLOR_PRESETS[persistentId].darkColor).toBe(theme.foreground);
      expect(getPdfThemeState(result)).toEqual({ effective: theme.id, saved: theme.id, advanced: true });
      expect(input).toEqual({ ...custom, recolorKeephue: true, recolorReverseVideo: true, recolorAdjustLightness: true });
      const pixels = renderedPixels({ ...result, recolorKeephue: false, recolorReverseVideo: false, recolorAdjustLightness: false });
      expect(Array.from(pixels.slice(0, 3))).toEqual(parseHexColor(theme.background).map((channel) => Math.round(channel * 255)));
      expect(Array.from(pixels.slice(4, 7))).toEqual(parseHexColor(theme.foreground).map((channel) => Math.round(channel * 255)));
    });
  }

  test("Original changes only recolor, preserving even nonnormalized saved colors and legacy IDs", () => {
    for (const activePreset of Object.keys(RECOLOR_PRESETS) as PdfRecolorSettings["activePreset"][]) {
      const input = Object.freeze({ ...custom, activePreset, recolorLightcolor: " abc ", recolorDarkcolor: "#def", recolorKeephue: true });
      expect(applyPdfTheme(input, "original")).toEqual({ ...input, recolor: false });
      expect(input.recolor).toBe(true);
      const off = Object.freeze({ ...input, recolor: false });
      expect(applyPdfTheme(off, "original")).toEqual(off);
    }
  });

  test("a named saved appearance requires its retained identity and both normalized matching colors", () => {
    expect(getPdfThemeState({
      ...applyPdfTheme(custom, "light"), recolorLightcolor: "#fff", recolorDarkcolor: " 202124 ",
    })).toEqual({ effective: "light", saved: "light", advanced: false });
    for (const theme of namedThemes) {
      const selected = applyPdfTheme(custom, theme.id);
      const normalized = { ...selected, recolorLightcolor: theme.background.slice(1).toLowerCase(), recolorDarkcolor: ` ${theme.foreground.toLowerCase()} ` };
      expect(getPdfThemeState(normalized).saved).toBe(theme.id);
      expect(getPdfThemeState({ ...normalized, recolor: false })).toEqual({ effective: "original", saved: theme.id, advanced: false });
      for (const changed of [
        { recolorLightcolor: "#112233" }, { recolorDarkcolor: "#445566" },
        { recolorLightcolor: "nothex" }, { recolorDarkcolor: "#gggggg" },
        { activePreset: "custom" as const }, { activePreset: "original" as const },
      ]) {
        const mismatch = { ...selected, ...changed };
        expect(getPdfThemeState(mismatch)).toEqual({ effective: "custom", saved: "custom", advanced: false });
        expect(getPdfThemeState({ ...mismatch, recolor: false })).toEqual({ effective: "original", saved: "custom", advanced: false });
      }
      const other = namedThemes.find((candidate) => candidate.id !== theme.id)!;
      const mismatchedId = { ...selected, activePreset: other.id === "sepia" ? "sepia-warm" as const : other.id };
      expect(getPdfThemeState(mismatchedId).saved).toBe("custom");
    }
  });

  for (let flags = 0; flags < 8; flags += 1) {
    for (const theme of [...namedThemes, { id: "custom", label: "Custom" } as const]) {
      test(`${theme.label} → Original → save/fresh load → saved recolor toggle preserves colors and flags ${flags}`, () => {
        const chosen = theme.id === "custom" ? custom : applyPdfTheme(custom, theme.id);
        const selected = Object.freeze({
          ...chosen,
          recolorKeephue: Boolean(flags & 1),
          recolorReverseVideo: Boolean(flags & 2),
          recolorAdjustLightness: Boolean(flags & 4),
        });
        const before = renderedPixels(selected);
        const original = applyPdfTheme(selected, "original");
        expect(original).toEqual({ ...selected, recolor: false });
        expect(getPdfThemeState(original)).toEqual({ effective: "original", saved: theme.id, advanced: flags !== 0 });
        const state = memoryStorage();
        withWindow({ localStorage: state.storage }, () => saveRecolorSettings(original));
        let restored = { ...DEFAULT_RECOLOR_SETTINGS };
        withWindow({ localStorage: state.storage }, () => { restored = loadRecolorSettings(); });
        expect(restored).toEqual(original);
        expect(getPdfThemeState(restored)).toEqual({ effective: "original", saved: theme.id, advanced: flags !== 0 });
        // The r command changes only this boolean; fresh loading must retain everything it restores.
        const toggled = { ...restored, recolor: !restored.recolor };
        expect(getPdfThemeState(toggled)).toEqual({ effective: theme.id, saved: theme.id, advanced: flags !== 0 });
        expect(renderedPixels(toggled)).toEqual(before);
        expect(before).not.toEqual(renderedPixels(original));
        expect(state.writes).toHaveLength(1);
        expect(state.reads).toEqual([STORAGE_KEY]);
        expect(Object.keys(JSON.parse(state.data.get(STORAGE_KEY)!)).sort()).toEqual(Object.keys(DEFAULT_RECOLOR_SETTINGS).sort());
      });
    }
  }
});

describe("PDF appearance persistence compatibility", () => {
  test("loads named on/off, Custom and mismatched saved identities without rewriting any blob", () => {
    const seeds = [
      ...namedThemes.map((theme) => ({ settings: applyPdfTheme(custom, theme.id), saved: theme.id })),
      { settings: custom, saved: "custom" as const },
      { settings: { ...applyPdfTheme(custom, "dark"), recolorDarkcolor: "#112233" }, saved: "custom" as const },
      { settings: { ...applyPdfTheme(custom, "light"), activePreset: "dark" as const }, saved: "custom" as const },
    ];
    for (const seed of seeds) {
      for (const recolor of [false, true]) {
        const settings = { ...seed.settings, recolor };
        const raw = JSON.stringify(settings);
        const state = memoryStorage(raw);
        withWindow({ localStorage: state.storage }, () => {
          const loaded = loadRecolorSettings();
          expect(loaded).toEqual(settings);
          expect(getPdfThemeState(loaded)).toEqual({ effective: recolor ? seed.saved : "original", saved: seed.saved, advanced: false });
        });
        expect(state.writes).toEqual([]);
        expect(state.data.get(STORAGE_KEY)).toBe(raw);
      }
    }
  });

  test("legacy Original is always saved Custom, even for every stock-looking pair, and roundtrips exact rendering", () => {
    const legacyNativePair = {
      ...custom, recolorLightcolor: RECOLOR_PRESETS.original.lightColor, recolorDarkcolor: RECOLOR_PRESETS.original.darkColor,
    };
    for (const pair of [custom, legacyNativePair, ...namedThemes.map((theme) => applyPdfTheme(custom, theme.id))]) {
      for (let flags = 0; flags < 8; flags += 1) {
        for (const recolor of [false, true]) {
          const legacy: PdfRecolorSettings = {
            ...pair, activePreset: "original", recolor,
            recolorKeephue: Boolean(flags & 1), recolorReverseVideo: Boolean(flags & 2), recolorAdjustLightness: Boolean(flags & 4),
          };
          const raw = JSON.stringify(legacy);
          const state = memoryStorage(raw);
          withWindow({ localStorage: state.storage }, () => {
            const loaded = loadRecolorSettings();
            expect(loaded).toEqual(legacy);
            expect(state.writes).toEqual([]);
            expect(state.data.get(STORAGE_KEY)).toBe(raw);
            expect(getPdfThemeState(loaded)).toEqual({ effective: recolor ? "custom" : "original", saved: "custom", advanced: flags !== 0 });
            const original = applyPdfTheme(loaded, "original");
            saveRecolorSettings(original);
            const restored = loadRecolorSettings();
            const toggled = { ...restored, recolor: !restored.recolor };
            expect(getPdfThemeState(toggled)).toEqual({ effective: "custom", saved: "custom", advanced: flags !== 0 });
            expect(toggled).toEqual({ ...legacy, recolor: true });
            expect(renderedPixels(toggled)).toEqual(renderedPixels({ ...legacy, recolor: true }));
          });
        }
      }
    }
  });

  test("malformed JSON and nonobject roots return defaults without writing", () => {
    for (const raw of [undefined, "", "{", "null", "[]", "[{}]", "42", '"dark"', "true", "false"]) {
      const state = memoryStorage(raw);
      withWindow({ localStorage: state.storage }, () => {
        expect(loadRecolorSettings()).toEqual(DEFAULT_RECOLOR_SETTINGS);
        expect(state.writes).toEqual([]);
        expect(state.data.get(STORAGE_KEY)).toBe(raw);
      });
    }
  });

  test("validates booleans strictly and falls back only the malformed field", () => {
    const valid = { ...custom, recolorKeephue: true, recolorReverseVideo: true, recolorAdjustLightness: true };
    for (const field of ["recolor", "recolorKeephue", "recolorReverseVideo", "recolorAdjustLightness"] as const) {
      for (const invalid of [undefined, null, 0, 1, "false", "true", [], {}, ""]) {
        const state = memoryStorage(JSON.stringify({ ...valid, [field]: invalid }));
        withWindow({ localStorage: state.storage }, () => {
          expect(loadRecolorSettings()).toEqual({ ...valid, [field]: DEFAULT_RECOLOR_SETTINGS[field] });
          expect(state.writes).toEqual([]);
        });
      }
      for (const value of [false, true]) {
        const state = memoryStorage(JSON.stringify({ ...valid, [field]: value }));
        withWindow({ localStorage: state.storage }, () => expect(loadRecolorSettings()).toEqual({ ...valid, [field]: value }));
      }
    }
  });

  test("validates hex string types before normalization and falls back field by field", () => {
    for (const field of ["recolorLightcolor", "recolorDarkcolor"] as const) {
      for (const invalid of [undefined, null, false, 123, [], {}, "", "#12", "#12345", "#1234567", "#gggggg", "red", "#fff; color: red", "url(x)"]) {
        const state = memoryStorage(JSON.stringify({ ...custom, [field]: invalid }));
        withWindow({ localStorage: state.storage }, () => {
          expect(loadRecolorSettings()).toEqual({ ...custom, [field]: DEFAULT_RECOLOR_SETTINGS[field] });
          expect(state.writes).toEqual([]);
        });
      }
    }
    const raw = JSON.stringify({ ...custom, recolorLightcolor: " abc ", recolorDarkcolor: "#def", ignored: "body { display:none }" });
    const state = memoryStorage(raw);
    withWindow({ localStorage: state.storage }, () => {
      expect(loadRecolorSettings()).toEqual({ ...custom, recolorLightcolor: "#AABBCC", recolorDarkcolor: "#DDEEFF" });
      expect(state.data.get(STORAGE_KEY)).toBe(raw);
      expect(state.writes).toEqual([]);
    });
  });

  test("only recognizes own preset IDs, rejecting prototype names and unsupported types", () => {
    for (const activePreset of [undefined, null, true, 1, {}, [], "", "sepia", "unknown", "constructor", "toString", "__proto__", "valueOf", "hasOwnProperty"]) {
      const raw = JSON.stringify({ ...custom, activePreset });
      const state = memoryStorage(raw);
      withWindow({ localStorage: state.storage }, () => {
        const loaded = loadRecolorSettings();
        expect(loaded).toEqual({ ...custom, activePreset: DEFAULT_RECOLOR_SETTINGS.activePreset });
        expect(getPdfThemeState(loaded).saved).toBe("custom");
        expect(state.writes).toEqual([]);
        expect(state.data.get(STORAGE_KEY)).toBe(raw);
      });
    }
    for (const activePreset of Object.keys(RECOLOR_PRESETS)) {
      const state = memoryStorage(JSON.stringify({ ...custom, activePreset }));
      withWindow({ localStorage: state.storage }, () => expect(loadRecolorSettings().activePreset).toBe(activePreset));
    }
  });

  test("uses only the existing PDF key and never changes EPUB preferences or native positions", () => {
    const state = memoryStorage();
    state.data.set("clio:epub-reading-preferences", '{"version":1,"theme":"sepia"}');
    state.data.set("clio:reading-position", "epubcfi(/6/2)");
    withWindow({ localStorage: state.storage }, () => {
      saveRecolorSettings(custom);
      expect(loadRecolorSettings()).toEqual(custom);
    });
    expect(state.writes).toEqual([[STORAGE_KEY, JSON.stringify(custom)]]);
    expect(state.reads).toEqual([STORAGE_KEY]);
    expect(state.data.get("clio:epub-reading-preferences")).toBe('{"version":1,"theme":"sepia"}');
    expect(state.data.get("clio:reading-position")).toBe("epubcfi(/6/2)");
  });

  test("handles missing window/storage, getter permissions, read permissions and failed saves without throwing", () => {
    for (const value of [undefined, {}, { localStorage: undefined }, { localStorage: null },
      { get localStorage(): never { throw new Error("storage getter denied"); } },
      { localStorage: { getItem(): never { throw new Error("storage read denied"); }, setItem(): never { throw new Error("storage write denied"); } } },
    ]) {
      withWindow(value, () => {
        expect(loadRecolorSettings()).toEqual(DEFAULT_RECOLOR_SETTINGS);
        expect(() => saveRecolorSettings(custom)).not.toThrow();
      });
    }
    for (const failure of ["quota exceeded", "permission denied"]) {
      const raw = JSON.stringify(custom);
      withWindow({ localStorage: { getItem: () => raw, setItem(): never { throw new Error(failure); } } }, () => {
        expect(() => saveRecolorSettings(applyPdfTheme(custom, "dark"))).not.toThrow();
        expect(loadRecolorSettings()).toEqual(custom);
        expect(getPdfThemeState(loadRecolorSettings()).effective).toBe("custom");
      });
    }
  });
});

describe("PDF search boundary appearance", () => {
  const luminance = (hex: string) => {
    const channels = parseHexColor(hex).map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return channels[0]! * .2126 + channels[1]! * .7152 + channels[2]! * .0722;
  };
  const contrast = (a: string, b: string) => {
    const low = Math.min(luminance(a), luminance(b));
    const high = Math.max(luminance(a), luminance(b));
    return (high + .05) / (low + .05);
  };
  test("selects a ≥3:1 boundary for all stock surfaces and custom midtone boundaries", () => {
    const settings = [
      ...DOCUMENT_THEMES.map((theme) => applyPdfTheme(custom, theme.id)),
      ...["#757575", "#767676", "#777777", "#00FF00", "#FF00FF", "#FFFF00"].map((background) => ({ ...custom, recolorLightcolor: background })),
    ];
    for (const setting of settings) {
      const background = setting.recolor ? setting.recolorLightcolor : "#FFFFFF";
      const appearance = getPdfSearchAppearance(setting);
      const ratio = contrast(appearance.boundary, background);
      expect(ratio).toBeGreaterThanOrEqual(3);
      expect(ratio).toBeGreaterThanOrEqual(Math.max(contrast("#000000", background), contrast("#FFFFFF", background)) - 1e-9);
    }
  });
  test("Original uses the native white surface, not the disabled saved dark pair or chrome", () => {
    const dark = applyPdfTheme(custom, "dark");
    expect(getPdfSearchAppearance(dark).boundary).toBe("#FFFFFF");
    expect(getPdfSearchAppearance(applyPdfTheme(dark, "original")).boundary).toBe("#000000");
  });
});
