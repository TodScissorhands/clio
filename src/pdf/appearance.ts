import { DOCUMENT_THEMES } from "../reader/appearance";
import type { ReaderThemeId } from "../reader/appearance";
import { isValidHexColor, normalizeHexColor, RECOLOR_PRESETS } from "./recolor";
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
