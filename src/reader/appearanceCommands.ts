import { DOCUMENT_THEMES } from "./appearance";
import type { ReaderThemeId } from "./appearance";
import type { ReaderCommand, ReaderCommandId, ReaderKind } from "./interactions";
import { changeEpubFontSize, normalizeEpubPreferences, resetEpubTypography } from "../epub/preferences";
import type { EpubPreferences } from "../epub/preferences";

export function themeCommandId(theme: ReaderThemeId): ReaderCommandId {
  return `theme_${theme.replace(/-/g, "_")}` as ReaderCommandId;
}

export function commandTheme(id: ReaderCommandId): ReaderThemeId | null {
  return DOCUMENT_THEMES.find((theme) => themeCommandId(theme.id) === id)?.id ?? null;
}

export function themeCommands(
  scope: ReaderKind,
  effective: ReaderThemeId | "custom",
  saved: ReaderThemeId | "custom" = effective,
  unapplied = "Saved — document colors off",
): ReaderCommand[] {
  return [
    { id: "back_to_commands", scope, shortcut: "", label: "Back to commands" },
    ...DOCUMENT_THEMES.map((theme): ReaderCommand => ({
      id: themeCommandId(theme.id), scope, label: theme.label, shortcut: "",
      state: { active: effective === theme.id, text: effective === theme.id ? "Current" : saved === theme.id ? unapplied : "Not current" },
    })),
  ];
}

type PreferenceField = "fontFamily" | "lineHeight" | "alignment" | "margins" | "columnWidth";
export type EpubPreferenceField = "fontScale" | PreferenceField;
const groups: { field: PreferenceField; id: ReaderCommandId; label: string; options: readonly (readonly [string, string])[] }[] = [
  { field: "fontFamily", id: "epub_set_font_family", label: "Font", options: [["publisher", "Publisher"], ["serif", "Serif"], ["sans", "Sans"]] },
  { field: "lineHeight", id: "epub_set_line_height", label: "Line spacing", options: [["publisher", "Publisher"], ["1.35", "Compact"], ["1.6", "Comfortable"], ["1.85", "Relaxed"]] },
  { field: "alignment", id: "epub_set_alignment", label: "Alignment", options: [["publisher", "Publisher"], ["start", "Start"], ["justify", "Justify"]] },
  { field: "margins", id: "epub_set_margins", label: "Margins", options: [["publisher", "Publisher"], ["compact", "Compact"], ["comfortable", "Comfortable"], ["generous", "Generous"]] },
  { field: "columnWidth", id: "epub_set_column_width", label: "Reading column", options: [["publisher", "Publisher"], ["narrow", "Narrow"], ["comfortable", "Comfortable"], ["wide", "Wide"]] },
];

function preferenceValue(preferences: EpubPreferences, field: EpubPreferenceField): string {
  if (field === "fontScale") return preferences.fontScale === null ? "Publisher" : `${preferences.fontScale}%`;
  const group = groups.find((entry) => entry.field === field)!;
  return group.options.find(([value]) => value === String(preferences[field] ?? "publisher"))![1];
}

function preferenceSummary(requested: EpubPreferences, applied: EpubPreferences, field: EpubPreferenceField, retained: string): string {
  const effective = preferenceValue(applied, field);
  const saved = preferenceValue(requested, field);
  if (retained) return `Publisher retained — saved choice: ${saved}: ${retained}`;
  return effective === saved ? effective : `${effective} — requested: ${saved}, waiting for layout`;
}

export function epubPreferenceMenuCommands(requested: EpubPreferences, applied: EpubPreferences, retained = ""): ReaderCommand[] {
  const fields: { field: EpubPreferenceField; label: string }[] = [
    { field: "fontScale", label: "Text size" }, ...groups,
  ];
  return [
    { id: "back_to_commands", scope: "epub", shortcut: "", label: "Back to commands" },
    ...fields.map(({ field, label }): ReaderCommand => ({
      id: "epub_preference_field", key: `epub_preference_field:${field}`, value: field,
      scope: "epub", shortcut: "", label: `${label}…`,
      state: { active: false, text: preferenceSummary(requested, applied, field, retained) },
    })),
    { id: "epub_reset_typography", scope: "epub", shortcut: "", label: "Reset typography and layout to Publisher" },
  ];
}

