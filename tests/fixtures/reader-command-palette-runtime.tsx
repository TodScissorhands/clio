import { useClioIndex } from "../../src/reader/clioIndex";
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
let enableIndex: (enabled: boolean) => void;
let updateReader: (kind: ReaderKind) => void;
let replaceQuery: (query: string) => void;
let replaceIndex: (index: number) => void;
let updateAppearance: (dark: boolean) => void;
let updateContinuous: (continuous: boolean) => void;
let updateOverlay: (overlay: ReaderOverlay) => void;
const routed: string[] = [];

function TestReader() {
  const clio = useClioIndex();
  const [indexEnabled, setIndexEnabled] = useState(false);
  enableIndex = setIndexEnabled;
  const [kind, setKind] = useState<ReaderKind>("pdf");
  const [dark, setDark] = useState(false);
  const [continuous, setContinuous] = useState(false);
  const [overlay, setOverlay] = useState<ReaderOverlay>(null);
  const [mode, setMode] = useState<"commands" | "chapters" | "themes" | "preferences">("commands");
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [destination, setDestination] = useState("");
  updateReader = setKind;
  replaceQuery = setQuery;
  replaceIndex = setIndex;
  updateAppearance = setDark;
  updateContinuous = setContinuous;
  updateOverlay = setOverlay;
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
    epubLayoutMode: continuous ? "continuous" : "paged", continuousScrolling: continuous,
  }, {
    paletteKey: indexEnabled ? event => clio.key(event, commands, index, query, setQuery, setIndex, execute, closeOverlay) : undefined,
    closeOverlay, executePaletteCommand: execute,
    moveMatch: () => {}, runSearch: () => {}, goToPage: () => {},
    runCommand: (command) => { routed.push(command); },
    getPdfZoomOverflow: () => ({ horizontal: true, vertical: true }),
    panPdf: (direction) => { routed.push(`pan:${direction}`); return true; },
    scrollPdfContinuous: (direction) => { routed.push(`scroll:${direction}`); },
    navigatePageWithBoundary: (direction) => { routed.push(direction > 0 ? "next_page" : "previous_page"); },
    setCommandQuery: setQuery, setCommandIndex: setIndex, setOverlay,
  });
  return <main className="clio-app" data-night-mode={String(dark)}>
    <input id="background-file" className="visually-hidden" type="file" aria-label="Open fixture" />
    <button id="background-button">Background action</button>
    <div id="reading-area" tabIndex={-1}>Reading area</div>
    <input id="ordinary-input" aria-label="Ordinary input" />
    <textarea id="ordinary-textarea" aria-label="Ordinary textarea" />
    <output id="destination">{destination}</output>
    {overlay === "commands" && <ReaderCommandPalette
      onInputMode={clio.setMode} mode={indexEnabled ? clio.mode : "filter"} onDismiss={closeOverlay} onVisibleRows={rows => { clio.visibleRows.current = rows; }}
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
async function key(key: string, modifiers: boolean | KeyboardEventInit = false) {
  const init = typeof modifiers === "boolean" ? { shiftKey: modifiers } : modifiers;
  const event = new KeyboardEvent("keydown", { key, ...init, bubbles: true, cancelable: true });
  document.activeElement!.dispatchEvent(event);
  document.activeElement!.dispatchEvent(new KeyboardEvent("keyup", { key, ...init, bubbles: true }));
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
  if (filter()) { await query(value); check(document.activeElement === filter(), "palette entry must focus the filter"); }
  else check(document.activeElement?.classList.contains("command-list"), "Normal entry must focus list");
}
function checkActive(owner: Element | null = filter()) {
  const input = filter();
  check(input.getAttribute("role") === "combobox", "filter must expose a combobox");
  const list = document.getElementById(input.getAttribute("aria-controls")!);
  check(list?.getAttribute("role") === "listbox", "combobox must control its listbox");
  const option = selected();
  if ([...document.querySelectorAll('[role="option"]')].every(row => row.getAttribute("aria-disabled") === "true")) {
    check(!option && !input.hasAttribute("aria-activedescendant"), "disabled-only results acquired selection");
    check(document.activeElement === input, "disabled-only results lost filter focus");
    return;
  }
  check(option && input.getAttribute("aria-activedescendant") === option.id, "active descendant must match selection");
  check(option.getAttribute("role") === "option", "selected row must expose an option");
  check(document.activeElement === owner, "option navigation changed the expected focus owner");
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
  check(list.scrollWidth <= list.clientWidth, `palette shortcuts create horizontal overflow: ${list.scrollWidth}/${list.clientWidth}; ${JSON.stringify([...list.children].map(e => ({w:e.getBoundingClientRect().width, s:e.scrollWidth, t:e.textContent}))) }`);
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

async function checkModifierRouting() {
  const results: object[] = [];
  const failures: string[] = [];
  const reading = () => document.getElementById("reading-area")!.focus();
  const dispatch = (type: string, init: KeyboardEventInit) => {
    document.activeElement!.dispatchEvent(new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init }));
  };
  const expectRoute = async (init: KeyboardEventInit, expected: string[]) => {
    routed.length = 0;
    dispatch("keydown", init);
    dispatch("keyup", init);
    await settle();
    if (JSON.stringify(routed) !== JSON.stringify(expected)) {
      failures.push(`modifier route ${JSON.stringify(init)}: expected ${expected}, received ${routed}`);
    }
  };
  for (const kind of ["epub", "pdf"] as const) {
    updateReader(kind);
    for (const continuous of [false, true]) {
      updateContinuous(continuous);
      await settle();
      reading();
      for (const caps of [false, true]) {
        for (const shiftKey of [false, true]) {
          const key = caps !== shiftKey ? "N" : "n";
          const command = kind === "epub"
            ? shiftKey ? "previous_chapter" : "next_chapter"
            : shiftKey ? "previous_item" : "next_item";
          await expectRoute({ key, code: "KeyN", shiftKey }, [command]);
          results.push({ kind, continuous, caps, shiftKey, key, command });
          if (kind === "pdf") {
            for (const [letter, direction, command] of [["j", "down", "next_page"], ["k", "up", "previous_page"]]) {
              await expectRoute({ key: caps !== shiftKey ? letter!.toUpperCase() : letter!, code: `Key${letter!.toUpperCase()}`, shiftKey },
                [shiftKey ? command! : `${continuous ? "scroll" : "pan"}:${direction}`]);
            }
          }
        }
      }
      if (kind === "pdf") {
        for (const [key, command] of [["PageDown", "next_page"], ["PageUp", "previous_page"], ["Home", "goto_beginning"], ["End", "goto_end"]]) {
          await expectRoute({ key, code: key, ctrlKey: true }, [command!]);
          await expectRoute({ key: "Unidentified", code: key, ctrlKey: true }, [command!]);
        }
      }
      await expectRoute({ key: "N", code: "KeyN", isComposing: true }, []);
      await expectRoute({ key: "N", code: "KeyN", keyCode: 229 }, []);
      for (const id of ["ordinary-input", "ordinary-textarea"]) {
        document.getElementById(id)!.focus();
        for (const key of ["N", "J", "K"]) await expectRoute({ key }, []);
      }
      for (const overlay of ["search", "commands"] as const) {
        updateOverlay(overlay);
        await settle();
        for (const key of ["N", "J", "K"]) await expectRoute({ key }, []);
        updateOverlay(null);
        await settle();
      }
      reading();
      // Queue repeated intentional navigation, then release before the frame.
      if (kind === "epub" && continuous) continue;
      const repeatInputs: KeyboardEventInit[] = [{ key: "j", code: "KeyJ", shiftKey: true }];
      if (kind === "pdf") repeatInputs.push({ key: "PageDown", code: "PageDown", ctrlKey: true });
      for (const init of repeatInputs) {
        routed.length = 0;
        dispatch("keydown", init);
        for (let n = 0; n < 5; n++) dispatch("keydown", { ...init, repeat: true });
        await settle();
        check(routed.length === 2 && routed.every((command) => command === "next_page"),
          `repeat must coalesce and retain navigation intent: ${routed}`);
        dispatch("keydown", { ...init, repeat: true });
        dispatch("keyup", init);
        await settle();
        check(routed.length === 2, "keyup did not cancel queued navigation");
        dispatch("keydown", { ...init, repeat: true });
        await settle();
        check(routed.length === 2, "released repeat restarted navigation");
      }
    }
  }
  check(failures.length === 0, failures.join("\n"));
  return results;
}

