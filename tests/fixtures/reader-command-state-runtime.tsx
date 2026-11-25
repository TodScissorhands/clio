import { indexFilter, indexClose, indexBack } from "./index-driver";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "../../src/App";
import { EPUB_READER_COMMANDS, READER_COMMANDS } from "../../src/reader/interactions";
import type { ReaderCommandId } from "../../src/reader/interactions";
import { DEFAULT_RECOLOR_SETTINGS, RECOLOR_PRESETS } from "../../src/pdf/recolor";
import type { PdfRecolorSettings } from "../../src/pdf/recolor";
import { epubPreferenceCommands, pdfAdvancedAppearanceCommands, themeCommands } from "../../src/reader/appearanceCommands";
import { DEFAULT_EPUB_PREFERENCES } from "../../src/epub/preferences";
import { epubDocument, epubText, foliateView } from "./foliate-test-reader";
import "../../src/index.css";

declare global {
  interface Window {
    webkit: { messageHandlers: { test: { postMessage: (value: string) => void } } };
  }
}

const bridge = (message: object) => window.webkit.messageHandlers.test.postMessage(JSON.stringify(message));
const check = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};
const settle = () => {
  const { promise, resolve } = Promise.withResolvers<void>();
  requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  return promise;
};
async function until(predicate: () => unknown, message: string) {
  const deadline = performance.now() + 12_000;
  while (!predicate()) {
    check(performance.now() < deadline, message);
    await settle();
  }
  await settle();
}
function dispatchKey(value: string, init: KeyboardEventInit = {}) {
  document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...init }));
  document.activeElement!.dispatchEvent(new KeyboardEvent("keyup", { key: value, bubbles: true, ...init }));
}
async function key(value: string, init: KeyboardEventInit = {}) {
  dispatchKey(value, init);
  await settle();
}
async function resize(width: number, height: number) {
  bridge({ resize: [width, height], scale: devicePixelRatio });
  await until(() => innerWidth === width && innerHeight === height, `viewport did not resize to ${width}x${height}`);
}
async function value(input: HTMLInputElement, text: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await settle();
}
async function openFile(name: string) {
  const bytes = await (await fetch(`/__fixtures/${name}`)).arrayBuffer();
  const files = new DataTransfer();
  files.items.add(new File([bytes], name));
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  input.files = files.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await settle();
}
const rows = () => [...document.querySelectorAll<HTMLElement>('.command-list [role="option"]')];
const filter = () => document.querySelector<HTMLInputElement>(".command-filter")!;
const night = () => document.querySelector<HTMLElement>(".clio-app")!.dataset.nightMode === "true";
const storageKey = "clio:pdf-recolor-settings";
const savedSettings = () => JSON.parse(localStorage.getItem(storageKey)!) as PdfRecolorSettings;
const stockIds = ["light", "dark", "zathura-dark", "gruvbox-dark", "solarized-dark", "rose-pine-dawn", "sepia-warm"] as const;
const stockCommand = (id: typeof stockIds[number]) => `theme_${id === "sepia-warm" ? "sepia" : id.replaceAll("-", "_")}` as ReaderCommandId;
const optionCommands = [
  ["recolor_toggle_keephue", "recolorKeephue"],
  ["recolor_toggle_reverse_video", "recolorReverseVideo"],
  ["recolor_toggle_adjust_lightness", "recolorAdjustLightness"],
] as const;
const fits = ["fit_to_page", "fit_to_page_width", "fit_to_spread"] as const;
function row(id: ReaderCommandId) {
  const epub = !!foliateView();
  const definitions = epub ? [
    ...EPUB_READER_COMMANDS,
    ...themeCommands("epub", "original"),
    ...epubPreferenceCommands(DEFAULT_EPUB_PREFERENCES, DEFAULT_EPUB_PREFERENCES),
  ] : [...READER_COMMANDS, ...themeCommands("pdf", "original"), ...pdfAdvancedAppearanceCommands()];
  const definition = definitions.find((command) => command.id === id)!;
  const label = epub && (id === "next_page" || id === "previous_page") &&
    foliateView()!.renderer.getAttribute("flow") === "scrolled"
    ? id === "next_page" ? "Next screen" : "Previous screen" : definition.label;
  const result = rows().find((candidate) => {
    const text = candidate.querySelector(".command-label")?.textContent;
    return text === label || id.startsWith("theme_") && text === `Document theme: ${label}`;
  });
  check(result, `missing production command row: ${id}`);
  return result!;
}
function stateText(id: ReaderCommandId) {
  return row(id).querySelector(".command-state-text")?.textContent?.trim() ?? "";
}
function isCurrent(id: ReaderCommandId) {
  return row(id).hasAttribute("data-applied");
}
function state(id: ReaderCommandId, active: boolean, ...meaning: RegExp[]) {
  const option = row(id);
  const description = option.querySelector<HTMLElement>(".command-state");
  check(description && option.getAttribute("aria-describedby") === description.id, `${id} lacks its accessible setting description`);
  check(isCurrent(id) === active, `${id} has the wrong application-state mark: ${description!.textContent}`);
  const text = stateText(id);
  check(meaning.every((pattern) => pattern.test(text)), `${id} lacks semantic setting feedback: ${text}`);
  check(!option.hasAttribute("aria-checked"), `${id} conflates command options with checkbox state`);
  return text;
}
function noStockCurrent() {
  for (const id of stockIds) state(stockCommand(id), false);
}
async function openPalette(query = "") {
  if (!document.querySelector(".command-filter")) {
    await key(":", { shiftKey: true, code: "Semicolon" });
    await until(() => document.querySelector(".command-palette"), "Index did not open");
    await indexFilter();
    await until(() => document.querySelector(".command-filter"), "command palette did not open");
  }
  if (filter().value !== query) await value(filter(), query);
  check(document.activeElement === filter(), "palette filter lost its single-focus model");
}
async function closePalette() {
  await indexClose();
  await until(() => !document.querySelector(".command-palette"), "palette did not dismiss");
  const label = foliateView() ? "EPUB reading area" : "PDF reading area";
  check(document.activeElement?.getAttribute("aria-label") === label, `palette did not restore ${label} focus`);
}
async function execute(id: ReaderCommandId, pointer = false) {
  if (id === "back_to_commands") { await indexBack(); return; }
  const currentChooser = filter()?.getAttribute("aria-label");
  const sameChooser = currentChooser === "Filter document themes" && id.startsWith("theme_") ||
    currentChooser === "Filter advanced PDF appearance" && (id === "toggle_recolor" || id.startsWith("recolor_")) ||
    currentChooser === "Filter reading preferences" && id.startsWith("epub_") && id !== "epub_reading_preferences";
  if (currentChooser && currentChooser !== "Filter commands" && id !== "back_to_commands" && !sameChooser) {
    await execute("back_to_commands");
  }
  await openPalette(id);
  const executionFilter = filter();
  const executionQuery = executionFilter.value;
  const target = row(id);
  if (pointer) {
    const bounds = target.getBoundingClientRect();
    const init = { bubbles: true, cancelable: true, clientX: bounds.left + 8, clientY: bounds.top + bounds.height / 2, button: 0 };
    target.dispatchEvent(new MouseEvent("mousedown", init));
    check(document.activeElement === filter(), "pointer press moved focus out of the filter");
    target.dispatchEvent(new MouseEvent("mouseup", init));
    target.dispatchEvent(new MouseEvent("click", init));
    await settle();
  } else {
    // Deterministic substring aliases can return multiple actions (fit_to_page also finds width).
    const selectedIndex = rows().findIndex((option) => option.id === filter().getAttribute("aria-activedescendant"));
    const offset = rows().indexOf(target) - selectedIndex;
    for (let index = 0; index < Math.abs(offset); index++) await key(offset < 0 ? "ArrowUp" : "ArrowDown");
    check(selectedVisible() === target, "filtered keyboard execution disagrees with the target option");
    await key("Enter");
  }
  if (id === "go_to_chapter") {
    await until(() => filter()?.getAttribute("aria-label") === "Filter chapters", "chapter command did not enter destination mode");
    return;
  }
  if (id === "document_appearance" || id === "pdf_advanced_appearance" || id === "epub_reading_preferences" || id === "back_to_commands") {
    const label = id === "document_appearance" ? "Filter document themes" : id === "pdf_advanced_appearance"
      ? "Filter advanced PDF appearance" : id === "epub_reading_preferences" ? "Filter reading preferences" : "Filter commands";
    await until(() => filter()?.getAttribute("aria-label") === label, `${id} did not enter its command chooser`);
    check(filter().value === "" && document.activeElement === filter(), `${id} failed to reset and focus its chooser filter`);
    return;
  }
  if (id.startsWith("theme_") || id === "toggle_recolor" || id.startsWith("recolor_toggle_") ||
      id.startsWith("epub_") && id !== "epub_reading_preferences") {
    check(filter() === executionFilter && filter().value === executionQuery && document.activeElement === executionFilter,
      `${id} did not retain its chooser and focused filter`);
    return;
  }
  await until(() => !document.querySelector(".command-palette"), `${id} did not execute and close the palette`);
  if (id !== "recolor_set_lightcolor" && id !== "recolor_set_darkcolor" && id !== "close_document") {
    const label = document.querySelector(".foliate-reader") ? "EPUB reading area" : "PDF reading area";
    check(document.activeElement?.getAttribute("aria-label") === label, `${id} failed to restore reader focus after execution`);
  }
}
async function excludedStatusWords(words: string[]) {
  await openPalette();
  for (const word of words) {
    await value(filter(), word);
    check(rows().length === 0 && document.querySelector('[role="status"].command-empty'), `status-only phrase leaked into command filtering: ${word}`);
    check(!filter().hasAttribute("aria-activedescendant"), "empty filter references a nonexistent option");
    await key("Enter");
    check(!!document.querySelector(".command-palette"), "Enter executed a command from an empty result set");
  }
  await value(filter(), "");
}
function selectedVisible() {
  const selected = document.getElementById((filter() ?? document.querySelector(".command-list")!).getAttribute("aria-activedescendant")!)!;
  check(selected?.getAttribute("aria-selected") === "true", "combobox does not identify its selected command");
  check(rows().filter((candidate) => candidate.getAttribute("aria-selected") === "true").length === 1, "keyboard selection is not singular");
  const list = document.querySelector<HTMLElement>(".command-list")!;
  const bounds = selected.getBoundingClientRect();
  const clip = list.getBoundingClientRect();
  check(bounds.top >= clip.top - 1 && bounds.bottom <= clip.bottom + 1,
    `active command is outside its list: ${JSON.stringify({ label: selected.querySelector(".command-label")?.textContent, rowTop: bounds.top, rowBottom: bounds.bottom, listTop: clip.top, listBottom: clip.bottom, scrollTop: list.scrollTop, clientHeight: list.clientHeight })}`);
  return selected;
}
function settingContrast(option: HTMLElement) {
  const channels = (color: string) => color.match(/[\d.]+/g)!.map(Number);
  const palette = channels(getComputedStyle(document.querySelector(".command-palette")!).backgroundColor);
  const row = channels(getComputedStyle(option).backgroundColor);
  const alpha = row[3] ?? 1;
  const background = row.slice(0, 3).map((value, index) => value * alpha + palette[index]! * (1 - alpha));
  const foreground = channels(getComputedStyle(option.querySelector(".command-state")!).color).slice(0, 3);
  const luminance = (rgb: number[]) => rgb.map((value) => {
    const channel = value / 255;
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
  }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index]!, 0);
  const [low, high] = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
  return (high! + .05) / (low! + .05);
}
function paletteLayout() {
  const palette = document.querySelector<HTMLElement>(".command-palette")!;
  const list = document.querySelector<HTMLElement>(".command-list")!;
  const bounds = palette.getBoundingClientRect();
  check(bounds.left >= -1 && bounds.top >= -1 && bounds.right <= innerWidth + 1 && bounds.bottom <= innerHeight + 1,
    "palette escapes the viewport");
  check(list.scrollWidth <= list.clientWidth + 1, "setting descriptions cause horizontal list overflow");
  let describedSettings = 0;
  let wrappedLabels = 0;
  for (const option of rows()) {
    const rect = option.getBoundingClientRect();
    const content = option.querySelector<HTMLElement>(".command-content")!;
    const label = option.querySelector<HTMLElement>(".command-label")!;
    const shortcut = option.querySelector<HTMLElement>(".command-shortcut")!;
    check(content && label && shortcut, "command content no longer separates label, state and shortcut");
    const labelledBy = option.getAttribute("aria-labelledby")?.split(/\s+/) ?? [];
    check(labelledBy.includes(label.id) && labelledBy.includes(shortcut.id) &&
      labelledBy.every((id) => document.getElementById(id)), "accessible command name omits its label or shortcut");
    check(!option.querySelector("button, input, a, [tabindex]"), "setting descriptions introduced a focusable row descendant");
    check(rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1, "command row exceeds palette width");
    for (const child of [content, label, shortcut]) {
      const childRect = child.getBoundingClientRect();
      check(childRect.left >= rect.left - 1 && childRect.right <= rect.right + 1, "command content or shortcut escapes its row");
      check(childRect.top >= rect.top - 1 && childRect.bottom <= rect.bottom + 1, "wrapped command escapes vertically");
      check(child.scrollWidth <= child.clientWidth + 1, "command text is clipped instead of wrapping");
      check(child.scrollHeight <= child.clientHeight + 1, "wrapped command text is clipped vertically");
    }
    const contentRect = content.getBoundingClientRect();
    const shortcutRect = shortcut.getBoundingClientRect();
    check(contentRect.right <= shortcutRect.left + 1, "setting content overlaps its separate shortcut column");
    const range = document.createRange();
    range.selectNodeContents(label);
    if (range.getClientRects().length > 1) wrappedLabels += 1;
    const description = option.querySelector<HTMLElement>(".command-state");
    if (description) {
      describedSettings += 1;
      check(option.getAttribute("aria-describedby") === description.id && !labelledBy.includes(description.id),
        "setting is not exposed separately from the accessible command name");
      check(description.textContent?.trim() && getComputedStyle(description).clipPath === "inset(50%)",
        "full setting description must remain accessible without visible subtext");
      check(settingContrast(option) >= 4.5, "setting description does not meet small-text contrast");
    } else {
      check(!option.hasAttribute("aria-describedby"), "one-shot command has a spurious setting description");
    }
    check(!option.hasAttribute("aria-checked"), "command row gained checkbox semantics");
  }
  return { describedSettings, wrappedLabels, rows: rows().length };
}
async function modalAndSelection(originalPage: string) {
  await openPalette();
  const input = filter();
  check(document.querySelector('.command-palette[role="dialog"][aria-modal="true"]'), "inherited modal dialog semantics regressed");
  check(input.getAttribute("role") === "combobox" && input.getAttribute("aria-expanded") === "true", "inherited combobox semantics regressed");
  check(document.getElementById(input.getAttribute("aria-controls")!)?.getAttribute("role") === "listbox", "combobox lost its controlled listbox");
  check(document.querySelector('input[type="file"]')!.closest("[inert]"), "background document opening is not inert");
  await key("Tab"); await key("Tab", { shiftKey: true });
  document.querySelector<HTMLElement>(".document-viewport")!.focus();
  check(document.activeElement === input, "modal focus escaped its inherited filter trap");
  await key("J");
  const first = selectedVisible();
  check(!first.querySelector(".command-state") && row("single_page_view").getAttribute("aria-selected") === "false",
    "keyboard selection incorrectly follows the current application setting");
  state("single_page_view", true, /current/i);
  // Batched real key events exercise the inherited clamp and active-row scrolling.
  for (let index = 0; index < rows().length + 2; index += 1) dispatchKey("ArrowDown");
  await settle();
  check(selectedVisible() === rows()[2], "ArrowDown did not wrap and reveal the resulting command");
  await value(input, "page view");
  check(rows().length === 1, "single-view label alias failed");
  selectedVisible();
  state("single_page_view", true, /current/i);
  check(settingContrast(row("single_page_view")) >= 4.5, "selected setting description has insufficient text contrast");
  await value(input, "two_page_spread");
  check(selectedVisible() === row("two_page_spread"), "filtered keyboard selection did not move to the requested command");
  state("two_page_spread", false, /not\s+current/i);
  await value(input, "zoom in");
  check(rows().length === 1 && !row("zoom_in").querySelector(".command-state"), "readable one-shot command query changed");
  await value(input, "recolor toggle keephue");
  check(rows().length === 1 && row("recolor_toggle_keephue"), "normalized command-ID alias stopped filtering");
  await value(input, "Ctrl+O");
  check(rows().length === 1 && row("open_document"), "shortcut text stopped filtering");
  await value(input, "=");
  check(rows().length === 1 && row("fit_to_page_width"), "symbol shortcut stopped filtering");
  await excludedStatusWords(["current", "enabled", "checked"]);
  await closePalette();
  check(document.querySelector(".status-page")?.textContent === originalPage, "reader page shortcut leaked through the command filter");
  await openPalette();
}
function assertFit(active: typeof fits[number] | null) {
  for (const id of fits) state(id, id === active, active === null ? /custom\s+zoom/i : /current/i);
}
function assertSpread(narrow: boolean) {
  state("single_page_view", narrow, narrow ? /displayed/i : /not\s+current/i, narrow ? /narrow/i : /current/i);
  state("two_page_spread", !narrow, narrow ? /requested/i : /current/i, narrow ? /single\s+page/i : /current/i);
  state("fit_to_spread", true, /current/i, narrow ? /fallback/i : /current/i);
  check(!!document.querySelector(".pdfViewer .spread") === !narrow, "effective setting description disagrees with the real PDF spread DOM");
}
interface RuntimeCase {
  width: number;
  height: number;
  dark: boolean;
  describedSettings: number;
  pdfRows: number;
  wrappedLabels: number;
  epubRows: number;
}
async function indexRoot(format: "pdf" | "epub", width: number, height: number) {
  if (document.querySelector(".command-palette")) await indexClose();
  await key(":", { shiftKey: true, code: "Semicolon" });
  await settle();
  check(document.activeElement?.classList.contains("command-list"), "Index root does not focus Normal mode");
  const labels = rows().map(row => row.querySelector(".command-label")!.textContent);
  check(JSON.stringify(labels) === JSON.stringify(format === "epub"
    ? ["open", "search", "chapter", "layout", "theme", "typography"]
    : ["open", "search", "page", "page layout", "theme", "fit width"]), "Index contextual six-command root changed");
  const capture = async (name: string) => {
    (window as any).__snapshotDone = false; bridge({ snapshot: name });
    await until(() => (window as any).__snapshotDone, "Index snapshot timed out");
  };
  const native = async (nativeKey: string) => {
    (window as any).__snapshotDone = false; bridge({ nativeKey });
    await until(() => (window as any).__snapshotDone, "Native App key timed out"); await settle(); await settle();
  };
  if (format === "epub" && width === 1000) await capture("correction-normal.png");
  await key(":"); await value(filter(), "th");
  if (format === "epub" && width === 1000) await capture("correction-command.png");
  await key("Enter");
  check(filter().value === "th", "ambiguous command executed unexpectedly");
  if (format === "epub" && width === 1000) {
    const before = selectedVisible().id;
    await native("Down"); check(document.activeElement === filter() && selectedVisible().id !== before, "Native App Down did not select results in input focus");
    await native("ctrl+p"); check(document.activeElement === filter() && selectedVisible().id === before, "Native App Ctrl+P did not return selection");
  }
  await value(filter(), "theme gru");
  check(rows().length === 1, "automatic command suggestions lost unique theme alias");
  await key("Escape");
  if (format === "epub" && width === 1000) {
    await key("/"); await value(filter(), "theme"); await native("Tab");
    check(document.activeElement?.classList.contains("command-list"), "Filter result focus missing");
    await capture("correction-filter-results.png"); await key("Escape");
  }
  if (format === "epub") {
    await key("j"); await key("j"); await key("j");
    const selected = selectedVisible();
    const before = selected.querySelector(".command-shortcut")!.textContent;
    await key("Enter");
    check(selectedVisible() === selected && selected.querySelector(".command-shortcut")!.textContent !== before,
      "EPUB layout toggle did not preserve selection and update its live value");
    await key("Enter");
    check(selected.querySelector(".command-shortcut")!.textContent === before, "EPUB layout toggle failed to reverse");
    await settledEpub();
  }
  const snapshotWindow = window as unknown as { __snapshotDone: boolean };
  snapshotWindow.__snapshotDone = false;
  bridge({ snapshot: `${format}-root-${width}-${height}-${night() ? "dark" : "light"}.png` });
  await until(() => snapshotWindow.__snapshotDone, "native root screenshot did not complete");
  await indexClose();
}
async function pdfCase(width: number, height: number, dark: boolean, firstCase: boolean): Promise<RuntimeCase> {
  await resize(width, height);
  await indexRoot("pdf", width, height);
  await execute("single_page_view");
  await execute("fit_to_page");
  const originalPage = document.querySelector(".status-page")!.textContent!;
  await openPalette();
  assertFit("fit_to_page");
  state("single_page_view", true, /current/i);
  state("two_page_spread", false, /not\s+current/i);
  state("toggle_night_mode", dark, dark ? /\bon\b/i : /\boff\b/i);
  const layout = paletteLayout();
  await modalAndSelection(originalPage);
  await execute("two_page_spread", true);
  await execute("fit_to_spread");
  await openPalette();
  const stableInput = filter();
  const stableSpreadRow = row("two_page_spread");
  const count = rows().length;
  assertSpread(width === 420);
  const alternate = width === 420 ? 1000 : 420;
  await resize(alternate, height);
  await until(() => isCurrent("two_page_spread") === (alternate !== 420), "open palette did not update its effective spread after resize");
  check(filter() === stableInput && row("two_page_spread") === stableSpreadRow && rows().length === count,
    "resize replaced the open palette or changed its command set");
  check(document.activeElement === stableInput, "fallback resize moved modal filter focus");
  assertSpread(alternate === 420);
  paletteLayout();
  await excludedStatusWords(alternate === 420 ? ["requested", "displayed", "single-page fallback"] : ["current"]);
  await resize(width, height);
  await until(() => isCurrent("two_page_spread") === (width !== 420), "spread request did not recover after widening");
  assertSpread(width === 420);
  await closePalette();
  await key("=", { code: "Equal" });
  await openPalette(); assertFit("fit_to_page_width"); await closePalette();
  const pageBefore = document.querySelector<HTMLElement>(".pdfViewer .page")!.getBoundingClientRect().width;
  await key("+", { code: "Equal", shiftKey: true });
  await until(() => document.querySelector<HTMLElement>(".pdfViewer .page")!.getBoundingClientRect().width > pageBefore + 1, "manual zoom did not change the actual PDF page size");
  await openPalette(); assertFit(null); await closePalette();
  await key("w");
  await openPalette(); assertFit("fit_to_page"); await closePalette();
  await execute("toggle_continuous_scrolling", true);
  await openPalette();
  state("toggle_continuous_scrolling", true, /\bon\b/i);
  check(document.querySelector(".pdfViewer.continuous-presentation"), "continuous command did not change the real PDF viewer");
  await execute("toggle_continuous_scrolling");
  await openPalette();
  state("toggle_continuous_scrolling", false, /\boff\b/i);
  check(document.querySelector(".pdfViewer.paged-presentation"), "paged PDF presentation was not restored");
  await execute("toggle_night_mode", true);
  check(night() === !dark, "pointer night command did not update the App appearance");
  await openPalette(); state("toggle_night_mode", !dark, !dark ? /\bon\b/i : /\boff\b/i); await closePalette();
  await key("i");
  check(night() === dark, "night keyboard shortcut did not restore the audited appearance");
  await openPalette(); state("toggle_night_mode", dark, dark ? /\bon\b/i : /\boff\b/i);

  const appearanceLeaves = [...themeCommands("pdf", "original"), ...pdfAdvancedAppearanceCommands()]
    .filter((command) => command.id !== "back_to_commands");
  check(rows().some((option) => appearanceLeaves.some((command) =>
    option.querySelector(".command-label")?.textContent === command.label)),
    "empty filter lost advanced catalog access");
  await value(filter(), "back_to_commands");
  check(rows().length === 0, "root leaf search includes a Back row");
  await value(filter(), "");
  await execute("document_appearance", true);
  await value(filter(), "recolor_toggle");
  check(rows().length === 0, "theme chooser leaked advanced appearance actions");
  await value(filter(), "");
  for (const id of firstCase ? stockIds : ["sepia-warm"] as const) {
    await execute(stockCommand(id), id === "sepia-warm");
    await openPalette();
    state(stockCommand(id), true, /current/i);
    state("theme_original", false);
    for (const other of stockIds.filter((candidate) => candidate !== id)) state(stockCommand(other), false);
    check(document.querySelector<HTMLElement>(".reader-layout")!.dataset.recolor === "true", "stock command did not enable actual PDF recoloring");
    const saved = savedSettings();
    check(saved.activePreset === id && saved.recolorLightcolor === RECOLOR_PRESETS[id].lightColor && saved.recolorDarkcolor === RECOLOR_PRESETS[id].darkColor,
      "stock setting description does not match executed and persisted colors");
  }
  paletteLayout();
  await execute("pdf_advanced_appearance");
  await value(filter(), "theme_sepia");
  check(rows().length === 0, "advanced chooser leaked stock theme choices");
  await value(filter(), "");
  state("toggle_recolor", true, /sepia/i);
  for (const [id, preference] of optionCommands) {
    if (isCurrent(id)) await execute(id);
    await openPalette(); state(id, false, /\boff\b/i);
    await execute(id, true);
    await openPalette(); state(id, true, /\bon\b/i);
    check(savedSettings()[preference] === true, "enabled option did not preserve its actual preference");
  }
  await execute("toggle_recolor");
  await openPalette();
  state("toggle_recolor", false, /\boff\b/i, /sepia/i);
  for (const [id, preference] of optionCommands) {
    state(id, false, /saved.*on/i, /off/i);
    check(savedSettings()[preference] === true, "turning recoloring off erased a saved option");
    await execute(id);
    await openPalette(); state(id, false, /off/i);
    check(savedSettings()[preference] === false && savedSettings().recolor === false, "disabled saved option unexpectedly enabled recoloring");
  }
  paletteLayout();
  await execute("document_appearance");
  state("theme_original", true, /current/i);
  state("theme_sepia", false, /saved/i, /off/i);
  await excludedStatusWords(["saved", "recoloring off"]);
  await execute("toggle_recolor");
  await execute("document_appearance");
  state("theme_sepia", true, /current/i);
  const colorsBeforeOriginal = savedSettings();
  await execute("theme_original", true);
  await openPalette(); state("theme_original", true, /current/i);
  check(JSON.stringify(savedSettings()) === JSON.stringify({ ...colorsBeforeOriginal, recolor: false }),
    "Original changed the saved theme, colors or advanced options");
  await closePalette();
  await key("r");
  await execute("document_appearance");
  state("theme_sepia", true, /current/i);
  state("theme_original", false);
  check(JSON.stringify(savedSettings()) === JSON.stringify(colorsBeforeOriginal),
    "Original then r failed to restore the saved Sepia appearance");
  await execute("recolor_set_lightcolor");
  const colorInput = document.querySelector<HTMLInputElement>('[aria-label="Background hex color"]')!;
  check(document.activeElement === colorInput, "custom background command did not focus the real color editor");
  await value(colorInput, "#123456"); await key("Enter");
  await until(() => !document.querySelector('[aria-label="Background hex color"]'), "custom color was not committed");
  await execute("pdf_advanced_appearance");
  state("toggle_recolor", true, /custom/i);
  check(savedSettings().activePreset === "custom" && savedSettings().recolorLightcolor === "#123456", "custom command did not update production recolor settings");
  await excludedStatusWords(["custom colors"]);
  paletteLayout();
  await execute("document_appearance");
  noStockCurrent();
  await closePalette();
  check(document.querySelector(".pdfViewer .textLayer")?.textContent?.includes("Feedback PDF"), "command transitions lost the actual PDF document");
  return { width, height, dark, describedSettings: layout.describedSettings, pdfRows: layout.rows, wrappedLabels: layout.wrappedLabels, epubRows: 0 };
}
async function pdfLifecycle() {
  await execute("two_page_spread");
  await key("+", { code: "Equal", shiftKey: true });
  await execute("toggle_continuous_scrolling");
  await openPalette();
  assertFit(null);
  state("toggle_continuous_scrolling", true, /\bon\b/i);
  state("two_page_spread", false, /requested/i);
  await closePalette();
  const previousPage = document.querySelector(".pdfViewer .page")!;
  const previousRecolor = localStorage.getItem(storageKey);
  await openFile("feedback.pdf");
  await until(() => !previousPage.isConnected && !document.querySelector(".loading-indicator") &&
    document.querySelector(".pdfViewer .textLayer")?.textContent?.includes("Feedback PDF"), "successful actual PDF replacement did not finish");
  await openPalette();
  state("single_page_view", true, /displayed/i, /narrow/i);
  state("two_page_spread", false, /requested/i, /single\s+page/i);
  assertFit("fit_to_page");
  state("toggle_continuous_scrolling", false, /\boff\b/i);
  check(document.querySelector(".pdfViewer.paged-presentation"), "PDF replacement did not reset actual continuous presentation");
  check(localStorage.getItem(storageKey) === previousRecolor, "PDF replacement changed saved recoloring");
  await execute("close_document");
  await until(() => !document.querySelector(".pdfViewer .page") && document.querySelector(".status-page")?.textContent?.includes("Ctrl+O"),
    "close command did not clear the actual PDF");
  await openFile("feedback.pdf");
  await until(() => !document.querySelector(".loading-indicator") && document.querySelector(".pdfViewer .textLayer")?.textContent?.includes("Feedback PDF"),
    "closed PDF did not reopen");
  await openPalette();
  state("single_page_view", true, /current/i);
  state("two_page_spread", false, /not\s+current/i);
  assertFit("fit_to_page");
  state("toggle_continuous_scrolling", false, /\boff\b/i);
  await openPalette("toggle_recolor"); state("toggle_recolor", true, /custom/i);
  check(localStorage.getItem(storageKey) === previousRecolor, "close/reopen changed saved recoloring");
  await closePalette();
}
function rendererSnapshot() {
  const canvas = document.querySelector<HTMLCanvasElement>(".pdfViewer .page .canvasWrapper canvas")!;
  check(canvas?.width && canvas.height, "appearance check has no real rendered PDF canvas");
  return JSON.stringify({
    mode: document.querySelector<HTMLElement>(".reader-layout")!.dataset.recolorMode,
    enabled: document.querySelector<HTMLElement>(".reader-layout")!.dataset.recolor,
    filter: getComputedStyle(canvas).filter,
    matrix: document.querySelector("#clio-recolor-matrix feColorMatrix")!.getAttribute("values"),
    pixels: [...canvas.getContext("2d")!.getImageData(0, 0, 8, 8).data],
  });
}
async function settledRendererSnapshot() {
  let snapshot = rendererSnapshot();
  let changed = performance.now();
  await until(() => {
    const current = rendererSnapshot();
    if (current !== snapshot) {
      snapshot = current;
      changed = performance.now();
    }
    return performance.now() - changed >= 180;
  }, "real PDF recolor canvas did not settle");
  return snapshot;
}
async function freshPdf(settings?: PdfRecolorSettings) {
  appRoot.unmount();
  await settle();
  if (settings) localStorage.setItem(storageKey, JSON.stringify(settings));
  const persisted = localStorage.getItem(storageKey);
  appRoot = createRoot(document.getElementById("root")!);
  appRoot.render(<StrictMode><App /></StrictMode>);
  await until(() => document.querySelector(".document-viewport"), "fresh StrictMode App did not mount");
  check(localStorage.getItem(storageKey) === persisted, "fresh App loading rewrote the saved settings blob");
  document.querySelector<HTMLElement>(".document-viewport")!.focus();
  await openFile("feedback.pdf");
  await until(() => !document.querySelector(".loading-indicator") &&
    document.querySelector(".pdfViewer .textLayer")?.textContent?.includes("Feedback PDF") &&
    document.querySelector<HTMLCanvasElement>(".pdfViewer .page canvas")?.width,
    "fresh App did not render the real PDF");
  check(localStorage.getItem(storageKey) === persisted, "opening a PDF rewrote loaded settings");
}
async function appearancePersistence() {
  const named = (id: typeof stockIds[number], recolor: boolean): PdfRecolorSettings => ({
    ...DEFAULT_RECOLOR_SETTINGS, activePreset: id, recolor,
    recolorLightcolor: RECOLOR_PRESETS[id].lightColor, recolorDarkcolor: RECOLOR_PRESETS[id].darkColor,
  });
  const custom: PdfRecolorSettings = {
    ...named("dark", true), activePreset: "custom", recolorLightcolor: "#123456", recolorDarkcolor: "#FEDCBA",
    recolorKeephue: true, recolorAdjustLightness: true,
  };
  const seeds: { settings: PdfRecolorSettings; theme: typeof stockIds[number] | null }[] = [
    { settings: named("sepia-warm", false), theme: "sepia-warm" },
    { settings: named("dark", true), theme: "dark" },
    { settings: custom, theme: null },
    { settings: { ...custom, activePreset: "zathura-dark" }, theme: null },
    { settings: { ...named("gruvbox-dark", false), activePreset: "original", recolorKeephue: true }, theme: null },
    { settings: { ...custom, activePreset: "original", recolor: false }, theme: null },
  ];
  for (const { settings, theme } of seeds) {
    await freshPdf(settings);
    await execute("document_appearance");
    state("theme_original", !settings.recolor);
    if (theme) state(stockCommand(theme), settings.recolor, settings.recolor ? /current/i : /saved/i);
    else noStockCurrent();
    await execute("pdf_advanced_appearance");
    state("toggle_recolor", settings.recolor, settings.recolor ? theme ? new RegExp(RECOLOR_PRESETS[theme].label, "i") : /custom/i : /off/i);
    for (const [id, field] of optionCommands) state(id, settings.recolor && settings[field]);
    await closePalette();
    if (!settings.recolor) await key("r");
    check(JSON.stringify(savedSettings()) === JSON.stringify({ ...settings, recolor: true }),
      "r repaired a seeded identity or changed its colors/advanced flags");
    await execute("pdf_advanced_appearance");
    state("toggle_recolor", true, theme ? new RegExp(RECOLOR_PRESETS[theme].label, "i") : /custom/i);
    check(document.querySelector(".status-preset")?.textContent?.match(theme ? new RegExp(RECOLOR_PRESETS[theme].label, "i") : /custom/i),
      "seeded settings disagree with the actual renderer's theme label");
    await closePalette();
    check(document.querySelector<HTMLElement>(".reader-layout")!.dataset.recolor === "true", "r did not enable the real renderer");
    const restored = await settledRendererSnapshot();
    await key("r");
    check(getComputedStyle(document.querySelector(".pdfViewer .page canvas")!).filter === "none", "Original/off retained the canvas recolor filter");
    await freshPdf();
    await key("r");
    await until(() => rendererSnapshot() === restored, "seeded colors/flags did not restore the same canvas pixels and filter after fresh App");
  }
  for (const id of [...stockIds, "custom"] as const) {
    await freshPdf(named("dark", true));
    if (id === "custom") {
      await execute("recolor_set_lightcolor");
      await value(document.querySelector<HTMLInputElement>('[aria-label="Background hex color"]')!, "#123456");
      await key("Enter");
    } else {
      await execute(stockCommand(id));
      await closePalette();
    }
    const enabled = savedSettings();
    const rendered = await settledRendererSnapshot();
    await execute("theme_original");
    check(JSON.stringify(savedSettings()) === JSON.stringify({ ...enabled, recolor: false }),
      `${id}: selecting Original changed remembered identity, colors or flags`);
    await closePalette();
    await freshPdf();
    check(document.querySelector<HTMLElement>(".reader-layout")!.dataset.recolor === "false", `${id}: fresh disabled renderer is not Original`);
    check(getComputedStyle(document.querySelector(".pdfViewer .page canvas")!).filter === "none", `${id}: fresh Original has a recolor filter`);
    await key("r");
    check(JSON.stringify(savedSettings()) === JSON.stringify(enabled), `${id}: r failed to restore exact persisted settings`);
    await execute("document_appearance");
    if (id === "custom") noStockCurrent();
    else state(stockCommand(id), true, /current/i);
    await closePalette();
    check(document.querySelector(".status-preset")?.textContent?.match(id === "custom" ? /custom/i : new RegExp(RECOLOR_PRESETS[id].label, "i")),
      `${id}: actual PDF theme label did not restore`);
    await until(() => rendererSnapshot() === rendered, `${id}: Original/reopen/r did not restore actual canvas pixels/filter`);
  }
}
async function settledEpub() {
  await until(() => epubDocument()?.readyState === "complete" && epubText().includes("Feedback EPUB"),
    "EPUB frames did not finish rendering");
  await epubDocument()!.fonts.ready;
  await settle();
}
async function epubCase(width: number, height: number) {
  await resize(width, height);
  await settledEpub();
  await indexRoot("epub", width, height);
  await openPalette();
  const layout = paletteLayout();
  for (const id of ["open_document", "previous_chapter", "next_chapter", "next_page", "previous_page", "go_to_chapter", "close_document"] as const) {
    check(!row(id).querySelector(".command-state"), "EPUB one-shot command incorrectly gained setting state");
  }
  state("paged_layout", true, /current/i);
  state("continuous_layout", false, /not\s+current/i);
  check(row("paged_layout").getAttribute("aria-selected") === "false", "EPUB selection incorrectly follows the current layout");
  check(/PageDown/.test(row("next_page").querySelector(".command-shortcut")!.textContent!) &&
    /PageUp/.test(row("previous_page").querySelector(".command-shortcut")!.textContent!), "EPUB page commands omit their unconditional navigation shortcuts");
  check(rows().some((option) => option.querySelector(".command-label")?.textContent === "Document theme: Gruvbox Dark"),
    "empty EPUB filter lost theme choices");
  await execute("document_appearance", true);
  state("theme_original", true, /current/i);
  state("theme_gruvbox_dark", false, /not\s+current/i);
  await value(filter(), "font");
  check(rows().length === 0, "theme chooser leaked typography commands");
  await value(filter(), "");
  await execute("back_to_commands");
  await execute("epub_reading_preferences");
  const fields = ["Text size", "Font", "Line spacing", "Alignment", "Margins", "Reading column"];
  check(rows().length === fields.length + 1, "preferences did not consolidate into six fields and Reset");
  for (const field of fields) {
    await value(filter(), field);
    const target = rows().find((option) => option.querySelector(".command-label")?.textContent === `${field}…`)!;
    check(target && /Publisher/.test(target.querySelector(".command-state")?.textContent ?? ""), `${field} omits its effective value`);
    target.click(); await settle();
    check(filter().value === "" && document.activeElement === filter() &&
      !!document.querySelector('[aria-label="Return to parent chooser"]'), `${field} entry did not reset selection and focus`);
    check(selectedVisible() === rows()[0], `${field} did not select its first choice`);
    check(rows().every((option) => option.querySelector(".command-label")?.textContent?.startsWith(`${field}:`)),
      `${field} chooser contains unrelated options`);
    if (field === "Text size") {
      state("epub_size_publisher", true, /current/i);
      state("epub_text_larger", false, /publisher/i);
    }
    if (field === "Font") state("epub_set_font_family", true, /current/i);
    await indexBack();
    check(filter().value === field && selectedVisible() === rows()[0] &&
      filter().placeholder === "Filter reading preferences", `${field} Back did not return to its parent`);
  }
  await value(filter(), "Text size");
  await key("Enter");
  await closePalette();
  await execute("epub_reading_preferences");
  await value(filter(), "gruvbox");
  check(rows().length === 0, "preference chooser leaked document themes");
  await value(filter(), "");
  await execute("back_to_commands");
  await value(filter(), "gruvbox");
  state("theme_gruvbox_dark", false, /not\s+current/i);
  await value(filter(), "epub_set_font_family");
  check(rows().length > 1 && rows().every((option) => option.hasAttribute("aria-describedby")),
    "root search lost distinct described font choices sharing an action ID");
  await value(filter(), "");
  await execute("continuous_layout", true);
  await openPalette();
  await until(() => isCurrent("continuous_layout"), "continuous EPUB layout did not update after the real engine reflow");
  await until(() => getComputedStyle(foliateView()!.renderer.shadowRoot!.querySelector('[part="container"]')!).overflowY === "auto",
    "continuous command did not change the actual EPUB engine's scroll presentation");
  state("continuous_layout", true, /current/i);
  state("paged_layout", false, /not\s+current/i);
  check(/next.*screen/i.test(row("next_page").querySelector(".command-label")!.textContent!) &&
    /previous.*screen/i.test(row("previous_page").querySelector(".command-label")!.textContent!),
    "continuous EPUB commands misleadingly describe page turns");
  check(!/\bj\b|\bk\b/.test(row("next_page").querySelector(".command-shortcut")!.textContent!),
    "continuous EPUB screen command advertises line-movement keys");
  check(epubText().includes("Feedback EPUB"), "continuous reflow lost the actual EPUB content");
  await settledEpub();
  await excludedStatusWords(["current"]);
  await execute("paged_layout");
  await openPalette();
  await until(() => isCurrent("paged_layout"), "paged EPUB layout did not update after the real engine reflow");
  await until(() => getComputedStyle(foliateView()!.renderer.shadowRoot!.querySelector('[part="container"]')!).overflowY === "hidden",
    "paged command did not restore the actual EPUB engine's paginated presentation");
  state("paged_layout", true, /current/i);
  state("continuous_layout", false, /not\s+current/i);
  await closePalette();
  await execute("go_to_chapter");
  await until(() => filter()?.getAttribute("aria-label") === "Filter chapters" && rows().length > 0, "chapter destination palette did not open");
  check(!document.querySelector(".command-state") && rows().every((option) => !option.hasAttribute("aria-describedby")),
    "EPUB layout descriptions leaked into chapter destinations");
  check(document.activeElement === filter(), "chapter destination mode lost inherited filter focus");
  check(!!document.querySelector('[aria-label="Return to parent chooser"]') && selectedVisible() === rows()[0],
    "chapter chooser omits parent access or initial selection");
  await indexBack();
  check(filter().placeholder === "Filter commands" && filter().value === "go_to_chapter" && selectedVisible() === rows()[0],
    "chapter Back did not restore the unfiltered command root");
  await execute("go_to_chapter");
  await key("Tab"); await key("Tab", { shiftKey: true });
  check(document.activeElement === filter(), "chapter palette lost inherited Tab containment");
  await closePalette();
  return layout.rows;
}

