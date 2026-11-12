import { DOCUMENT_THEMES } from "../reader/appearance";
import type { ReaderThemeId } from "../reader/appearance";
import { isValidHexColor, normalizeHexColor, parseHexColor, RECOLOR_PRESETS } from "./recolor";
import type { PdfRecolorSettings } from "./recolor";

export function applyPdfTheme(settings: PdfRecolorSettings, theme: ReaderThemeId): PdfRecolorSettings {
  if (theme === "original") return { ...settings, recolor: false };
  const preset = RECOLOR_PRESETS[theme === "sepia" ? "sepia-warm" : theme];
  return {
    ...settings,
    recolor: true,
    activePreset: preset.id,
    recolorLightcolor: preset.lightColor,
    recolorDarkcolor: preset.darkColor,
  };
}

export function getPdfThemeState(settings: PdfRecolorSettings): {
  effective: ReaderThemeId | "custom";
  saved: ReaderThemeId | "custom";
  advanced: boolean;
} {
  const retainedId = settings.activePreset === "sepia-warm" ? "sepia" : settings.activePreset;
  const theme = DOCUMENT_THEMES.find((candidate) => candidate.id === retainedId);
  // A color match alone cannot recover an identity lost by legacy Original selections.
  const saved = theme && theme.id !== "original"
    && isValidHexColor(settings.recolorLightcolor) && isValidHexColor(settings.recolorDarkcolor)
    && normalizeHexColor(settings.recolorLightcolor) === theme.background
    && normalizeHexColor(settings.recolorDarkcolor) === theme.foreground
    ? theme.id : "custom";
  return {
    effective: settings.recolor ? saved : "original",
    saved,
    advanced: settings.recolorKeephue || settings.recolorReverseVideo || settings.recolorAdjustLightness,
  };
}

/** Higher-contrast boundary on a uniform effective page; image content can vary. */
export function getPdfSearchAppearance(settings: PdfRecolorSettings): { boundary: string } {
  const [r, g, b] = parseHexColor(settings.recolor ? settings.recolorLightcolor : "#FFFFFF");
  const linear = (channel: number) => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
  const luminance = linear(r) * .2126 + linear(g) * .7152 + linear(b) * .0722;
  const darkBoundary = (luminance + .05) / .05 >= 1.05 / (luminance + .05);
  return { boundary: darkBoundary ? "#000000" : "#FFFFFF" };
}
