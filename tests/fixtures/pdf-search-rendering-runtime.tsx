import { createRoot } from "react-dom/client";
import App from "../../src/App";
import type { PdfViewerHandle } from "../../src/pdf/PdfViewerSurface";
import { READER_COMMANDS } from "../../src/reader/interactions";
import type { ReaderCommandId } from "../../src/reader/interactions";
import { pdfAdvancedAppearanceCommands, themeCommands } from "../../src/reader/appearanceCommands";
import { buildPageSearchIndex, findPageMatchesInIndex, isPdfSearchTextItem, normalizeSearchQuery } from "../../src/pdf/searchIndex";
import type { MatchSegment } from "../../src/pdf/searchIndex";
import "../../src/index.css";

const host = window as unknown as {
  __searchViewer: PdfViewerHandle;
  __detailSnapshot: (result: { id: number; pixels?: number[][]; error?: string }) => void;
  webkit: { messageHandlers: { test: { postMessage: (value: string) => void } } };
};
const check: (value: unknown, message: string) => asserts value = (value, message) => { if (!value) throw new Error(message); };
const cases: string[] = [], errors: string[] = [];
window.addEventListener("error", (event) => errors.push(event.message));
window.addEventListener("unhandledrejection", (event) => errors.push(String(event.reason)));
const root = createRoot(document.getElementById("root")!);
const settle = () => {
  const { promise, resolve } = Promise.withResolvers<void>();
  requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  return promise;
};
async function until(predicate: () => unknown, message: string) {
  const deadline = performance.now() + 15_000;
  while (!predicate()) { check(performance.now() < deadline, message); await settle(); }
  await settle();
}
const viewer = () => { const value = host.__searchViewer?.current; check(value, "PDF viewer missing"); return value; };
const viewport = () => document.querySelector<HTMLDivElement>(".document-viewport")!;
const status = () => document.querySelector(".search-status")?.textContent ?? "";
const marks = () => [...document.querySelectorAll<HTMLDivElement>(".pdfjs-search-highlight")];
const active = () => document.querySelector<HTMLDivElement>(".pdfjs-search-highlight.is-active")?.parentElement;
function value(input: HTMLInputElement, text: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
async function key(key: string, init: KeyboardEventInit = {}) {
  const target = document.activeElement ?? document.body;
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
  target.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true, ...init }));
  await settle();
}
async function command(id: ReaderCommandId) {
  await key(":", { shiftKey: true, code: "Semicolon" });
  await until(() => document.querySelector(".command-filter"), "Palette did not open");
  const entry = [...READER_COMMANDS, ...pdfAdvancedAppearanceCommands(), ...themeCommands("pdf", "original")].find((candidate) => candidate.id === id)!;
  value(document.querySelector<HTMLInputElement>(".command-filter")!, entry.label); await settle();
  const option = [...document.querySelectorAll<HTMLElement>('.command-list [role="option"]')].find((candidate) => candidate.querySelector(".command-label")?.textContent?.endsWith(entry.label));
  check(option, `Command unavailable: ${id}`); option.click(); await settle();
  if (document.querySelector(".command-palette")) await key("Escape");
  await until(() => !document.querySelector(".command-palette"), `Command did not execute: ${id}`);
}
async function openFile(name: string) {
  const transfer = new DataTransfer(); transfer.items.add(new File([await (await fetch(`/__fixtures/${name}`)).arrayBuffer()], name));
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  input.files = transfer.files; input.dispatchEvent(new Event("change", { bubbles: true })); await settle();
}
async function ready(pages: number) {
  await until(() => host.__searchViewer?.current?.pdfDocument?.numPages === pages &&
    host.__searchViewer.current.getPageView(0)?.renderingState === 3 &&
    document.querySelector(".textLayer span"), "PDF/text layer did not render");
}
async function edit(text: string) {
  if (!document.querySelector('input[aria-label="Search document"]')) await key("/");
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Search document"]'); check(input, "Search editor missing");
  value(input, text); await settle();
}
async function search(text: string, count: number) {
  await edit(text); await key("Enter");
  await until(() => status() === (count ? `1 / ${count} matches` : "No matches"), `Search ${text}: ${status()}`);
  if (count) await until(() => active(), "Active highlight missing");
}
async function position(expected: string) { await until(() => status() === expected, `Expected ${expected}, got ${status()}`); }
function visible(label: string) {
  const element = active(); check(element, `${label}: active match absent`);
  const rect = element.getBoundingClientRect(), area = viewport().getBoundingClientRect();
  check(rect.top >= area.top - 1 && rect.bottom <= area.bottom + 1 && rect.left >= area.left - 1 && rect.right <= area.right + 1,
    `${label}: match ${JSON.stringify(rect.toJSON())} outside ${JSON.stringify(area.toJSON())}`);
}
const transitions: object[] = [];
async function transition(id: ReaderCommandId, label: string) {
  await command(id);
  visible(label); alignment("needle");
  // Assert through subsequent render frames as well: a late anchor must not
  // displace an already revealed result. This is not a wait-for-visibility loop.
  for (let frame = 0; frame < 4; frame++) {
    await settle();
    visible(label); alignment("needle");
  }
  transitions.push({ label, match: active()!.getBoundingClientRect().toJSON(),
    viewport: viewport().getBoundingClientRect().toJSON(), top: viewport().scrollTop,
    left: viewport().scrollLeft, scale: viewer().currentScale, spread: viewer().spreadMode, scrollMode: viewer().scrollMode });
}
function alignment(query: string) {
  const page = active()!.closest(".page")!;
  const expected: DOMRect[] = [];
  for (const span of page.querySelectorAll(".textLayer span")) {
    const text = span.firstChild;
    if (!text || text.nodeType !== Node.TEXT_NODE) continue;
    let offset = text.textContent!.toLowerCase().indexOf(query);
    while (offset >= 0) {
      const range = document.createRange(); range.setStart(text, offset); range.setEnd(text, offset + query.length);
      expected.push(...range.getClientRects()); offset = text.textContent!.toLowerCase().indexOf(query, offset + 1);
    }
  }
  const actual = [...page.querySelectorAll(".pdfjs-search-highlight")].map((mark) => mark.getBoundingClientRect());
  check(expected.length === 3 && actual.length === expected.length, `Wrong glyph rectangles: ${expected.length}/${actual.length}`);
  for (const rect of expected) check(actual.some((candidate) => (["left", "top", "width", "height"] as const).every((field) => Math.abs(candidate[field] - rect[field]) < .8)), "Overlay detached from PDF.js range geometry");
}
let snapshotId = 0;
const snapshots = new Map<number, { resolve: (pixels: number[][]) => void; reject: (error: Error) => void }>();
host.__detailSnapshot = (result) => {
  const pending = snapshots.get(result.id); check(pending, "Unknown snapshot"); snapshots.delete(result.id);
  if (result.error) pending.reject(new Error(result.error)); else pending.resolve(result.pixels!);
};
async function pixels(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  const points: number[][] = [];
  for (let y = Math.ceil(rect.top + 1); y < rect.bottom - 1; y++) for (let x = Math.ceil(rect.left + 1); x < rect.right - 1; x++) points.push([x, y]);
  const id = ++snapshotId;
  const result = Promise.withResolvers<number[][]>();
  snapshots.set(id, result);
  host.webkit.messageHandlers.test.postMessage(JSON.stringify({ snapshot: id, width: innerWidth, height: innerHeight, points }));
  return result.promise;
}
function markerPaper(element: Element) {
  const marker = getComputedStyle(element, "::before");
  const fill = marker.backgroundColor.match(/[\d.]+/g)!.map(Number);
  const paper = getComputedStyle(element.closest(".page")!).backgroundColor.match(/[\d.]+/g)!.map(Number);
  return paper.slice(0, 3).map((channel, index) => {
    const backdrop = channel / 255, source = fill[index]! / 255;
    const curve = backdrop <= .25 ? ((16 * backdrop - 12) * backdrop + 4) * backdrop : Math.sqrt(backdrop);
    const blended = marker.mixBlendMode === "multiply" ? backdrop * source
      : source <= .5 ? backdrop - (1 - 2 * source) * backdrop * (1 - backdrop)
      : backdrop + (2 * source - 1) * (curve - backdrop);
    return Math.round((backdrop * (1 - fill[3]!) + blended * fill[3]!) * 255);
  });
}
async function appearance() {
  const selected = document.querySelector<HTMLElement>(".pdfjs-search-highlight.is-active")!;
  const inactive = marks().find((mark) => !mark.classList.contains("is-active"))!;
  const strong = getComputedStyle(selected, "::before"), soft = getComputedStyle(inactive, "::before");
  const activeBoundary = getComputedStyle(selected, "::after"), inactiveBoundary = getComputedStyle(inactive, "::after");
  const activeAlpha = Number(strong.backgroundColor.match(/[\d.]+/g)![3]);
  const inactiveAlpha = Number(soft.backgroundColor.match(/[\d.]+/g)![3]);
  check(activeAlpha > inactiveAlpha && inactiveAlpha > 0 && activeAlpha <= .4, "Search fills are not restrained and distinct");
  check(activeBoundary.outlineStyle === "none" && inactiveBoundary.outlineStyle === "none" &&
    activeBoundary.height === "1px" && inactiveBoundary.backgroundColor === "rgba(0, 0, 0, 0)", "Borderless active-only underline lost");
  check(getComputedStyle(selected.parentElement!.parentElement!).pointerEvents === "none", "Highlights intercept text input");
  const viewport = document.querySelector<HTMLElement>(".document-viewport")!;
  check(getComputedStyle(viewport).getPropertyValue("scrollbar-width") === "thin" &&
    getComputedStyle(viewport).overflowY === "auto", "PDF lost its thin native scroll owner");
  const samples = await pixels(selected);
  const paper = markerPaper(selected);
  check(samples.some(sample => paper.every((channel, index) => Math.abs(sample[index]! - channel) < 4)), "Compositor does not paint the marker over white paper");
  // At fit-page, subpixel glyphs need not contain a fully black source pixel.
  // Require visible ink separation from the observed amber paper, not an
  // assumed rasterization of a solid black glyph at this scale.
  check(samples.some(sample => paper.every((channel, index) => channel - sample[index]! >= 90)),
    "Compositor marker obscures the glyph ink");
}
async function gateExtraction() {
  const page = await viewer().pdfDocument!.getPage(3);
  const original = page.getTextContent;
  const { promise: gate, resolve: release } = Promise.withResolvers<void>();
  page.getTextContent = async (...args) => { await gate; return original.apply(page, args); };
  return () => { page.getTextContent = original; release(); };
}
async function unicodeSearch() {
  await openFile("unicode.pdf"); await ready(3);
  const content = await (await viewer().pdfDocument!.getPage(1)).getTextContent({ disableNormalization: true });
  const items = content.items.filter(isPdfSearchTextItem);
  const rendered = items.filter((item) => item.str.length);
  const extracted = rendered.map((item) => item.str);
  const sourceItem = (text: string) => {
    const index = extracted.indexOf(text);
    check(index >= 0, `Missing Unicode extraction ${JSON.stringify(text)}: ${JSON.stringify(extracted)}`);
    return index;
  };
  const composed = sourceItem("é"), decomposed = sourceItem("e\u0301");
  const base = sourceItem("e"), accent = sourceItem("\u0301");
  check(accent === base + 1, "PDF.js did not retain adjacent split combining items");
  const compatibility = sourceItem("ﬁＡ𐐀ΟΣ");
  const rtl = sourceItem("גבא");
  cases.push(`PDF.js unnormalized Unicode extraction: ${JSON.stringify(extracted.slice(composed))}`);
  const index = buildPageSearchIndex(1, items);
  function geometry(expected: MatchSegment[][]) {
    const page = active()!.closest(".page")!;
    const spans = [...page.querySelectorAll(".textLayer span:not(.markedContent)")];
    const rectangles: DOMRect[] = [];
    for (const match of expected) for (const segment of match) {
      const span = spans[segment.itemIndex]!;
      check(span?.textContent === extracted[segment.itemIndex], `Text layer altered source span ${segment.itemIndex}: ${span?.textContent}`);
      const range = document.createRange();
      range.setStart(span.firstChild!, segment.start); range.setEnd(span.firstChild!, segment.end);
      rectangles.push(...range.getClientRects());
    }
    const actual = [...page.querySelectorAll(".pdfjs-search-highlight")].map((mark) => mark.getBoundingClientRect());
    check(actual.length === rectangles.filter((rect) => rect.width > 0 && rect.height > 0).length, `Unicode rectangle count ${actual.length}/${rectangles.length}`);
    for (const rect of rectangles.filter((rect) => rect.width > 0 && rect.height > 0)) {
      check(actual.some((candidate) => (["left", "top", "width", "height"] as const).every((field) => Math.abs(candidate[field] - rect[field]) < .8)),
        "Unicode overlay differs from original UTF-16 DOM range");
    }
    visible("Unicode reveal");
  }
  const accents = [
    [{ itemIndex: composed, start: 0, end: 1 }],
    [{ itemIndex: decomposed, start: 0, end: 2 }],
    [{ itemIndex: base, start: 0, end: 1 }, { itemIndex: accent, start: 0, end: 1 }],
  ];
  const samples: [string, MatchSegment[][]][] = [
    ["é", accents], ["e\u0301", accents],
    ["fi", [[{ itemIndex: compatibility, start: 0, end: 1 }]]],
    ["ａ𐐨", [[{ itemIndex: compatibility, start: 1, end: 4 }]]],
    ["𐐨", [[{ itemIndex: compatibility, start: 2, end: 4 }]]],
    ["ος", [[{ itemIndex: compatibility, start: 4, end: 6 }]]],
    ["בא", [[{ itemIndex: rtl, start: 1, end: 3 }]]],
  ];
  for (const [query, expected] of samples) {
    const found = findPageMatchesInIndex(index, normalizeSearchQuery(query));
    check(JSON.stringify(found.map((match) => match.segments)) === JSON.stringify(expected), `Unicode source ranges ${query}: ${JSON.stringify(found)}`);
    await search(query, expected.length * 3); geometry(expected);
  }
  await search("é", 9);
  for (let result = 0; result < 3; result++) { geometry(accents); await key("Enter"); }
  await key("Escape");
  for (const id of ["single_page_view", "two_page_spread", "toggle_continuous_scrolling", "zoom_in", "theme_dark", "theme_light", "theme_original"] as const) {
    await command(id);
    geometry(accents);
    for (let frame = 0; frame < 4; frame++) { await settle(); geometry(accents); }
  }
  for (const query of ["𐐨", "ος", "e\u0301", "é"]) {
    await edit(query); check(status() === "" && marks().length === 0, "Unicode edit retained stale highlights");
  }
  cases.push("Unicode exact UTF-16 source spans/DOM ranges/reveal, split items, single/spread/continuous/zoom/recolor and repeated edits");

  // Fresh documents have no cached search index. Delay actual extraction,
  // then retire its owner; never override the returned Unicode text/items.
  for (const close of [false, true]) {
    const previous = viewer().pdfDocument;
    await openFile("unicode.pdf");
    await until(() => viewer().pdfDocument !== previous, "Fresh Unicode document did not commit");
    await ready(3);
    const release = await gateExtraction();
    await edit("é"); await key("Enter"); await until(() => status() === "Searching…", "Unicode extraction did not start");
    if (close) { await key("Escape"); await command("close_document"); }
    else { await openFile("replacement.pdf"); await ready(1); }
    release(); await settle(); await settle();
    check(status() === "" && marks().length === 0, "Retired Unicode extraction restored results");
  }
  cases.push("Unicode extraction retirement on replacement and close");
}

