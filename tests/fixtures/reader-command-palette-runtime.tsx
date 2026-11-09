import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { ReaderCommandPalette } from "../../src/reader/ReaderCommandPalette";
import { filterReaderCommands, useReaderKeyboard } from "../../src/reader/interactions";
import type { ReaderCommand, ReaderKind, ReaderOverlay } from "../../src/reader/interactions";
import { epubPreferenceCommands, searchableReaderCommands, themeCommands } from "../../src/reader/appearanceCommands";
import { DEFAULT_EPUB_PREFERENCES } from "../../src/epub/preferences";
import { EPUB_READER_COMMANDS } from "../../src/reader/interactions";

// Exercise the real shared component and keyboard hook in WebKit, not a DOM mock.

declare global {
  interface Window {
    webkit: { messageHandlers: { test: { postMessage: (value: string) => void } } };
  }
}
const chapters: ReaderCommand[] = Array.from({ length: 36 }, (_, index) => ({
  id: "select_chapter",
  scope: "epub",
  key: `chapter-${index}`,
  label: index === 1 ? "A nested chapter with an unusually long readable name ".repeat(7)
    : index === 2 ? "An oversized chapter heading ".repeat(600) : `Destination ${index + 1}`,
  targetHref: `chapter-${index + 1}.xhtml`,
  depth: index === 1 ? 1 : 0,
  shortcut: "",
}));
const preferenceChoices = epubPreferenceCommands(
  { ...DEFAULT_EPUB_PREFERENCES, fontFamily: "serif", fontScale: 200 },
  DEFAULT_EPUB_PREFERENCES,
);
const themes = themeCommands("epub", "original");
let updateReader: (kind: ReaderKind) => void;
let replaceQuery: (query: string) => void;
let replaceIndex: (index: number) => void;
let updateAppearance: (dark: boolean) => void;

function TestReader() {
  const [kind, setKind] = useState<ReaderKind>("pdf");
  const [dark, setDark] = useState(false);
  const [overlay, setOverlay] = useState<ReaderOverlay>(null);
  const [mode, setMode] = useState<"commands" | "chapters" | "themes" | "preferences">("commands");
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [destination, setDestination] = useState("");
  updateReader = setKind;
  replaceQuery = setQuery;
  replaceIndex = setIndex;
  updateAppearance = setDark;
  const commandSet = mode === "chapters" ? chapters : mode === "themes" ? themes
    : mode === "preferences" ? preferenceChoices
      : kind === "epub" ? searchableReaderCommands(EPUB_READER_COMMANDS, [themes, preferenceChoices], query) : undefined;
  const commands = filterReaderCommands(query, true, kind, commandSet);
  const closeOverlay = () => {
    setOverlay(null);
    setMode("commands");
    requestAnimationFrame(() => document.getElementById("reading-area")?.focus());
  };
  const execute = (command: ReaderCommand) => {
    if (command.id === "go_to_chapter" || command.id === "document_appearance" ||
      command.id === "epub_reading_preferences" || command.id === "back_to_commands") {
      setMode(command.id === "go_to_chapter" ? "chapters" : command.id === "document_appearance" ? "themes"
        : command.id === "epub_reading_preferences" ? "preferences" : "commands");
      setQuery("");
      setIndex(0);
    } else {
      setDestination(command.targetHref ?? command.id);
      closeOverlay();
    }
  };
  useReaderKeyboard({
    readerKind: kind, overlay, commands, commandIndex: index,
    searchReady: false, matchCount: 0, jumpInput: "", pageCount: 120,
  }, {
    closeOverlay, executePaletteCommand: execute,
    moveMatch: () => {}, runSearch: () => {}, goToPage: () => {}, runCommand: () => {},
    setCommandQuery: setQuery, setCommandIndex: setIndex, setOverlay,
  });
  return <main className="clio-app" data-night-mode={String(dark)}>
    <input id="background-file" className="visually-hidden" type="file" aria-label="Open fixture" />
    <button id="background-button">Background action</button>
    <div id="reading-area" tabIndex={-1}>Reading area</div>
    <output id="destination">{destination}</output>
    {overlay === "commands" && <ReaderCommandPalette
      commands={commands} commandIndex={index} query={query}
      placeholder={mode === "chapters" ? "Filter chapters" : mode === "themes" ? "Filter document themes"
        : mode === "preferences" ? "Filter reading preferences" : "Filter commands"}
      emptyMessage={mode === "chapters" ? "No matching chapters" : "No commands"}
      onQueryChange={setQuery} onCommandIndexChange={setIndex} onExecute={execute}
    />}
  </main>;
}