// Stress a translated setting-bearing label in this isolated WebView only.
// IDs, shortcuts, actions and the native application's catalog remain unchanged.
const longLabelCommand = READER_COMMANDS.find((command) => command.id === "toggle_continuous_scrolling")!;
const originalLabel = longLabelCommand.label;
longLabelCommand.label = `${originalLabel} — a deliberately verbose translated command label for constrained windows, with enough reader terminology to require natural wrapping`;

window.addEventListener("error", (event) => bridge({ passed: false, error: event.message }));
// A genuine restored preference with a stale stock ID must be described as custom,
// not silently repaired. All subsequent state changes use production commands.
const previousSettings = localStorage.getItem(storageKey);
localStorage.setItem(storageKey, JSON.stringify({
  ...DEFAULT_RECOLOR_SETTINGS,
  recolor: true,
  activePreset: "zathura-dark",
  recolorLightcolor: "#123456",
  recolorDarkcolor: "#FEDCBA",
  recolorKeephue: true,
  recolorAdjustLightness: true,
} satisfies PdfRecolorSettings));
let appRoot = createRoot(document.getElementById("root")!);
appRoot.render(<StrictMode><App /></StrictMode>);

async function run() {
  await until(() => document.querySelector(".document-viewport"), "real App reader did not mount");
  document.querySelector<HTMLElement>(".document-viewport")!.focus();
  await resize(1000, 700);
  await openFile("feedback.pdf");
  await until(() => !document.querySelector(".loading-indicator") && document.querySelector(".pdfViewer .textLayer")?.textContent?.includes("Feedback PDF"), "actual 120-page PDF did not render");
  check(document.querySelector(".status-page")?.textContent?.includes("/ 120"), "fixture did not load the generated 120-page PDF");
  await execute("document_appearance");
  noStockCurrent();
  await execute("pdf_advanced_appearance");
  state("toggle_recolor", true, /\bon\b/i, /custom/i);
  state("recolor_toggle_keephue", true, /\bon\b/i);
  state("recolor_toggle_reverse_video", false, /\boff\b/i);
  state("recolor_toggle_adjust_lightness", true, /\bon\b/i);
  check(savedSettings().activePreset === "zathura-dark" && savedSettings().recolorLightcolor === "#123456", "opening a stale stock setting repaired persisted preferences");
  await closePalette();
  if (new URLSearchParams(location.search).has("appearance")) {
    await appearancePersistence();
    bridge({ passed: true, coverage: ["legacy-persistence", "fresh-Original-r-settings-and-rendered-pixels"] });
    return;
  }
  const cases: RuntimeCase[] = [];
  for (const dark of [false, true]) {
    if (!document.querySelector(".pdfViewer .page")) {
      await openFile("feedback.pdf");
      await until(() => document.querySelector(".pdfViewer .textLayer")?.textContent?.includes("Feedback PDF"), "replacement PDF did not render");
    }
    if (night() !== dark) await key("i");
    const appearanceCases: RuntimeCase[] = [];
    for (const [width, height] of [[420, 600], [1000, 700], [1440, 800]] as const) {
      appearanceCases.push(await pdfCase(width, height, dark, cases.length === 0 && appearanceCases.length === 0));
      if (cases.length === 0 && appearanceCases.length === 1) await pdfLifecycle();
    }
    await openFile("feedback.epub");
    await until(() => epubText().includes("Feedback EPUB chapter 1"), "actual EPUB engine did not display the generated book");
    for (const entry of appearanceCases) {
      check(night() === dark, "EPUB did not retain the audited App appearance");
      entry.epubRows = await epubCase(entry.width, entry.height);
      cases.push(entry);
    }
    await execute("close_document");
    await until(() => document.querySelector(".document-viewport"), "closing actual EPUB did not restore PDF reader");
    document.querySelector<HTMLElement>(".document-viewport")!.focus();
  }
  bridge({ passed: true, cases });
}
void run().catch((error: unknown) => bridge({ passed: false, error: String(error), stack: error instanceof Error ? error.stack : undefined }))
  .finally(() => {
    longLabelCommand.label = originalLabel;
    if (previousSettings === null) localStorage.removeItem(storageKey);
    else localStorage.setItem(storageKey, previousSettings);
  });