async function run() {
  localStorage.clear(); root.render(<App />);
  await until(() => document.querySelector('input[type="file"]'), "App did not mount");
  await openFile("search.pdf"); await ready(3);
  const release = await gateExtraction();
  await edit("needle"); await key("Enter"); await until(() => status() === "Searching…", "Indexing state missing");
  await edit("changed"); check(status() === "" && marks().length === 0, "Editing retained stale results");
  release(); await settle(); check(status() === "", "Cancelled extraction restored stale status");
  await search("needle", 9); visible("first result"); alignment("needle"); await appearance();
  await key("Enter"); await position("2 / 9 matches"); visible("Enter next");
  await key("Enter", { shiftKey: true }); await position("1 / 9 matches");
  await key("Enter", { shiftKey: true }); await position("9 / 9 matches"); visible("previous wrap");
  await key("Escape"); check(status() === "9 / 9 matches" && !document.querySelector('input[aria-label="Search document"]'), "Escape discarded count/results");
  await key("n"); await position("1 / 9 matches"); visible("n wrap");
  await key("N", { shiftKey: true }); await position("9 / 9 matches");
  await key("n"); await position("1 / 9 matches");
  cases.push("marker compositor pixels/readability, active boundaries, Enter/Shift+Enter/n/N wrapping, Escape count");

  await command("fit_to_page_width"); alignment("needle"); visible("fit width");
  for (let i = 0; i < 4; i++) await command("zoom_in");
  await key("n"); await position("2 / 9 matches"); visible("two-axis zoom reveal"); alignment("needle");
  check(viewport().scrollLeft > 0 && viewport().scrollTop > 0, "Zoomed result did not scroll both axes");
  const rect = active()!.getBoundingClientRect(), area = viewport().getBoundingClientRect();
  check(Math.abs((rect.top - area.top - 8) / (area.height - 16) - .4) < .035, "Result lost 40% reading context");
  await until(() => {
    const page = viewer().getPageView(viewer().currentPageNumber - 1) as unknown as { detailView?: { renderingState: number } };
    return page.detailView?.renderingState === 3;
  }, "Real PDF.js detail canvas did not render");
  alignment("needle");
  viewport().dispatchEvent(new WheelEvent("wheel", { deltaY: 20, bubbles: true })); viewport().scrollTop += 180;
  const manualTop = viewport().scrollTop;
  await settle(); await settle();
  check(Math.abs(viewport().scrollTop - manualTop) < 1, "Manual scrolling snapped to search result");
  await key("n"); await position("3 / 9 matches"); visible("next after manual scroll");
  await transition("two_page_spread", "Single → Spread (paged/manual)");
  await transition("single_page_view", "Spread → Single (paged/manual)");
  await transition("toggle_continuous_scrolling", "Single → Continuous");
  await transition("two_page_spread", "Continuous → Spread");
  await transition("single_page_view", "Spread → Continuous single");
  await transition("two_page_spread", "Continuous single → Spread");
  await transition("toggle_continuous_scrolling", "Continuous spread → Paged spread");
  await transition("toggle_continuous_scrolling", "Spread → Continuous");
  const layout = document.querySelector<HTMLElement>(".reader-layout")!;
  layout.style.width = "620px"; await settle(); await settle(); visible("narrow resize"); alignment("needle");
  layout.style.width = "900px"; await settle(); await settle(); visible("wide resize"); alignment("needle");
  await transition("single_page_view", "Spread → Single (continuous/manual)");
  await transition("fit_to_page", "Fit page");
  await transition("two_page_spread", "Single → Spread (fit page)");
  await transition("single_page_view", "Spread → Single (fit spread)");
  await transition("fit_to_page_width", "Fit width");
  await transition("two_page_spread", "Single → Spread (fit width)");
  await transition("single_page_view", "Spread → Single (fit width)");
  cases.push("fit/manual zoom, full-match two-axis 40% reveal, real detail render, no manual snap, continuous/spread/single/resize alignment");

  await search("split phrase", 3);
  const group = active()!;
  check(group.children.length === 2, "Multiline result must paint only its two glyph runs");
  const lineRects = [...group.children].map((mark) => mark.getBoundingClientRect());
  check(lineRects[1]!.top > lineRects[0]!.bottom, "Multiline marks cover the interline gap");
  const textLayer = group.closest(".page")!.querySelector(".textLayer")!;
  const split = [...textLayer.querySelectorAll("span")].find((span) => span.textContent?.includes("Before split"))!;
  const phrase = [...textLayer.querySelectorAll("span")].find((span) => span.textContent?.includes("phrase after"))!;
  const glyphSegments = [[split, 7, 12], [phrase, 0, 6]] as const;
  for (const [index, [span, start, end]] of glyphSegments.entries()) {
    const glyphRange = document.createRange();
    glyphRange.setStart(span.firstChild!, start); glyphRange.setEnd(span.firstChild!, end);
    const expected = glyphRange.getBoundingClientRect(), actual = lineRects[index]!;
    check((["left", "top", "width", "height"] as const).every((field) => Math.abs(actual[field] - expected[field]) < .8), "Multiline highlight includes unmatched prefix/suffix");
  }
  const selection = getSelection()!; const range = document.createRange();
  range.setStart(split.firstChild!, "Before ".length); range.setEnd(phrase.firstChild!, "phrase".length);
  selection.removeAllRanges(); selection.addRange(range);
  check(selection.toString().replace(/\s+/g, " ").trim() === "split phrase", `Native text selection changed: ${selection}`);
  selection.removeAllRanges(); visible("multiline whole result");
  const markerFill = getComputedStyle(document.querySelector(".pdfjs-search-highlight.is-active")!, "::before").backgroundColor;
  for (const theme of ["theme_dark", "theme_light", "theme_original"] as const) {
    await key("Escape"); await command(theme); visible(theme);
    const selected = group.isConnected ? group.firstElementChild! : document.querySelector(".pdfjs-search-highlight.is-active")!;
    check(getComputedStyle(selected, "::before").backgroundColor === markerFill, "Recolor changed overlay pixels");
    check(getComputedStyle(selected, "::after").backgroundColor === (theme === "theme_dark" ? "rgb(255, 255, 255)" : "rgb(0, 0, 0)"), "Page-theme underline contrast lost");
    const background = markerPaper(selected);
    check((await pixels(selected as HTMLElement)).some((sample) => background.every((channel, index) => Math.abs(sample[index]! - channel) < 4)), "Page recoloring also recolored the search marker");
    await key("i"); visible("application theme");
  }
  await command("theme_dark"); await command("recolor_toggle_keephue");
  check(document.querySelector<HTMLElement>(".reader-layout")!.dataset.recolorMode === "pixel", "Pixel recolor did not apply");
  visible("pixel recolor");
  cases.push("multiline glyph-only geometry and selection; Original/SVG/pixel recolor and Light/Dark chrome");

  await search("absentword", 0); await key("Escape"); check(status() === "No matches", "Completed no-match status lost");
  await edit(""); check(status() === "" && marks().length === 0, "Empty edit did not clear results"); await key("Enter"); check(status() === "", "Empty submission produced no-match feedback");
  await search("needle", 9); await key("Escape");
  const identity = viewer().pdfDocument;
  await openFile("invalid.pdf"); await until(() => document.querySelector(".error-banner"), "Invalid replacement did not report an error");
  check(viewer().pdfDocument === identity && status() === "1 / 9 matches", "Invalid replacement discarded current PDF search");
  document.querySelector<HTMLButtonElement>(".error-banner button")!.click();
  await openFile("replacement.pdf"); await ready(1); check(status() === "" && marks().length === 0, "Committed replacement retained old search");
  await openFile("search.pdf"); await ready(3); const finish = await gateExtraction();
  await edit("needle"); await key("Enter"); await until(() => status() === "Searching…", "Replacement cancellation search never started");
  await openFile("replacement.pdf"); await ready(1); finish(); await settle(); await settle();
  check(status() === "" && marks().length === 0, "Old document callback repopulated search");
  await search("needle", 3); await key("Escape"); await command("close_document");
  check(!viewer().pdfDocument && status() === "" && marks().length === 0, "Close retained search state");
  await unicodeSearch();
  root.unmount(); await settle();
  check(errors.length === 0, errors.join("; "));
  cases.push("query invalidation/empty/no matches, invalid replacement retention, committed replacement/cancellation and close");
  return { passed: true, cases, transitions, errors };
}
run().then((result) => host.webkit.messageHandlers.test.postMessage(JSON.stringify(result))).catch((error: unknown) => {
  host.webkit.messageHandlers.test.postMessage(JSON.stringify({ passed: false, error: String(error), stack: error instanceof Error ? error.stack : undefined, cases, transitions, errors }));
});