const bridge = (message: object) => {
  window.webkit.messageHandlers.test.postMessage(JSON.stringify(message));
};
window.addEventListener("error", (event) => bridge({ passed: false, error: event.message }));
createRoot(document.getElementById("root")!).render(<StrictMode><TestReader /></StrictMode>);
const settle = () => {
  const { promise, resolve } = Promise.withResolvers<void>();
  requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  return promise;
};
const check = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};
const filter = () => document.querySelector<HTMLInputElement>(".command-filter")!;
const selected = () => document.querySelector<HTMLElement>('.command-row[aria-selected="true"]')!;
async function key(key: string, shiftKey = false) {
  const event = new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true });
  document.activeElement!.dispatchEvent(event);
  document.activeElement!.dispatchEvent(new KeyboardEvent("keyup", { key, shiftKey, bubbles: true }));
  await settle();
  return event;
}
async function query(value: string) {
  const input = filter();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await settle();
}
async function open(value = "") {
  await key(":", true);
  await query(value);
  check(document.activeElement === filter(), "palette entry must focus the filter");
}
function checkActive() {
  const input = filter();
  check(input.getAttribute("role") === "combobox", "filter must expose a combobox");
  const list = document.getElementById(input.getAttribute("aria-controls")!);
  check(list?.getAttribute("role") === "listbox", "combobox must control its listbox");
  const option = selected();
  check(option && input.getAttribute("aria-activedescendant") === option.id, "active descendant must match selection");
  check(option.getAttribute("role") === "option", "selected row must expose an option");
  check(document.activeElement === input, "option navigation must not transfer DOM focus");
}
function checkVisible() {
  const list = document.querySelector<HTMLElement>(".command-list")!;
  const row = selected().getBoundingClientRect();
  const bounds = list.getBoundingClientRect();
  check(row.top >= bounds.top - 1 && row.bottom <= bounds.top + list.clientHeight + 1,
    `selected option is outside its list: ${row.top}..${row.bottom}, list ${bounds.top}..${bounds.bottom}`);
}
function checkShortcutClearance() {
  const list = document.querySelector<HTMLElement>(".command-list")!;
  const bounds = list.getBoundingClientRect();
  check(list.scrollWidth <= list.clientWidth, "palette shortcuts create horizontal overflow");
  for (const shortcut of list.querySelectorAll<HTMLElement>(".command-shortcut")) {
    const rect = shortcut.getBoundingClientRect();
    const y = (rect.top + rect.bottom) / 2;
    if (!rect.width || y <= bounds.top || y >= bounds.bottom) continue;
    for (const x of [rect.left + .5, rect.right - .5]) {
      check(document.elementFromPoint(x, y) === shortcut,
        `shortcut obscured or clipped in ${document.documentElement.dir}: ${shortcut.textContent}`);
    }
  }
}
function ratio(foreground: string, background: string) {
  const luminance = (color: string) => {
    const values = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((v) => {
      const channel = v / 255;
      return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    });
    return values[0]! * .2126 + values[1]! * .7152 + values[2]! * .0722;
  };
  const values = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
  return (values[1]! + .05) / (values[0]! + .05);
}

async function resize(width: number, height: number) {
  bridge({ resize: [width, height], scale: devicePixelRatio });
  for (let attempt = 0; innerWidth !== width || innerHeight !== height; attempt++) {
    check(attempt < 120, `native viewport ${innerWidth}x${innerHeight} at DPR ${devicePixelRatio} did not resize to ${width}x${height}`);
    await settle();
  }
  await settle();
}

