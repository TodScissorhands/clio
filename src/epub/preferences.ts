import { DOCUMENT_THEMES } from "../reader/appearance";
import type { ReaderThemeId } from "../reader/appearance";

export type EpubPreferences = {
  version: 1;
  theme: ReaderThemeId;
  fontFamily: "publisher" | "serif" | "sans";
  fontScale: number | null;
  lineHeight: number | null;
  alignment: "publisher" | "start" | "justify";
  margins: "publisher" | "compact" | "comfortable" | "generous";
  columnWidth: "publisher" | "narrow" | "comfortable" | "wide";
};

export const DEFAULT_EPUB_PREFERENCES: EpubPreferences = {
  version: 1,
  theme: "original",
  fontFamily: "publisher",
  fontScale: null,
  lineHeight: null,
  alignment: "publisher",
  margins: "publisher",
  columnWidth: "publisher",
};

const STORAGE_KEY = "clio:epub-reading-preferences";
// Keep failed saves across reader close/replacement within this host session.
// A successful save retires the fallback; positions never enter this cache.
const unsavedPreferences = new WeakMap<object, EpubPreferences>();

function isChoice<T extends string>(value: unknown, choices: readonly T[]): value is T {
  return typeof value === "string" && choices.some((choice) => choice === value);
}

export function normalizeEpubPreferences(input: unknown): EpubPreferences {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ...DEFAULT_EPUB_PREFERENCES };
  }
  const value = input as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(value, "version") || value.version !== 1) {
    return { ...DEFAULT_EPUB_PREFERENCES };
  }
  const field = (key: keyof EpubPreferences): unknown => Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined;
  const theme = field("theme");
  const fontFamily = field("fontFamily");
  const fontScale = field("fontScale");
  const lineHeight = field("lineHeight");
  const alignment = field("alignment");
  const margins = field("margins");
  const columnWidth = field("columnWidth");

  return {
    version: 1,
    theme: typeof theme === "string" && DOCUMENT_THEMES.some((choice) => choice.id === theme)
      ? theme as ReaderThemeId : DEFAULT_EPUB_PREFERENCES.theme,
    fontFamily: isChoice(fontFamily, ["publisher", "serif", "sans"])
      ? fontFamily : DEFAULT_EPUB_PREFERENCES.fontFamily,
    fontScale: typeof fontScale === "number" && Number.isFinite(fontScale)
      && fontScale >= 80 && fontScale <= 200 && fontScale % 10 === 0
      ? fontScale : DEFAULT_EPUB_PREFERENCES.fontScale,
    lineHeight: typeof lineHeight === "number" && Number.isFinite(lineHeight)
      && (lineHeight === 1.35 || lineHeight === 1.6 || lineHeight === 1.85)
      ? lineHeight : DEFAULT_EPUB_PREFERENCES.lineHeight,
    alignment: isChoice(alignment, ["publisher", "start", "justify"])
      ? alignment : DEFAULT_EPUB_PREFERENCES.alignment,
    margins: isChoice(margins, ["publisher", "compact", "comfortable", "generous"])
      ? margins : DEFAULT_EPUB_PREFERENCES.margins,
    columnWidth: isChoice(columnWidth, ["publisher", "narrow", "comfortable", "wide"])
      ? columnWidth : DEFAULT_EPUB_PREFERENCES.columnWidth,
  };
}

export function loadEpubPreferences(): EpubPreferences {
  try {
    if (typeof window === "undefined") return { ...DEFAULT_EPUB_PREFERENCES };
    const unsaved = unsavedPreferences.get(window);
    if (unsaved) return { ...unsaved };
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === null ? { ...DEFAULT_EPUB_PREFERENCES } : normalizeEpubPreferences(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_EPUB_PREFERENCES };
  }
}

export function saveEpubPreferences(preferences: EpubPreferences): boolean {
  try {
    if (typeof window === "undefined") return false;
    const normalized = normalizeEpubPreferences(preferences);
    unsavedPreferences.set(window, normalized);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    unsavedPreferences.delete(window);
    return true;
  } catch {
    return false;
  }
}

export function resetEpubTypography(preferences: EpubPreferences): EpubPreferences {
  return { ...DEFAULT_EPUB_PREFERENCES, theme: preferences.theme };
}

export function changeEpubFontSize(preferences: EpubPreferences, direction: -1 | 1): EpubPreferences {
  return { ...preferences, fontScale: Math.min(200, Math.max(80, (preferences.fontScale ?? 100) + direction * 10)) };
}
