import { indexFilter, indexClose, indexBack } from "./index-driver";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { View } from "foliate-js/view.js";
import type { ReaderFileSource } from "../../src/platform/tauriReaderFiles";
import { DOCUMENT_THEMES } from "../../src/reader/appearance";
import App from "../../src/App";
import "../../src/index.css";

type Access = { open: (source: ReaderFileSource) => Promise<void>; appearance: (dark: boolean) => void };
declare global {
  interface Window {
    __preferencesApp?: (app: Access) => void;
    __preferencesView?: (view: View) => void;
    __preferencesPositions?: Map<string, { cfi: string }>;
  }
}
// The native WebKit runner installs this trusted-host-only observation boundary.
const host = window as unknown as {
  webkit: { messageHandlers: { test: { postMessage: (message: string) => void } } };
};
const bridge = (message: object) => host.webkit.messageHandlers.test.postMessage(JSON.stringify(message));
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const settle = () => {
  const { promise, resolve } = Promise.withResolvers<void>();
  requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  return promise;
};
async function until(predicate: () => unknown, message: string) {
  const deadline = performance.now() + 12_000;
  for (;;) {
    await settle();
    if (predicate()) { await settle(); if (predicate()) return; }
    check(performance.now() < deadline, `${message}; alert=${document.querySelector('[role="alert"]')?.textContent}; status=${document.querySelector('.epub-status')?.textContent}`);
  }
}
let app: Access;
let view: View;
let serial = 0;
window.__preferencesApp = value => { app = value; };
window.__preferencesView = value => {
  if (view !== value) serial++;
  view = value;
};
window.__preferencesPositions = new Map();
const coverage: string[] = [];
const geometries: object[] = [];
const contents = () => view.renderer.getContents();
const first = () => contents().find(content => content.index === view.renderer.primaryIndex)!;
const stored = () => JSON.parse(localStorage.getItem("clio:epub-reading-preferences")!);
const bodyFont = () => {
  // Reflow can temporarily retire all views before the replacement is live.
  const content = first();
  return content ? content.doc.defaultView!.getComputedStyle(content.doc.body).fontSize : null;
};
async function key(value: string, init: KeyboardEventInit = {}) {
  const target = document.activeElement ?? document.body;
  target.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...init }));
  target.dispatchEvent(new KeyboardEvent("keyup", { key: value, bubbles: true, ...init }));
  await settle();
}
async function filter(query: string) {
  await indexFilter();
  const input = document.querySelector<HTMLInputElement>(".command-filter")!;
  check(input, "chooser disappeared");
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, query);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await settle();
}
async function choose(query: string) {
  if (query.startsWith("Back to")) { await indexBack(); return; }
  await filter(query);
  const rows = document.querySelectorAll<HTMLElement>('[role="option"]');
  check(rows.length === 1, `ambiguous choice ${query}: ${[...rows].map((row) => row.textContent)}`);
  check(rows[0]!.getAttribute("aria-disabled") !== "true", `disabled choice ${query}`);
  await key("Enter");
}
async function palette() {
  if (document.querySelector(".command-palette")) await indexClose();
  document.querySelector<HTMLElement>('[aria-label="EPUB reading area"],.document-viewport')!.focus();
  await key(":", { code: "Semicolon", shiftKey: true });
  await until(() => document.querySelector(".command-palette"), "Index did not open");
  await indexFilter();
  await until(() => document.querySelector(".command-filter"), "commands did not open");
}
async function command(query: string) { await palette(); await choose(query); }
async function dismiss() {
  if (document.querySelector(".command-palette")) await indexClose();
  check(document.activeElement?.getAttribute("aria-label") === "EPUB reading area", "Escape lost reader focus");
}
async function ready() {
  await until(() => view?.lastLocation?.cfi && contents().length && document.querySelector('[aria-label="EPUB reading area"][aria-busy="false"]'), "EPUB never became ready");
  check(!document.querySelector('[role="alert"]'), "unexpected reader error");
}
async function open(name = "preferences.epub", path: string | null = "/canonical/preferences.epub") {
  const previous = serial;
  const bytes = new Uint8Array(await (await fetch(`/__fixtures/${name}`)).arrayBuffer());
  const previousView = document.querySelector('.foliate-publication[aria-busy="false"] > foliate-view');
  const opening = app.open({ kind: "epub", bytes, name, path });
  if (previousView) check(previousView.isConnected, "replacement discarded the committed reader before preparation");
  await opening;
  await until(() => serial > previous, "replacement did not create a Foliate View");
  await ready();
}
async function close() {
  await command("close_document");
  await until(() => !document.querySelector(".foliate-reader") && document.title === "Clio", "close did not retire EPUB");
}
function metrics() {
  const content = first();
  return Object.fromEntries(["inherited", "em", "rem", "px", "inline", "heading", "code", "verse", "manual", "whitespace", "inline-code", "table", "image"].map((id) => {
    const element = content.doc.getElementById(id)!;
    const style = content.doc.defaultView!.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return [id, { font: style.fontSize, family: style.fontFamily, line: style.lineHeight, whitespace: style.whiteSpace, width: rect.width, height: rect.height }];
  }));
}
function cfiFor(node: Node) {
  const doc = node.ownerDocument!;
  const range = doc.createRange();
  range.selectNodeContents(doc.createTreeWalker(node, NodeFilter.SHOW_TEXT).nextNode() ?? node);
  range.collapse(true);
  return view.getCFI(view.renderer.primaryIndex, range);
}
function rangeFor(cfi: string) {
  const { index, anchor } = view.resolveCFI(cfi);
  const target = contents().find(content => content.index === index);
  check(target, "CFI resolved outside the live publication");
  return anchor(target.doc);
}
function anchorVisible(cfi: string) {
  const range = rangeFor(cfi).cloneRange();
  if (range.startContainer.nodeType === Node.ELEMENT_NODE) {
    const target = range.startContainer.childNodes[range.startOffset];
    if (!target) return false;
    range.selectNodeContents(target);
  }
  // Text CFIs measure their next painted character; element boundaries measure
  // their target block, never the entire publication body.
  if (range.startContainer.nodeType === Node.TEXT_NODE) {
    const node = range.startContainer;
    const text = node.textContent ?? "";
    const offset = range.startOffset;
    const next = text.slice(offset).search(/\S/u);
    if (next < 0) return false;
    const start = offset + next;
    range.setStart(node, start);
    range.setEnd(node, start + String.fromCodePoint(text.codePointAt(start)!).length);
  } else range.selectNodeContents(range.startContainer);
  const frame = range.startContainer.ownerDocument!.defaultView!.frameElement!.getBoundingClientRect();
  const viewport = view.renderer.shadowRoot!.querySelector<HTMLElement>("#container")!.getBoundingClientRect();
  return [...range.getClientRects()].some((rect) => {
    const x = frame.left + rect.left, y = frame.top + rect.top;
    return rect.width > 0 && rect.height > 0 && x < viewport.right && x + rect.width > viewport.left &&
      y < viewport.bottom && y + rect.height > viewport.top;
  });
}
async function applied(size: string) {
  await until(() => Math.abs(parseFloat(bodyFont() ?? "") - parseFloat(size)) < .01 && !document.querySelector('.command-state-text')?.textContent?.includes("Requested"), `font ${size} did not apply`);
}
async function resize(width: number, height: number) {
  bridge({ resize: [width, height], scale: devicePixelRatio });
  await until(() => innerWidth === width && innerHeight === height, "resize dimensions did not settle");
}