async function run() {
  for (let attempt = 0; !document.getElementById("reading-area"); attempt++) {
    check(attempt < 120, "React reader fixture did not mount");
    await settle();
  }
  document.getElementById("reading-area")!.focus();
  const results: object[] = [];
  for (const [width, height] of [[1000, 700], [420, 600], [1440, 800]]) {
    await resize(width!, height!);
    updateReader("pdf");
    await settle();
    await open("zoom in");
    check(selected().textContent!.includes("Zoom in"), "natural command query must select Zoom in");
    checkActive();
    await key("Tab");
    await key("Tab", true);
    checkActive();
    check((await key("Tab")).defaultPrevented, "Tab must be contained");
    document.getElementById("background-file")!.focus();
    document.getElementById("background-button")!.focus();
    checkActive();
    await key("Enter");
    check(document.getElementById("destination")!.textContent === "zoom_in", "Enter executed a contradictory command");
    check(document.activeElement?.id === "reading-area", "execution must restore reader focus");

    await open();
    for (const zoom of [1, 1.5]) {
      document.documentElement.style.zoom = String(zoom);
      for (const direction of ["ltr", "rtl"]) {
        document.documentElement.dir = direction;
        await settle();
        checkShortcutClearance();
      }
    }
    document.documentElement.style.zoom = "";
    document.documentElement.dir = "ltr";
    await settle();
    const count = document.querySelectorAll(".command-row").length;
    for (let n = 0; n < count; n++) await key("ArrowDown");
    check(selected().id.endsWith(`option-${count - 1}`), "last PDF command is unreachable");
    checkActive(); checkVisible();
    const stationaryRow = document.querySelectorAll(".command-row")[2]!;
    stationaryRow.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    stationaryRow.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    await settle();
    check(selected().id.endsWith(`option-${count - 1}`), "stationary pointer overrode keyboard selection");
    const list = document.querySelector<HTMLElement>(".command-list")!;
    const scroll = list.scrollTop;
    await key("ArrowDown");
    check(list.scrollTop === scroll, "an already visible option scrolled unnecessarily");
    await resize(width!, height! - 80);
    checkVisible();
    await resize(width!, height!);
    checkVisible();
    await query("fit to page");
    checkActive(); checkVisible();
    await key("ArrowDown");
    await key("Tab");
    const expected = selected().textContent;
    check(expected!.includes("Fit to page"), "filtered selection is incorrect");
    await key("Enter");
    check(document.getElementById("destination")!.textContent === "fit_to_page", "Tab changed Enter's destination");

    await open();
    replaceIndex(999);
    replaceQuery("zoom in"); // List replacement can happen without the filter's index reset.
    await settle();
    checkActive(); checkVisible();
    await query("zzzz absent");
    check(!filter().hasAttribute("aria-activedescendant"), "empty results retain a stale active option");
    check(document.querySelectorAll('[role="option"]').length === 0, "empty command results contain options");
    await key("Enter");
    check(!!filter(), "Enter on empty results must not execute");
    await key("Escape");
    check(document.activeElement?.id === "reading-area", "Escape must restore reader focus");
    check(!document.querySelector<HTMLElement>("#background-file")!.inert, "background inertness leaked after closing");

    await open("fit_to_page");
    const rows = document.querySelectorAll<HTMLElement>(".command-row");
    rows[1]!.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, movementY: 1 }));
    await settle();
    check(selected() === rows[1], "pointer hover must update the active option");
    const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    rows[1]!.dispatchEvent(press);
    check(press.defaultPrevented, "pointer press must preserve filter focus");
    rows[1]!.click();
    await settle();
    check(document.getElementById("destination")!.textContent === "fit_to_page", "click executed a different row");
    check(document.activeElement?.id === "reading-area", "click must restore reader focus");

    updateReader("epub"); await settle();
    await open("reading preferences"); await key("Enter");
    checkActive();
    await query("Font: Serif");
    const pending = selected();
    const pendingDescription = document.getElementById(pending.getAttribute("aria-describedby")!);
    check(pendingDescription && /requested/i.test(pendingDescription.textContent!) &&
      /waiting/i.test(pendingDescription.textContent!), "requested preference lacks its accessible pending description");
    check(!pending.querySelector('.command-state [aria-hidden="true"]'), "pending preference is falsely marked applied");
    check(pending.getAttribute("aria-selected") === "true" && !pending.hasAttribute("aria-checked"),
      "keyboard selection was conflated with applied preference state");
    await query("Font: Publisher");
    check(!!selected().querySelector('.command-state [aria-hidden="true"]'), "applied preference has no non-color current mark");
    await query("epub_text_larger");
    checkActive();
    const disabled = selected();
    check(disabled.getAttribute("aria-disabled") === "true", "bounded text-size action lacks disabled option semantics");
    const description = document.getElementById(disabled.getAttribute("aria-describedby")!);
    check(description?.textContent?.includes("200%"), "disabled size action does not describe the saved size");
    const beforeDisabled = document.getElementById("destination")!.textContent;
    const disabledPress = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    disabled.dispatchEvent(disabledPress);
    check(disabledPress.defaultPrevented && document.activeElement === filter(), "disabled pointer press stole filter focus");
    disabled.click();
    await settle();
    check(!!filter() && document.getElementById("destination")!.textContent === beforeDisabled,
      "disabled option executed through the pointer");
    await key("Enter");
    check(!!filter() && document.getElementById("destination")!.textContent === beforeDisabled,
      "disabled option executed through Enter");
    checkActive();
    await query("epub_text_smaller");
    check(selected().getAttribute("aria-disabled") !== "true", "enabled neighboring option remained disabled");
    await key("Enter");
    check(document.getElementById("destination")!.textContent === "epub_text_smaller",
      "disabled-option rejection blocked a subsequent enabled command");
    check(document.activeElement?.id === "reading-area", "enabled execution did not restore reader focus");
    await open("go to chapter"); await key("Enter");
    check(filter().placeholder === "Filter chapters", "chapter mode did not replace the command list");
    checkActive();
    const chapterRows = document.querySelectorAll<HTMLElement>(".command-row");
    check(chapterRows[1]!.getBoundingClientRect().height > chapterRows[0]!.getBoundingClientRect().height,
      "long chapter fixture must exercise variable-height rows");
    check(chapterRows[1]!.style.paddingLeft !== "", "nested chapter indentation was lost");
    await key("ArrowDown"); checkVisible();
    await key("ArrowDown");
    const chapterList = document.querySelector<HTMLElement>(".command-list")!;
    check(selected().getBoundingClientRect().height > chapterList.clientHeight, "oversized fixture must exceed the list height");
    const tallScroll = chapterList.scrollTop;
    updateAppearance(true); await settle();
    updateAppearance(false); await settle();
    check(chapterList.scrollTop === tallScroll, "oversized row oscillated between its edges on rerender");
    const tall = selected().getBoundingClientRect();
    const chapterBounds = chapterList.getBoundingClientRect();
    check(tall.top <= chapterBounds.top + 1 && tall.bottom >= chapterBounds.bottom - 1,
      "oversized active row must retain its visible portion");
    chapterList.scrollTop = 10;
    const pointerScroll = chapterList.scrollTop;
    check(pointerScroll > 0, "chapter fixture must exercise an actually scrolled list");
    chapterList.children[1]!.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, movementY: 1 }));
    await settle();
    check(selected() === chapterList.children[1], "pointer movement did not select its hovered chapter");
    check(chapterList.scrollTop === pointerScroll, "pointer selection overrode ordinary list scrolling");
    for (let n = 0; n < chapters.length; n++) await key("ArrowDown");
    check(selected().textContent!.includes("Destination 36"), "last chapter is unreachable");
    checkVisible(); checkActive();
    await query("select");
    check(document.querySelectorAll('[role="option"]').length === 0, "chapters matched their internal action ID");
    check(document.querySelector('[role="status"]')?.textContent === "No matching chapters", "chapter no-match feedback is inaccurate");
    check(!filter().hasAttribute("aria-activedescendant"), "chapter no-match state retains a stale option");
    await query("Destination 36"); checkActive(); checkVisible();
    await key("Enter");
    check(document.getElementById("destination")!.textContent === "chapter-36.xhtml", "chapter selection executed another destination");

    updateReader("pdf"); await settle();
    for (const dark of [false, true]) {
      updateAppearance(dark); await settle(); await open();
      const palette = getComputedStyle(document.querySelector(".command-palette")!);
      const active = getComputedStyle(selected());
      const activeShortcut = getComputedStyle(selected().querySelector(".command-shortcut")!);
      const normalShortcut = document.querySelectorAll(".command-shortcut")[1]!;
      const normalRatio = ratio(getComputedStyle(normalShortcut).color, palette.backgroundColor);
      const selectedRatio = ratio(activeShortcut.color, active.backgroundColor);
      check(normalRatio >= 4.5 && selectedRatio >= 4.5, "shortcut text fails WCAG AA contrast");
      check(ratio(palette.color, palette.backgroundColor) >= 4.5 && ratio(palette.color, active.backgroundColor) >= 4.5,
        "command label text fails WCAG AA contrast");
      check(active.boxShadow !== "none", "active option relies on fill alone");
      const indicator = active.boxShadow.match(/rgb\([^)]+\)/)![0];
      check(ratio(indicator, active.backgroundColor) >= 3, "active-state indicator fails non-text contrast");
      results.push({ width, height, dark, normalRatio, selectedRatio });
      await key("Escape");
    }
    for (let n = 0; n < 5; n++) {
      await open(); await key("ArrowDown");
      check(selected().id.endsWith("option-1"), "duplicate key listeners advanced selection more than once");
      await key("Escape");
      check(document.activeElement?.id === "reading-area", "repeated close left stale focus");
    }
  }
  bridge({ passed: true, results });
}
void run().catch((error: unknown) => bridge({
  passed: false, error: String(error), stack: error instanceof Error ? error.stack : undefined,
}));
