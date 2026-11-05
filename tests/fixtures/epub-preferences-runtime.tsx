import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { Contents, Rendition } from "epubjs";
import type { EpubBook } from "../../src/epub/engine";
import type { ReaderFileSource } from "../../src/platform/tauriReaderFiles";
import { DOCUMENT_THEMES } from "../../src/reader/appearance";
import App from "../../src/App";
import "../../src/index.css";

type Access = { open: (source: ReaderFileSource) => Promise<void>; appearance: (dark: boolean) => void };
declare global {
  interface Window {
    __preferencesApp?: (app: Access) => void;
    __preferencesRendition?: (rendition: Rendition, book: EpubBook) => void;
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
let rendition: Rendition;
let book: EpubBook;
let serial = 0;
window.__preferencesApp = (value) => { app = value; };
window.__preferencesRendition = (value, owner) => { rendition = value; book = owner; serial += 1; };
window.__preferencesPositions = new Map();
const coverage: string[] = [];
const geometries: object[] = [];
const contents = () => rendition.getContents() as unknown as Contents[];
const first = () => contents().find((content) => content.sectionIndex === rendition.location.start.index)!;
const stored = () => JSON.parse(localStorage.getItem("clio:epub-reading-preferences")!);
const bodyFont = () => first().window.getComputedStyle(first().document.body).fontSize;
async function key(value: string, init: KeyboardEventInit = {}) {
  const target = document.activeElement ?? document.body;
  target.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...init }));
  target.dispatchEvent(new KeyboardEvent("keyup", { key: value, bubbles: true, ...init }));
  await settle();
}
async function filter(query: string) {
  const input = document.querySelector<HTMLInputElement>(".command-filter")!;
  check(input, "chooser disappeared");
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, query);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await settle();
}
async function choose(query: string) {
  await filter(query);
  const rows = document.querySelectorAll<HTMLElement>('[role="option"]');
  check(rows.length === 1, `ambiguous choice ${query}: ${[...rows].map((row) => row.textContent)}`);
  check(rows[0]!.getAttribute("aria-disabled") !== "true", `disabled choice ${query}`);
  await key("Enter");
}
async function palette() {
  if (document.querySelector(".command-filter")) await key("Escape");
  document.querySelector<HTMLElement>('[aria-label="EPUB reading area"],.document-viewport')!.focus();
  await key(":", { code: "Semicolon", shiftKey: true });
  await until(() => document.querySelector(".command-filter"), "commands did not open");
}
async function command(query: string) { await palette(); await choose(query); }
async function dismiss() {
  if (document.querySelector(".command-filter")) await key("Escape");
  check(document.activeElement?.getAttribute("aria-label") === "EPUB reading area", "Escape lost reader focus");
}
async function ready() {
  await until(() => rendition?.location?.start?.cfi && contents().length && document.querySelector('[aria-label="EPUB reading area"][aria-busy="false"]'), "EPUB never became ready");
  check(!document.querySelector('[role="alert"]'), "unexpected reader error");
}
async function open(name = "preferences.epub", path: string | null = "/canonical/preferences.epub") {
  const previous = serial;
  const bytes = new Uint8Array(await (await fetch(`/__fixtures/${name}`)).arrayBuffer());
  await app.open({ kind: "epub", bytes, name, path });
  await until(() => serial > previous, "replacement did not create rendition");
  await ready();
}
async function close() {
  await command("close_document");
  await until(() => !document.querySelector(".epub-reader") && document.title === "Clio", "close did not retire EPUB");
}
function metrics() {
  const content = first();
  return Object.fromEntries(["inherited", "em", "rem", "px", "inline", "heading", "code", "verse", "manual", "whitespace", "inline-code", "table", "image"].map((id) => {
    const element = content.document.getElementById(id)!;
    const style = content.window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return [id, { font: style.fontSize, family: style.fontFamily, line: style.lineHeight, whitespace: style.whiteSpace, width: rect.width, height: rect.height }];
  }));
}
function anchorVisible(cfi: string) {
  const range = rendition.getRange(cfi);
  const node = range.startContainer;
  const element = node.nodeType === 1 ? node as Element : node.parentElement!;
  const rect = element.getBoundingClientRect();
  const frame = element.ownerDocument.defaultView!.frameElement!.getBoundingClientRect();
  const viewport = document.querySelector('.epub-reader__viewport')!.getBoundingClientRect();
  const x = frame.left + rect.left, y = frame.top + rect.top;
  return x < viewport.right && x + rect.width > viewport.left && y < viewport.bottom && y + rect.height > viewport.top;
}
async function applied(size: string) {
  await until(() => Math.abs(parseFloat(bodyFont()) - parseFloat(size)) < .01 && !document.querySelector('.command-state-text')?.textContent?.includes("Requested"), `font ${size} did not apply`);
}
async function resize(width: number, height: number) {
  bridge({ resize: [width, height], scale: devicePixelRatio });
  await until(() => innerWidth === width && innerHeight === height, "resize dimensions did not settle");
  await until(() => document.querySelector('.epub-status__detail') || !document.querySelector('.epub-status')?.textContent?.includes("Page"), "reflow did not settle");
}

