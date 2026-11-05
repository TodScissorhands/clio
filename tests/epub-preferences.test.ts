import { describe, expect, test } from "bun:test";
import { DOCUMENT_THEMES } from "../src/reader/appearance";
import {
  changeEpubFontSize,
  DEFAULT_EPUB_PREFERENCES,
  loadEpubPreferences,
  normalizeEpubPreferences,
  resetEpubTypography,
  saveEpubPreferences,
} from "../src/epub/preferences";
import type { EpubPreferences } from "../src/epub/preferences";

const STORAGE_KEY = "clio:epub-reading-preferences";
const selected: EpubPreferences = {
  version: 1,
  theme: "gruvbox-dark",
  fontFamily: "sans",
  fontScale: 120,
  lineHeight: 1.6,
  alignment: "start",
  margins: "comfortable",
  columnWidth: "narrow",
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

describe("EPUB preference normalization", () => {
  test("defaults to Publisher typography and independent Original colors", () => {
    expect(DEFAULT_EPUB_PREFERENCES).toEqual({
      version: 1,
      theme: "original",
      fontFamily: "publisher",
      fontScale: null,
      lineHeight: null,
      alignment: "publisher",
      margins: "publisher",
      columnWidth: "publisher",
    });
    expect(normalizeEpubPreferences({ version: 1 })).toEqual(DEFAULT_EPUB_PREFERENCES);
    expect(normalizeEpubPreferences(selected)).toEqual(selected);
    expect(normalizeEpubPreferences(selected)).not.toBe(selected);
    expect(normalizeEpubPreferences(null)).not.toBe(DEFAULT_EPUB_PREFERENCES);
  });

  test("requires a nonarray object with its own version 1", () => {
    for (const value of [undefined, null, true, false, 1, "1", [], [selected], {}, { ...selected, version: "1" },
      { ...selected, version: 0 }, { ...selected, version: 2 }, Object.create(selected)]) {
      expect(normalizeEpubPreferences(value)).toEqual(DEFAULT_EPUB_PREFERENCES);
    }
    const inherited = Object.assign(Object.create(selected), { version: 1 });
    expect(normalizeEpubPreferences(inherited)).toEqual(DEFAULT_EPUB_PREFERENCES);
    const noPrototype = Object.assign(Object.create(null), selected);
    expect(normalizeEpubPreferences(noPrototype)).toEqual(selected);
  });

  test("ignores unknown fields without mutating input or retaining them", () => {
    const input = Object.freeze({ ...selected, nativeCfi: "epubcfi(/6/2)", extraCss: "body { display:none }" });
    expect(normalizeEpubPreferences(input)).toEqual(selected);
    expect(input.extraCss).toBe("body { display:none }");
  });

  test("accepts every shared theme and supported enum choice", () => {
    for (const theme of DOCUMENT_THEMES) {
      expect(normalizeEpubPreferences({ ...selected, theme: theme.id }).theme).toBe(theme.id);
    }
    const choices = {
      fontFamily: ["publisher", "serif", "sans"],
      alignment: ["publisher", "start", "justify"],
      margins: ["publisher", "compact", "comfortable", "generous"],
      columnWidth: ["publisher", "narrow", "comfortable", "wide"],
    } as const;
    for (const key of Object.keys(choices) as (keyof typeof choices)[]) {
      for (const value of choices[key]) {
        expect(normalizeEpubPreferences({ ...selected, [key]: value })[key]).toBe(value);
      }
    }
  });

  test("invalid enums fall back only that field, including prototype names and CSS strings", () => {
    const keys = ["theme", "fontFamily", "alignment", "margins", "columnWidth"] as const;
    for (const key of keys) {
      for (const value of [undefined, null, false, 1, {}, [], "", "constructor", "toString", "__proto__",
        "Publisher", "sans-serif", "serif; color: red", "url(https://example.com/font)"]) {
        expect(normalizeEpubPreferences({ ...selected, [key]: value })).toEqual({
          ...selected, [key]: DEFAULT_EPUB_PREFERENCES[key],
        });
      }
    }
  });

  test("font scale accepts only finite 10-point steps from 80 through 200", () => {
    for (let fontScale = 80; fontScale <= 200; fontScale += 10) {
      expect(normalizeEpubPreferences({ ...selected, fontScale }).fontScale).toBe(fontScale);
    }
    for (const fontScale of [null, undefined, NaN, Infinity, -Infinity, -100, 0, 79, 81, 99, 101, 119.999, 201, 210,
      "120", "120%", "120px", true, [], {}]) {
      expect(normalizeEpubPreferences({ ...selected, fontScale })).toEqual({ ...selected, fontScale: null });
    }
  });

  test("line height accepts only the three finite named choices or Publisher", () => {
    for (const lineHeight of [null, 1.35, 1.6, 1.85]) {
      expect(normalizeEpubPreferences({ ...selected, lineHeight }).lineHeight).toBe(lineHeight);
    }
    for (const lineHeight of [undefined, NaN, Infinity, -Infinity, -1, 0, 1, 1.34, 1.35001, 1.5, 1.86, 2,
      "1.6", "160%", true, [], {}]) {
      expect(normalizeEpubPreferences({ ...selected, lineHeight })).toEqual({ ...selected, lineHeight: null });
    }
  });
});

describe("EPUB preference actions", () => {
  test("reset restores only typography and layout, preserving each theme and the input", () => {
    for (const theme of DOCUMENT_THEMES) {
      const input = Object.freeze({ ...selected, theme: theme.id });
      expect(resetEpubTypography(input)).toEqual({ ...DEFAULT_EPUB_PREFERENCES, theme: theme.id });
      expect(input.fontScale).toBe(120);
      expect(input.theme).toBe(theme.id);
    }
  });

  test("font actions start at 100 for Publisher and change only font scale", () => {
    const publisher = Object.freeze({ ...selected, fontScale: null });
    expect(changeEpubFontSize(publisher, 1)).toEqual({ ...selected, fontScale: 110 });
    expect(changeEpubFontSize(publisher, -1)).toEqual({ ...selected, fontScale: 90 });
    expect(changeEpubFontSize(selected, 1)).toEqual({ ...selected, fontScale: 130 });
    expect(changeEpubFontSize(selected, -1)).toEqual({ ...selected, fontScale: 110 });
    expect(publisher.fontScale).toBeNull();
    expect(selected.fontScale).toBe(120);
  });

  test("font actions clamp at both endpoints and remain normalized through repeated changes", () => {
    let preferences = { ...selected };
    for (let count = 0; count < 30; count += 1) {
      preferences = changeEpubFontSize(preferences, 1);
      expect(normalizeEpubPreferences(preferences)).toEqual(preferences);
    }
    expect(preferences.fontScale).toBe(200);
    expect(changeEpubFontSize(preferences, -1).fontScale).toBe(190);
    for (let count = 0; count < 30; count += 1) preferences = changeEpubFontSize(preferences, -1);
    expect(preferences.fontScale).toBe(80);
    expect(changeEpubFontSize(preferences, 1).fontScale).toBe(90);
    expect(preferences).toEqual({ ...selected, fontScale: 80 });
  });
});

describe("EPUB preference persistence", () => {
  test("roundtrips through its global key without writing unrelated position storage", () => {
    const state = memoryStorage();
    state.data.set("clio:reading-position", "epubcfi(/6/2)");
    withWindow({ localStorage: state.storage }, () => {
      expect(loadEpubPreferences()).toEqual(DEFAULT_EPUB_PREFERENCES);
      expect(state.writes).toHaveLength(0);
      expect(saveEpubPreferences(selected)).toBe(true);
      expect(state.writes).toEqual([[STORAGE_KEY, JSON.stringify(selected)]]);
      expect(loadEpubPreferences()).toEqual(selected);
      expect(state.reads).toEqual([STORAGE_KEY, STORAGE_KEY]);
      expect(state.data.get("clio:reading-position")).toBe("epubcfi(/6/2)");
    });
  });

  test("loads malformed, absent and unsupported data neutrally without rewriting it", () => {
    for (const raw of [undefined, "", "{", "null", "[]", "42", JSON.stringify({ ...selected, version: 2 }),
      JSON.stringify({ ...selected, version: "1" })]) {
      const state = memoryStorage(raw);
      withWindow({ localStorage: state.storage }, () => {
        expect(loadEpubPreferences()).toEqual(DEFAULT_EPUB_PREFERENCES);
        expect(state.writes).toHaveLength(0);
        expect(state.data.get(STORAGE_KEY)).toBe(raw);
      });
    }
  });

  test("loads valid fields independently and saves only normalized supported fields", () => {
    const state = memoryStorage(JSON.stringify({ ...selected, fontScale: 125, lineHeight: "1.6", theme: "unknown", unknown: true }));
    withWindow({ localStorage: state.storage }, () => {
      const loaded = loadEpubPreferences();
      expect(loaded).toEqual({ ...selected, fontScale: null, lineHeight: null, theme: "original" });
      expect(state.writes).toHaveLength(0);
      expect(saveEpubPreferences(loaded)).toBe(true);
      expect(JSON.parse(state.data.get(STORAGE_KEY)!)).toEqual(loaded);
      const withUnknownField = { ...selected, unknown: true };
      expect(saveEpubPreferences(withUnknownField)).toBe(true);
      expect(JSON.parse(state.data.get(STORAGE_KEY)!)).toEqual(selected);
    });
  });

  test("handles missing window and unavailable storage without throwing", () => {
    withWindow(undefined, () => {
      expect(loadEpubPreferences()).toEqual(DEFAULT_EPUB_PREFERENCES);
      expect(saveEpubPreferences(selected)).toBe(false);
    });
    for (const localStorage of [undefined, null]) {
      withWindow({ localStorage }, () => {
        expect(loadEpubPreferences()).toEqual(DEFAULT_EPUB_PREFERENCES);
        expect(saveEpubPreferences(selected)).toBe(false);
      });
    }
  });

  test("catches localStorage getter security exceptions", () => {
    withWindow({ get localStorage(): Storage { throw new Error("storage denied"); } }, () => {
      expect(loadEpubPreferences()).toEqual(DEFAULT_EPUB_PREFERENCES);
      expect(saveEpubPreferences(selected)).toBe(false);
    });
  });

  test("catches read and quota exceptions and leaves preferences usable in memory", () => {
    const original = { ...selected };
    const localStorage = {
      getItem(): never { throw new Error("read denied"); },
      setItem(): never { throw new Error("quota exceeded"); },
    };
    withWindow({ localStorage }, () => {
      expect(loadEpubPreferences()).toEqual(DEFAULT_EPUB_PREFERENCES);
      expect(saveEpubPreferences(selected)).toBe(false);
      expect(loadEpubPreferences()).toEqual(selected);
      expect(selected).toEqual(original);
      expect(changeEpubFontSize(selected, 1).fontScale).toBe(130);
      expect(resetEpubTypography(selected).theme).toBe(selected.theme);
    });
  });

  test("a failed save survives a new reader load and retires after storage recovers", () => {
    let full = true;
    let value: string | null = null;
    withWindow({ localStorage: {
      getItem() { return value; },
      setItem(_key: string, next: string) {
        if (full) throw new Error("quota exceeded");
        value = next;
      },
    } }, () => {
      expect(saveEpubPreferences(selected)).toBe(false);
      expect(loadEpubPreferences()).toEqual(selected);
      full = false;
      const next = changeEpubFontSize(selected, 1);
      expect(saveEpubPreferences(next)).toBe(true);
      expect(loadEpubPreferences()).toEqual(next);
      value = JSON.stringify(DEFAULT_EPUB_PREFERENCES);
      expect(loadEpubPreferences()).toEqual(DEFAULT_EPUB_PREFERENCES);
    });
  });
});