async function run() {
  for (let attempt = 0; !document.getElementById("reading-area"); attempt++) {
    check(attempt < 120, "React reader fixture did not mount");
    await settle();
  }
  document.getElementById("reading-area")!.focus();
  const modifierResults = await checkModifierRouting();
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
    checkActive(document.querySelector(".command-list"));
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
    check(selected().hasAttribute("data-applied") && selected().querySelector(".command-state")?.textContent?.startsWith("Applied."), "applied preference lacks distinct applied semantics");
    await query("epub_text_larger");
    checkActive();
    const disabled = document.querySelector<HTMLElement>('[role="option"][aria-disabled="true"]')!;
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
    check(chapterList.scrollTop === tallScroll, `oversized row oscillated between its edges on rerender: ${tallScroll} -> ${chapterList.scrollTop}, row ${JSON.stringify(selected().getBoundingClientRect())}, list ${JSON.stringify(chapterList.getBoundingClientRect())}`);
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
      const marker = getComputedStyle(selected(), "::before");
      check(marker.content.includes("›"), "active option relies on fill alone");
      const indicator = marker.color;
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
  enableIndex(true); updateReader("pdf"); await settle(); await open();
  check(document.activeElement?.classList.contains("command-list"), "Normal mode lacks genuine list focus");
  await key("k"); check(selected().id.endsWith(`option-${document.querySelectorAll(".command-row").length - 1}`), "Normal mode did not wrap backwards");
  await key("g"); await key("g"); check(selected().id.endsWith("option-0"), "gg failed");
  (window as unknown as { __snapshotDone: boolean }).__snapshotDone = false;
  bridge({ nativeKey: "j" });
  for (let n = 0; !(window as unknown as { __snapshotDone: boolean }).__snapshotDone; n++) { check(n < 240, "native input timed out"); await settle(); }
  check(selected().id.endsWith("option-1"), "native XTEST j did not reach the focused Index");
  await key("G"); checkVisible();
  await key("u", { ctrlKey: true }); checkVisible();
  await key("d", { ctrlKey: true }); checkVisible();
  await key("/"); check(document.activeElement === filter(), "filter mode did not focus the input");
  await query("jkh l"); check(filter().value === "jkh l", "input letters were consumed as navigation");
  await key("Escape"); check(!document.querySelector(".command-filter"), "input Escape did not return to Normal");
  await key(":"); check(document.activeElement === filter(), "command mode did not focus input");
  const evidence = async (snapshot: string) => {
    (window as any).__snapshotDone = false; bridge({ snapshot });
    for (let n = 0; !(window as any).__snapshotDone; n++) { check(n < 240, "snapshot timeout"); await settle(); }
  };
  const native = async (nativeKey: string) => {
    (window as any).__snapshotDone = false; bridge({ nativeKey });
    for (let n = 0; !(window as any).__snapshotDone; n++) { check(n < 240, "native focus transition timeout"); await settle(); }
    await settle(); await settle();
  };
  check(getComputedStyle(filter()).outlineStyle === "none", "Index input inherited global focus outline");
  await query("page"); await evidence("correct-command.png");
  await query(""); check(document.querySelectorAll(".command-row").length > 12, "native navigation needs a long catalog");
  for (let pass = 0; pass < 3; pass++) {
    const count = document.querySelectorAll(".command-row").length;
    const before = selected().id;
    await native("Down"); check(document.activeElement === filter(), "Down stole input focus");
    check(count < 2 || selected().id !== before, "native Down did not change result");
    await native("ctrl+n"); check(document.activeElement === filter(), "Ctrl+N stole input focus");
    await native("Tab"); check(document.activeElement?.classList.contains("command-list"), "Tab failed to focus results");
    check(filter().value === "" && document.querySelectorAll(".command-row").length === count, "Tab altered query/catalog");
    await native("G"); checkVisible(); await native("g"); await native("g"); checkVisible();
    await native("shift+Tab"); check(document.activeElement === filter() && filter().value === "", "Shift+Tab lost input/query");
  }
  await key("Escape"); await evidence("correct-normal.png");
  await key("/"); await query("page"); await native("Tab"); await evidence("correct-filter-results.png");

  await key("Escape"); await key("Escape");
  await open();
  for (const [width, height] of [[420, 600], [1000, 700], [1440, 800]]) {
    await resize(width!, height!);
    for (const dark of [false, true]) {
      updateAppearance(dark); await settle();
      const panel = document.querySelector(".command-palette")!.getBoundingClientRect();
      check(panel.width <= 441 && panel.height <= height! * .55 + 1, "Index exceeds compact bounds");
      (window as unknown as { __snapshotDone: boolean }).__snapshotDone = false;
      bridge({ snapshot: `index-${width}-${height}-${dark ? "dark" : "light"}.png` });
      for (let n = 0; !(window as unknown as { __snapshotDone: boolean }).__snapshotDone; n++) { check(n < 240, "native snapshot timed out"); await settle(); }
    }
  }
  document.querySelector(".command-dismiss")!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
  document.querySelector(".command-dismiss")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  await settle(); check(!document.querySelector(".command-palette"), "outside pointer failed to dismiss");

  await open();
  const promptPointer = async (target: string | undefined, click: boolean) => {
    (window as any).__snapshotDone = false; bridge({ nativeDrag: true, promptTarget: target, promptClick: click });
    for (let n = 0; !(window as any).__snapshotDone; n++) { check(n < 240, "native prompt pointer timed out"); await settle(); }
    await settle(); await settle();
  };
  await promptPointer(".command-context", true);
  check(filter() && document.activeElement === filter() && document.querySelector(".command-prefix")?.textContent === "/", "native context click failed to enter filter input");
  await native("j"); check(filter().value === "j", "clicked prompt input did not accept native typing");
  await promptPointer(".command-prefix", true);
  check(document.activeElement === filter() && filter().value === "j" && document.querySelector(".command-prefix")?.textContent === "/", "editing prompt click changed query or mode");
  await native("Tab"); await promptPointer(undefined, true);
  check(document.activeElement === filter() && filter().value === "j", "blank editing prompt click did not preserve/focus input");
  await key("Escape");
  await promptPointer(".command-prefix", true);
  check(filter() && document.activeElement === filter() && document.querySelector(".command-prefix")?.textContent === ":", "native prefix click failed to enter command input");
  await key("Escape");
  await promptPointer(".command-context", false);
  check(!filter() && document.activeElement?.classList.contains("command-list"), "native label drag activated input");
  const labelDrag = (window as any).__nativeDragResult;
  check(labelDrag.delta > 0 && Math.abs(labelDrag.after - labelDrag.before - labelDrag.delta) < 2, "label drag did not move palette");
  await key("Escape"); await open();
  const panel = () => document.querySelector<HTMLElement>(".command-palette")!;
  const header = () => document.querySelector<HTMLElement>(".command-prompt")!;
  const rect = () => panel().getBoundingClientRect();
  const drag = (dx: number, dy: number, target: HTMLElement = header()) => {
    const r = rect(), x = r.right - 6, y = r.top + 12;
    const init = { bubbles: true, cancelable: true, pointerId: 7, isPrimary: true, button: 0, clientX: x, clientY: y };
    // Synthetic events cannot acquire native capture; real capture is verified by the native drag probe.
    const capture = header().setPointerCapture;
    header().setPointerCapture = () => {};
    target.dispatchEvent(new PointerEvent("pointerdown", init));
    header().dispatchEvent(new PointerEvent("pointermove", { ...init, clientX: x + dx, clientY: y + dy }));
    header().dispatchEvent(new PointerEvent("pointerup", init));
    header().setPointerCapture = capture;
  };
  const focusBeforeDrag = document.activeElement;
  const initial = rect();
  drag(-50, 70); await settle();
  check(Math.abs(rect().left - initial.left + 50) < 1 && Math.abs(rect().top - initial.top - 70) < 1, "prompt drag failed");
  check(document.activeElement === focusBeforeDrag, "drag stole keyboard focus");
  const moved = rect();
  await key(":"); await settle();
  check(Math.abs(rect().left - moved.left) < 1 && Math.abs(rect().top - moved.top) < 1, "mode transition reset drag position");
  drag(60, 60, filter()); await settle();
  check(Math.abs(rect().left - moved.left) < 1, "input became a drag handle");
  await query("document_appearance"); await key("Enter");
  check(Math.abs(rect().left - moved.left) < 1 && Math.abs(rect().top - moved.top) < 1, "chooser transition reset drag position");
  await query("back_to_commands"); await key("Enter"); await key("Escape");
  drag(5000, 5000); await settle();
  check(rect().right <= innerWidth - 3 && rect().bottom <= innerHeight - 3, "drag exceeded viewport");
  await resize(420, 600);
  check(rect().right <= innerWidth - 3 && rect().bottom <= innerHeight - 3, "resize did not clamp drag position");
  drag(-5000, -5000); await settle();
  check(Math.abs(rect().left - 4) < 1 && Math.abs(rect().top - 4) < 1, "leading edge clamp failed");
  await key("Escape"); await open();
  check(Math.abs(rect().left - (innerWidth - rect().width) / 2) < 1 && Math.abs(rect().top - innerHeight * .09) < 1, "reopening did not reset drag position");
  (window as unknown as { __snapshotDone: boolean }).__snapshotDone = false;
  bridge({ nativeDrag: true });
  for (let n = 0; !(window as unknown as { __snapshotDone: boolean }).__snapshotDone; n++) { check(n < 240, "native drag timed out"); await settle(); }
  const nativeDrag = (window as unknown as { __nativeDragResult: { before: number; after: number; focus: string; delta: number } }).__nativeDragResult;
  check(nativeDrag.delta > 0 && Math.abs(nativeDrag.after - nativeDrag.before - nativeDrag.delta) < 2, `native pointer drag/capture did not move Index: ${JSON.stringify(nativeDrag)}`);
  check(document.activeElement?.classList.contains("command-list"), "native drag lost list focus");
  await key("Escape");
  bridge({ passed: true, results, modifierResults });
}
void run().catch((error: unknown) => bridge({
  passed: false, error: String(error), stack: error instanceof Error ? error.stack : undefined,
}));
