import { normalizeHexColor } from "../pdf/recolor";
import { getPdfThemeState } from "../pdf/appearance";
import { DOCUMENT_THEMES } from "./appearance";
import { themeCommandId } from "./appearanceCommands";
import type { PdfRecolorSettings } from "../pdf/recolor";
import type { ReaderCommandId } from "./interactions";
import type { ViewMode, ZoomState } from "./layout";

export type CommandState = { active: boolean; text: string };
export type ReaderCommandStates = Partial<Record<ReaderCommandId, CommandState>>;

function current(active: boolean): CommandState {
  return { active, text: active ? "Current" : "Not current" };
}

function toggle(active: boolean): CommandState {
  return { active, text: active ? "On" : "Off" };
}

export function getPdfCommandStates(state: {
  viewMode: ViewMode;
  effectiveViewMode: ViewMode;
  zoomMode: ZoomState["mode"];
  continuousScrolling: boolean;
  nightMode: boolean;
  recolorSettings: PdfRecolorSettings;
}): ReaderCommandStates {
  const { viewMode, effectiveViewMode, zoomMode, recolorSettings } = state;
  const singlePageFallback = viewMode === "spread" && effectiveViewMode === "single";
  const fitState = (mode: ZoomState["mode"]): CommandState => zoomMode === "manual"
    ? { active: false, text: "Not current — custom zoom" }
    : current(zoomMode === mode);
  const appearance = getPdfThemeState(recolorSettings);
  const savedLabel = DOCUMENT_THEMES.find((theme) => theme.id === appearance.saved)?.label ?? "Custom colors";
  const effectiveLabel = DOCUMENT_THEMES.find((theme) => theme.id === appearance.effective)?.label ?? "Custom colors";
  const recolorOption = (saved: boolean): CommandState => recolorSettings.recolor
    ? toggle(saved)
    : { active: false, text: saved ? "Saved on — recoloring off" : "Off — recoloring off" };

  const states: ReaderCommandStates = {
    single_page_view: singlePageFallback
      ? { active: true, text: "Displayed — narrow window" }
      : current(effectiveViewMode === "single"),
    two_page_spread: singlePageFallback
      ? { active: false, text: "Requested — single page displayed" }
      : current(effectiveViewMode === "spread"),
    fit_to_page: fitState("fit-page"),
    fit_to_page_width: fitState("fit-width"),
    fit_to_spread: singlePageFallback && zoomMode === "fit-spread"
      ? { active: true, text: "Current — single-page fallback" }
      : fitState("fit-spread"),
    toggle_continuous_scrolling: toggle(state.continuousScrolling),
    toggle_night_mode: toggle(state.nightMode),
    document_appearance: { active: false, text: appearance.effective === "original" ? `Original — saved ${savedLabel}` : `${effectiveLabel}${appearance.advanced ? " — advanced adjustments" : ""}` },
    pdf_advanced_appearance: { active: recolorSettings.recolor && appearance.advanced, text: appearance.advanced ? "Saved advanced adjustments" : "Default adjustments" },
    toggle_recolor: {
      active: recolorSettings.recolor,
      text: recolorSettings.recolor ? `On — ${savedLabel}` : `Off — saved ${savedLabel}`,
    },
    theme_original: current(!recolorSettings.recolor),
    recolor_set_lightcolor: { active: false, text: normalizeHexColor(recolorSettings.recolorLightcolor) },
    recolor_set_darkcolor: { active: false, text: normalizeHexColor(recolorSettings.recolorDarkcolor) },
    recolor_toggle_keephue: recolorOption(recolorSettings.recolorKeephue),
    recolor_toggle_reverse_video: recolorOption(recolorSettings.recolorReverseVideo),
    recolor_toggle_adjust_lightness: recolorOption(recolorSettings.recolorAdjustLightness),
  };

  for (const theme of DOCUMENT_THEMES) {
    if (theme.id === "original") continue;
    states[themeCommandId(theme.id)] = !recolorSettings.recolor && appearance.saved === theme.id
      ? { active: false, text: "Saved — recoloring off" }
      : current(appearance.effective === theme.id);
  }
  return states;
}

export function getEpubCommandStates(layoutMode: "paged" | "continuous"): ReaderCommandStates {
  return {
    paged_layout: current(layoutMode === "paged"),
    continuous_layout: current(layoutMode === "continuous"),
  };
}