async function run() {
  localStorage.removeItem("clio:epub-reading-preferences");
  createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
  await until(() => app && document.querySelector('.document-viewport'), "App did not mount");
  await open();
  await command("epub_reading_preferences");
  for (const [field, choice, savedField, expected] of [
    ["Text size", "Text size: Larger", "fontScale", 110],
    ["Font", "Font: Sans", "fontFamily", "sans"],
    ["Line spacing", "Line spacing: Comfortable", "lineHeight", 1.6],
    ["Alignment", "Alignment: Start", "alignment", "start"],
    ["Margins", "Margins: Comfortable", "margins", "comfortable"],
    ["Reading column", "Reading column: Comfortable", "columnWidth", "comfortable"],
  ] as const) {
    await choose(`${field}…`);
    const input = document.querySelector<HTMLInputElement>(".command-filter")!;
    check(input.value === "" && document.activeElement === input, `${field} did not start with a focused empty filter`);
    await choose(choice);
    check(document.activeElement === input && input.value === choice && stored()[savedField] === expected,
      `${field} did not apply immediately while preserving its filter`);
    await choose("Back to Reading preferences");
    check(input.value === `${field}…` && document.querySelector('[aria-selected="true"]')?.textContent?.includes(field),
      `${field} Back failed to restore the parent query and selection`);
  }
  await until(() => bodyFont() === "22px" && first().doc.defaultView!.getComputedStyle(first().doc.body).fontFamily === "sans-serif" &&
    view.renderer.getAttribute("max-inline-size") === "720", "field chooser preferences did not reach the real renderer");
  await choose("Reset typography and layout to Publisher");
  await until(() => bodyFont() === "20px" && !view.renderer.hasAttribute("max-inline-size"),
    "hierarchical preference reset did not reach the real renderer");
  await dismiss();
  coverage.push("six-field-immediate-application-back-and-reset");
  for (const continuous of [false, true]) {
    if (continuous) { await command("continuous_layout"); await until(() => view.renderer.getAttribute("flow") === "scrolled", "continuous layout did not settle"); }
    await ready();
    const original = metrics();
    const documentBefore = first().doc;
    const properties = ["font-size", "font-family"].map((name) => [name, documentBefore.body.style.getPropertyValue(name), documentBefore.body.style.getPropertyPriority(name)]);
    const publisherCss = documentBefore.getElementById("epubjs-inserted-css-clio-reading-preferences")!.textContent;
    const anchor = cfiFor(documentBefore.getElementById("p20")!);
    await view.goTo(anchor);
    await until(() => anchorVisible(anchor), "requested passage was not displayed before reflow");
    // display(target) exposes its whole page. Reflow preserves that page's
    // actual reading start, which need not be the requested paragraph.
    const captured = view.lastLocation?.cfi;
    check(captured && anchorVisible(captured), "pre-reflow reading start is not visible");
    check(!anchorVisible(cfiFor(documentBefore.getElementById("p63")!)), "offscreen passage passed the visibility probe");
    // Foliate can report an element-boundary reading start. Independently prove
    // the character visibility controls with a real text CFI on this spread.
    const controlParagraph = [...documentBefore.querySelectorAll("p")].find(element => anchorVisible(cfiFor(element)));
    check(controlParagraph, "visible spread has no text-boundary visibility control");
    const controlCfi = cfiFor(controlParagraph);
    const boundary = rangeFor(controlCfi);
    const node = boundary.startContainer;
    check(node.nodeType === Node.TEXT_NODE, "reading-start control needs a real text boundary");
    const text = node.textContent ?? "";
    const offset = boundary.startOffset;
    const parent = node.parentElement!;
    const display = parent.style.getPropertyValue("display");
    const priority = parent.style.getPropertyPriority("display");
    try {
      // Force the collapsed-whitespace boundary even when local font metrics
      // happen to map the spread start directly to a painted character.
      node.textContent = text.slice(0, offset) + "  " + text.slice(offset);
      check(anchorVisible(controlCfi), "collapsed whitespace obscured the visible reading-start text");
      node.textContent = text.slice(0, offset) + "   ";
      check(!anchorVisible(controlCfi), "missing reading-start text passed the visibility probe");
      node.textContent = text;
      parent.style.setProperty("display", "none", "important");
      check(!anchorVisible(controlCfi), "hidden reading-start text passed the visibility probe");
    } finally {
      node.textContent = text;
      if (display) parent.style.setProperty("display", display, priority);
      else parent.style.removeProperty("display");
    }
    check(anchorVisible(controlCfi), "visibility controls did not restore the reading-start text");
    await command("Font: Sans");
    check(document.activeElement?.classList.contains("command-filter"), "preference selection lost chooser focus");
    await choose("epub_text_larger"); await choose("epub_text_larger");
    await applied("24px");
    const changed = metrics();
    for (const id of ["inherited", "em", "rem", "px", "inline"]) {
      check(changed[id]!.font === "24px" && changed[id]!.family === "sans-serif", `${id}: explicit preference failed`);
    }
    check(parseFloat(changed.heading!.font) > parseFloat(changed.inherited!.font), "heading hierarchy lost");
    check(changed.code!.font === original.code!.font && changed.code!.family === original.code!.family, "code typography changed");
    for (const id of ["verse", "manual", "whitespace", "inline-code"]) check(changed[id]!.font === original[id]!.font, `${id}: protected prose changed`);
    // A table can fragment across columns; its union box includes column gaps.
    // Assert its actual CSS width, not the bounding union of those fragments.
    const tableWidth = first().doc.defaultView!.getComputedStyle(first().doc.getElementById("table")!).width;
    check(changed.image!.width === 120 && changed.image!.height === 60 && tableWidth === "240px",
      `media/table geometry changed: ${JSON.stringify({ image: changed.image, tableWidth })}`);
    await until(() => anchorVisible(captured), "captured reading start lost after font reflow");
    check(first().doc.getElementById("epubjs-inserted-css-clio-reading-preferences")!.textContent === publisherCss, "reader overwrote publisher CSS collision");
    await choose("Line spacing: Comfortable"); await choose("Alignment: Start");
    await until(() => first().doc.defaultView!.getComputedStyle(first().doc.getElementById("px")!).lineHeight === "38.400002px" || Math.abs(parseFloat(first().doc.defaultView!.getComputedStyle(first().doc.getElementById("px")!).lineHeight) - 38.4) < .1, "line spacing did not apply");
    check(first().doc.defaultView!.getComputedStyle(first().doc.getElementById("px")!).textAlign === "start", "logical alignment did not apply");
    for (let index = 0; index < 3; index += 1) await choose("epub_text_larger");
    for (let index = 0; index < 3; index += 1) await choose("epub_text_smaller");
    await applied("24px");
    check(stored().fontScale === 120, "latest typography intent lost");
    await until(() => anchorVisible(captured), "rapid typography changes lost the captured reading start");
    if (continuous) {
      const fullWidth = first().doc.getElementById("p20")!.getClientRects()[0]!.width;
      await choose("Reading column: Narrow");
      await until(() => first().doc.getElementById("p20")!.getClientRects()[0]!.width < fullWidth,
        "narrow reading column did not reduce actual prose width");
    }
    await choose("Reading column: Comfortable"); await choose("Margins: Comfortable");
    await until(() => first().doc.getElementById("p20")!.getClientRects()[0]!.width <= 720,
      "comfortable reading column exceeded its prose-width constraint");
    for (const theme of DOCUMENT_THEMES) {
      await choose(`theme_${theme.id.replace(/-/g, "_")}`);
      await until(() => stored().theme === theme.id, "theme did not persist");
      if (theme.foreground && theme.background) {
        const rgb = (hex: string) => `rgb(${[1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)).join(", ")})`;
        await until(() => first().doc.defaultView!.getComputedStyle(first().doc.body).backgroundColor === rgb(theme.background!), "theme did not apply");
        const paragraph = first().doc.getElementById("px")!;
        check(first().doc.defaultView!.getComputedStyle(paragraph).color === rgb(theme.foreground), "publisher prose obscured reader theme");
      }
    }
    await choose("epub_reset_typography");
    await until(() => bodyFont() === "20px" && !view.renderer.hasAttribute("max-inline-size"), "Publisher reset did not apply");
    check(stored().theme === "rose-pine-dawn", "typography reset discarded independent theme");
    await choose("theme_original");
    await until(() => !first().doc.getElementById("epubjs-inserted-css-clio-reading-preferences-1"), "Original failed to remove owned CSS");
    for (const [name, value, priority] of properties) {
      check(first().doc.body.style.getPropertyValue(name!) === value && first().doc.body.style.getPropertyPriority(name!) === priority, `Publisher inline ${name} not restored exactly`);
    }
    const reset = metrics();
    for (const id of Object.keys(original)) {
      check(reset[id]!.font === original[id]!.font && reset[id]!.family === original[id]!.family && reset[id]!.line === original[id]!.line, `${id}: Publisher metrics not restored`);
    }
    await dismiss();
    coverage.push(continuous ? "continuous-typography-reset-anchor" : "paged-typography-reset-anchor");
  }
  coverage.push("absolute-and-inline-css-exception", "protected-content-and-style-collision", "rapid-preferences-latest-wins", "eight-independent-themes", "reading-start-visibility-positive-and-negative-controls");
  await command("Font: Sans"); await choose("epub_text_larger"); await choose("epub_text_larger");
  await choose("Reading column: Comfortable"); await choose("Margins: Comfortable");
  await applied("24px"); await dismiss();
  await command("next_page");
  const savedAnchor = cfiFor(first().doc.getElementById("p20")!);
  await view.goTo(savedAnchor);
  await until(() => anchorVisible(savedAnchor), "saved passage was not displayed before close");
  const savedWidth = view.renderer.getAttribute("max-inline-size");
  await close(); await open(); await applied("24px");
  await until(() => anchorVisible(savedAnchor), "CFI reopening lost the saved passage");
  check(view.renderer.getAttribute("max-inline-size") === savedWidth,
    "reopening lost saved rendered reading width");
  coverage.push("cfi-reopen-and-preference-persistence");
  for (const name of ["fixed.epub", "mixed.epub", "vertical.epub"]) {
    await open(name, `/canonical/${name}`);
    await until(() => bodyFont() === "20px", `${name}: unsupported typography applied`);
    await command("epub_reading_preferences");
    check([...document.querySelectorAll('.command-state-text')].some((node) => /Fixed-layout|Vertical writing/.test(node.textContent ?? "")), "unsupported preferences not explained");
    check(stored().fontScale === 120, "fixed/vertical erased global preference");
    await dismiss();
  }
  coverage.push("fixed-mixed-and-vertical-retain-publisher");
  await open();
  const beforeFailure = view;
  const invalid = new Uint8Array(await (await fetch('/__fixtures/invalid.epub')).arrayBuffer());
  const transfer = new DataTransfer();
  transfer.items.add(new File([invalid], "invalid.epub"));
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await until(() => document.querySelector('.error-banner'), "invalid replacement did not report failure");
  check(view === beforeFailure && document.title === "preferences.epub — Clio", "failed replacement lost document identity");
  document.querySelector<HTMLButtonElement>('.error-banner button')!.click();
  for (const dark of [false, true]) for (const [width, height] of [[420, 600], [1000, 700], [1440, 800]]) {
    app.appearance(dark); await resize(width!, height!);
    await command("epub_reading_preferences");
    const paletteRect = document.querySelector('.command-palette')!.getBoundingClientRect();
    const activeRect = document.querySelector('[aria-selected="true"]')!.getBoundingClientRect();
    check(paletteRect.width <= innerWidth && activeRect.left >= 0 && activeRect.right <= innerWidth, "narrow chooser overflow");
    check(document.querySelector('.status-bar')!.getBoundingClientRect().height === 24, "footer height changed");
    await key("Escape");
    geometries.push({ width, height, dark, footer: 24 });
  }
  coverage.push("six-geometries-and-focus", "invalid-replacement-retains-identity");
  const previousDocument = first().doc;
  await view.goTo(1); await ready();
  check(first().doc !== previousDocument && bodyFont() === "24px", "chapter replacement lost the requested typography");
  const replacementDocument = first().doc;
  await open();
  check(!replacementDocument.defaultView?.frameElement?.isConnected &&
    replacementDocument.body.style.getPropertyValue("font-size") === "20px" &&
    replacementDocument.body.style.getPropertyPriority("font-size") === "important",
    "retired chapter retained typography ownership or lost publisher inline priority");
  coverage.push("chapter-document-style-replacement");
  const retired: Document[] = [];
  for (let cycle = 0; cycle < 20; cycle += 1) {
    retired.push(...contents().map((content) => content.doc));
    await command(cycle % 2 ? "continuous_layout" : "paged_layout");
    await close(); await open(cycle % 2 ? "replacement.epub" : "preferences.epub", "/canonical/preferences.epub");
    await applied(cycle % 2 ? "21.6px" : "24px");
  }
  await close();
  for (const document of retired) {
    check(["18px", "20px"].includes(document.body.style.getPropertyValue("font-size")), "retired Document retained reader font size");
    check(document.body.style.getPropertyPriority("font-size") === "important", "retired Document lost publisher inline priority");
  }
  coverage.push("twenty-close-reflow-replacement-cycles");
  bridge({ passed: true, coverage, geometries, cycles: 20 });
}
run().catch((cause: unknown) => bridge({ passed: false, error: cause instanceof Error ? `${cause.message}\n${cause.stack}` : String(cause), coverage, geometries }));