/** Omit field for the qualified root search catalog; field choosers remain local. */
export function epubPreferenceCommands(requested: EpubPreferences, applied: EpubPreferences, retained = "", field?: EpubPreferenceField): ReaderCommand[] {
  const state = (selected: boolean, current: boolean) => ({
    active: current && !retained,
    text: retained ? `${current ? "Publisher retained" : "Not applied"}${selected ? " — saved choice" : ""}: ${retained}`
      : current ? "Current" : selected ? "Requested — waiting for layout" : "Not current",
  });
  const size = preferenceSummary(requested, applied, "fontScale", retained);
  const choices: ReaderCommand[] = field === "fontScale" || !field ? [
    { id: "epub_size_publisher", scope: "epub", shortcut: "", label: "Text size: Publisher", state: state(requested.fontScale === null, applied.fontScale === null) },
    { id: "epub_text_smaller", scope: "epub", shortcut: "", label: "Text size: Smaller", state: { active: false, text: `Text size: ${size}` }, disabled: requested.fontScale === 80 },
    { id: "epub_text_larger", scope: "epub", shortcut: "", label: "Text size: Larger", state: { active: false, text: `Text size: ${size}` }, disabled: requested.fontScale === 200 },
  ] : [];
  choices.push(...groups.filter((group) => !field || group.field === field)
    .flatMap((group) => group.options.map(([value, label]): ReaderCommand => ({
      id: group.id, key: `${group.id}:${value}`, value, scope: "epub", shortcut: "", label: `${group.label}: ${label}`,
      state: state(String(requested[group.field] ?? "publisher") === value, String(applied[group.field] ?? "publisher") === value),
    }))));
  if (field) return [
    { id: "back_to_preferences", scope: "epub", shortcut: "", label: "Back to Reading preferences" },
    ...choices,
  ];
  return [
    ...choices,
    { id: "epub_reset_typography", scope: "epub", shortcut: "", label: "Reset typography and layout to Publisher" },
  ];
}

export function applyEpubPreferenceCommand(preferences: EpubPreferences, command: ReaderCommand): EpubPreferences | null {
  if (command.disabled) return null;
  switch (command.id) {
    case "epub_reset_typography": return resetEpubTypography(preferences);
    case "epub_size_publisher": return { ...preferences, fontScale: null };
    case "epub_text_smaller": return changeEpubFontSize(preferences, -1);
    case "epub_text_larger": return changeEpubFontSize(preferences, 1);
  }
  const group = groups.find((entry) => entry.id === command.id);
  if (!group || !group.options.some(([value]) => value === command.value)) return null;
  const value = group.field === "lineHeight" ? command.value === "publisher" ? null : Number(command.value) : command.value;
  return normalizeEpubPreferences({ ...preferences, [group.field]: value });
}

/** Root searches include leaf choices, while each chooser remains locally scoped. */
export function searchableReaderCommands(root: ReaderCommand[], catalogs: ReaderCommand[][], query: string): ReaderCommand[] {
  if (!query.trim()) return root;
  const seen = new Set<string>();
  return [...root, ...catalogs.flat()].filter((command) => {
    if (command.id === "back_to_commands" || command.id === "back_to_preferences") return false;
    const key = command.key ?? command.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((command) => command.id.startsWith("theme_")
    ? { ...command, label: `Document theme: ${command.label}` } : command);
}

export function pdfAdvancedAppearanceCommands(): ReaderCommand[] {
  return [
    { id: "back_to_commands", shortcut: "", label: "Back to commands" },
    { id: "toggle_recolor", shortcut: "r", label: "Toggle saved document colors" },
    { id: "recolor_toggle_keephue", shortcut: "", label: "Toggle hue preservation (recolor-keephue)" },
    { id: "recolor_toggle_reverse_video", shortcut: "", label: "Toggle image preservation (recolor-reverse-video)" },
    { id: "recolor_toggle_adjust_lightness", shortcut: "", label: "Toggle lightness adjustment (recolor-adjust-lightness)" },
    { id: "recolor_set_lightcolor", shortcut: "", label: "Set recolor background color (hex)…" },
    { id: "recolor_set_darkcolor", shortcut: "", label: "Set recolor foreground color (hex)…" },
  ];
}
