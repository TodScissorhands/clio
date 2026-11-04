import { normalizeHexColor, RECOLOR_PRESETS } from "../pdf/recolor";
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
  const preset = RECOLOR_PRESETS[recolorSettings.activePreset];
  const lightColor = normalizeHexColor(recolorSettings.recolorLightcolor);
  const darkColor = normalizeHexColor(recolorSettings.recolorDarkcolor);
  const matchingStock = preset.id !== "original" && preset.id !== "custom" &&
    lightColor === preset.lightColor && darkColor === preset.darkColor;
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
    toggle_recolor: {
      active: recolorSettings.recolor,
      text: !recolorSettings.recolor ? "Off"
        : matchingStock ? `On — ${preset.label}` : "On — custom colors",
    },
    recolor_preset_original: current(!recolorSettings.recolor),
    recolor_toggle_keephue: recolorOption(recolorSettings.recolorKeephue),
    recolor_toggle_reverse_video: recolorOption(recolorSettings.recolorReverseVideo),
    recolor_toggle_adjust_lightness: recolorOption(recolorSettings.recolorAdjustLightness),
  };

  for (const stock of Object.values(RECOLOR_PRESETS)) {
    if (stock.id === "original" || stock.id === "custom") continue;
    const matches = matchingStock && preset.id === stock.id;
    const commandId = `recolor_preset_${stock.id.replace(/-/g, "_")}` as ReaderCommandId;
    states[commandId] = !recolorSettings.recolor && matches
      ? { active: false, text: "Saved — recoloring off" }
      : current(recolorSettings.recolor && matches);
  }
  return states;
}

export function getEpubCommandStates(layoutMode: "paged" | "continuous"): ReaderCommandStates {
  return {
    paged_layout: current(layoutMode === "paged"),
    continuous_layout: current(layoutMode === "continuous"),
  };
}