async function run() {
  localStorage.removeItem("clio:epub-reading-preferences");
  createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
  await until(() => app && document.querySelector('.document-viewport'), "App did not mount");
  await open();
  for (const continuous of [false, true]) {
    if (continuous) { await command("continuous_layout"); await until(() => !document.querySelector('.epub-status__detail'), "continuous layout did not settle"); }
    await ready();
    const original = metrics();
    const documentBefore = first().document;
    const properties = ["font-size", "font-family"].map((name) => [name, documentBefore.body.style.getPropertyValue(name), documentBefore.body.style.getPropertyPriority(name)]);
    const publisherCss = documentBefore.getElementById("epubjs-inserted-css-clio-reading-preferences")!.textContent;
    const anchor = first().cfiFromNode(documentBefore.getElementById("p20")!);
    await rendition.display(anchor); await settle();
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
    check(changed.image!.width === 120 && changed.image!.height === 60 && changed.table!.width === 240, "media/table geometry changed");
    check(anchorVisible(anchor), "captured passage lost after font reflow");
    check(first().document.getElementById("epubjs-inserted-css-clio-reading-preferences")!.textContent === publisherCss, "reader overwrote publisher CSS collision");
    await choose("Line spacing: Comfortable"); await choose("Alignment: Start");
    await until(() => first().window.getComputedStyle(first().document.getElementById("px")!).lineHeight === "38.400002px" || Math.abs(parseFloat(first().window.getComputedStyle(first().document.getElementById("px")!).lineHeight) - 38.4) < .1, "line spacing did not apply");
    check(first().window.getComputedStyle(first().document.getElementById("px")!).textAlign === "start", "logical alignment did not apply");
    for (let index = 0; index < 3; index += 1) await choose("epub_text_larger");
    for (let index = 0; index < 3; index += 1) await choose("epub_text_smaller");
    await applied("24px");
    check(stored().fontScale === 120, "latest typography intent lost");
    await choose("Reading column: Comfortable"); await choose("Margins: Comfortable");
    await until(() => document.querySelector<HTMLElement>('.epub-reader__viewport')!.style.maxWidth === "44rem", "column preference not applied outside iframe");
    for (const theme of DOCUMENT_THEMES) {
      await choose(`theme_${theme.id.replace(/-/g, "_")}`);
      await until(() => stored().theme === theme.id, "theme did not persist");
      if (theme.foreground && theme.background) {
        const rgb = (hex: string) => `rgb(${[1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)).join(", ")})`;
        await until(() => first().window.getComputedStyle(first().document.body).backgroundColor === rgb(theme.background!), "theme did not apply");
        const paragraph = first().document.getElementById("px")!;
        check(first().window.getComputedStyle(paragraph).color === rgb(theme.foreground), "publisher prose obscured reader theme");
      }
    }
    await choose("epub_reset_typography");
    await until(() => bodyFont() === "20px" && !document.querySelector<HTMLElement>('.epub-reader__viewport')!.style.maxWidth, "Publisher reset did not apply");
    check(stored().theme === "rose-pine-dawn", "typography reset discarded independent theme");
    await choose("theme_original");
    await until(() => !first().document.getElementById("epubjs-inserted-css-clio-reading-preferences-1"), "Original failed to remove owned CSS");
    for (const [name, value, priority] of properties) {
      check(first().document.body.style.getPropertyValue(name!) === value && first().document.body.style.getPropertyPriority(name!) === priority, `Publisher inline ${name} not restored exactly`);
    }
    const reset = metrics();
    for (const id of Object.keys(original)) {
      check(reset[id]!.font === original[id]!.font && reset[id]!.family === original[id]!.family && reset[id]!.line === original[id]!.line, `${id}: Publisher metrics not restored`);
    }
    await dismiss();
    coverage.push(continuous ? "continuous-typography-reset-anchor" : "paged-typography-reset-anchor");
  }
  coverage.push("absolute-and-inline-css-exception", "protected-content-and-style-collision", "rapid-preferences-latest-wins", "eight-independent-themes");
  await command("Font: Sans"); await choose("epub_text_larger"); await choose("epub_text_larger"); await applied("24px"); await dismiss();
  const savedAnchor = first().cfiFromNode(first().document.getElementById("p20")!);
  await rendition.display(savedAnchor); await settle();
  await close(); await open(); await applied("24px");
  check(anchorVisible(savedAnchor), "CFI reopening lost the saved passage");
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
  const beforeFailure = rendition;
  const invalid = new Uint8Array(await (await fetch('/__fixtures/invalid.epub')).arrayBuffer());
  const transfer = new DataTransfer();
  transfer.items.add(new File([invalid], "invalid.epub"));
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await until(() => document.querySelector('.error-banner'), "invalid replacement did not report failure");
  check(rendition === beforeFailure && document.title === "preferences.epub — Clio", "failed replacement lost document identity");
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
  const previousDocument = first().document;
  const frame = previousDocument.defaultView!.frameElement as HTMLIFrameElement;
  check(frame.getAttribute("sandbox") === "allow-same-origin", "publication script sandbox changed");
  frame.srcdoc = '<!doctype html><html><head><title>Replacement</title></head><body style="font-size:18px!important;font-family:serif!important"><p id="replacement">Same frame, new live Document.</p></body></html>';
  await until(() => frame.contentDocument !== previousDocument &&
    contents().some((content) => content.document === frame.contentDocument) &&
    Math.abs(parseFloat(frame.contentWindow!.getComputedStyle(frame.contentDocument!.body).fontSize) - 21.6) < .01,
    "same-frame Document replacement did not receive current preferences");
  check(!previousDocument.getElementById("epubjs-inserted-css-clio-reading-preferences-1") &&
    previousDocument.body.style.getPropertyPriority("font-size") === "important", "same-frame replacement retained old ownership");
  const replacementDocument = frame.contentDocument!;
  await open();
  check(!replacementDocument.getElementById("epubjs-inserted-css-clio-reading-preferences"), "replacement Document leaked reader styles");
  coverage.push("same-frame-document-style-replacement");
  const retired: Document[] = [];
  for (let cycle = 0; cycle < 20; cycle += 1) {
    retired.push(...contents().map((content) => content.document));
    await command(cycle % 2 ? "continuous_layout" : "paged_layout");
    await close(); await open(cycle % 2 ? "replacement.epub" : "preferences.epub", "/canonical/preferences.epub");
    await applied(cycle % 2 ? "21.6px" : "24px");
  }
  await close();
  for (const document of retired) {
    check(!document.getElementById("epubjs-inserted-css-clio-reading-preferences-1"), "retired Document retained reader styles");
    check(document.body.style.getPropertyPriority("font-size") === "important", "retired Document lost publisher inline priority");
  }
  coverage.push("twenty-close-reflow-replacement-cycles");
  bridge({ passed: true, coverage, geometries, cycles: 20 });
}
run().catch((cause: unknown) => bridge({ passed: false, error: cause instanceof Error ? `${cause.message}\n${cause.stack}` : String(cause), coverage, geometries }));
