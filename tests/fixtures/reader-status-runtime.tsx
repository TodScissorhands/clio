import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { EpubCFI } from "epubjs";
import type { Contents, Rendition } from "epubjs";
import type { EpubBook } from "../../src/epub/engine";
import type { ReaderFileSource } from "../../src/platform/tauriReaderFiles";
import App from "../../src/App";
import "../../src/index.css";

type Start = { cfi: string; index: number; href: string; displayed: { page: number; total: number } };
type Snapshot = { start: Start; end?: { cfi: string } };
type Disposable = { destroy: () => unknown };
type AppAccess = { open: (source: ReaderFileSource) => Promise<void>; appearance: (dark: boolean) => void };
declare global {
  interface Window {
    __readerStatusApp?: (app: AppAccess) => void;
    __readerStatusRendition?: (rendition: Rendition, book: EpubBook) => void;
    __readerStatusGate?: (kind: "pdf" | "epub", resource: Disposable) => Promise<void>;
    __readerStatusEngine?: (kind: "epub") => void;
    __readerStatusPositions?: Map<string, { cfi: string }>;
  }
}
const bridge = (message: object) => {
  // WebKitGTK's runner installs this native test-only message boundary.
  const host = window as unknown as {
    webkit: { messageHandlers: { test: { postMessage: (value: string) => void } } };
  };
  host.webkit.messageHandlers.test.postMessage(JSON.stringify(message));
};
function check(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}
const settle = () => {
  const { promise, resolve } = Promise.withResolvers<void>();
  requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  return promise;
};
async function until(predicate: () => unknown, message: string) {
  const deadline = performance.now() + 15_000;
  for (;;) {
    await settle();
    if (predicate()) {
      await settle();
      if (predicate()) return;
    }
    check(performance.now() < deadline, `${message}; title=${document.title}; status=${bar()?.textContent}`);
  }
}
let app: AppAccess;
let rendition: Rendition;
let book: EpubBook;
let serial = 0;
let requestedName = "";
let minimumSerial = 0;
let nextGate: "pdf" | "epub" | null = null;
type Gate = { kind: "pdf" | "epub"; release: () => void; destroys: number; resumed: boolean };
const gates: Gate[] = [];
const coverage: string[] = [];
const openingSnapshots: { label: string; detail: string }[] = [];
let epubPreparations = 0;
window.__readerStatusEngine = () => { epubPreparations += 1; };
window.__readerStatusApp = (value) => { app = value; };
window.__readerStatusRendition = (value, owner) => {
  if (book !== owner) {
    openingSnapshots.push({
      label: document.querySelector(".epub-status__chapter")?.textContent ?? "",
      detail: document.querySelector(".epub-status__detail")?.textContent ?? "",
    });
  }
  rendition = value; book = owner; serial += 1;
};
window.__readerStatusPositions = new Map();
window.__readerStatusGate = async (kind, resource) => {
  if (nextGate !== kind) return;
  nextGate = null;
  const deferred = Promise.withResolvers<void>();
  const gate: Gate = { kind, release: deferred.resolve, destroys: 0, resumed: false };
  const destroy = resource.destroy.bind(resource);
  resource.destroy = () => { gate.destroys += 1; return destroy(); };
  gates.push(gate);
  await deferred.promise;
  gate.resumed = true;
};
const bar = () => document.querySelector<HTMLElement>(".epub-status");
const label = () => bar()?.querySelector<HTMLElement>(".epub-status__chapter")?.textContent ?? "";
const detail = () => bar()?.querySelector<HTMLElement>(".epub-status__detail")?.textContent ?? "";
const location = () => rendition?.location as unknown as Snapshot | undefined;
const contents = () => rendition.getContents() as unknown as Contents[];
const compare = (left: string, right: string) => new EpubCFI().compare(left, right);
function focusReader() {
  const reader = document.querySelector<HTMLElement>('[aria-label="EPUB reading area"], .epub-viewport, .document-viewport');
  check(reader, "reader focus target missing"); reader!.focus();
}
async function key(value: string, init: KeyboardEventInit = {}) {
  const target = document.activeElement ?? document.body;
  target.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...init }));
  target.dispatchEvent(new KeyboardEvent("keyup", { key: value, bubbles: true, ...init }));
  await settle();
}
async function inputValue(input: HTMLInputElement, text: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
  input.dispatchEvent(new Event("input", { bubbles: true })); await settle();
}
async function palette() {
  focusReader(); await key(":", { shiftKey: true, code: "Semicolon" });
  await until(() => document.querySelector(".command-filter"), "palette did not open");
}
async function choose(query: string) {
  await inputValue(document.querySelector<HTMLInputElement>(".command-filter")!, query);
  check(document.querySelectorAll('[role="option"]').length === 1, `ambiguous command query: ${query}`);
  await key("Enter");
}
async function command(query: string) { await palette(); await choose(query); }
async function chapter(query: string) {
  await command("Go to chapter");
  await until(() => document.querySelector(".command-filter"), "chapter palette did not open");
  await choose(query);
  await readyEpub();
}
async function bytes(name: string) { return (await fetch(`/__fixtures/${name}`)).arrayBuffer(); }
async function select(file: File) {
  const transfer = new DataTransfer(); transfer.items.add(file);
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  input.files = transfer.files; input.dispatchEvent(new Event("change", { bubbles: true }));
  await settle();
}
async function open(name: string, displayName = name) {
  requestedName = displayName;
  if (name.endsWith(".epub")) minimumSerial = serial + 1;
  await select(new File([await bytes(name)], displayName));
}
async function direct(name: string, displayName = name, path: string | null = null) {
  requestedName = displayName;
  if (name.endsWith(".epub")) minimumSerial = serial + 1;
  await app.open({ kind: name.endsWith("pdf") ? "pdf" : "epub", bytes: new Uint8Array(await bytes(name)), name: displayName, path });
}
async function readyEpub(paged = true) {
  await until(() => {
    if (!bar() || !location()?.start || !contents().length || serial < minimumSerial || document.title !== `${requestedName} — Clio`) return false;
    const current = location()!;
    if (!contents().some((content) => content.sectionIndex === current.start.index)) return false;
    if (label() !== expectedLabel(current)) return false;
    const { page, total } = current.start.displayed;
    return paged ? detail().includes(`Page ${page} / ${total} in section`) : !detail();
  }, "EPUB status did not reach fresh layout");
  assertStatus(paged);
}
async function readyPdf(name = "status.pdf") {
  await until(() => document.title === `${name} — Clio` && document.querySelector(".pdfViewer .textLayer") && document.querySelector(".status-page")?.textContent?.includes("/ 3"), "PDF did not commit and render");
}
async function close() {
  await command("Close document");
  await until(() => document.title === "Clio" && !bar() && document.querySelector(".document-viewport"), "close did not clear committed document identity");
}
function expectedLabel(snapshot: Snapshot) {
  const index = snapshot.start.index;
  if (index === 1) return "Chapter One · Section 2";
  if (index === 2) return "A long labeled section within Chapter One with enough descriptive words to exercise restrained single-line truncation at narrow widths";
  if (index === 3) return "Chapter Two";
  if (index !== 0) return `Section ${index + 1}`;
  const live = contents().find((content) => content.document?.getElementById("opening") &&
    content.sectionIndex === index);
  check(live, "first visible section lacks its live Contents");
  let result = "Chapter One";
  for (const [id, text] of [["opening", "Opening passage"], ["deep", "Nested deep passage"], ["Δ", "Unicode passage"]]) {
    const element = live!.document.getElementById(id!)!;
    const cfi = live!.cfiFromNode(element);
    if (compare(cfi, snapshot.start.cfi) <= 0) result = text!;
  }
  return result;
}
function assertStatus(paged: boolean, noToc = false) {
  const current = location()!; check(current?.start, "real first-visible location missing");
  const expected = noToc ? `Section ${current.start.index + 1}` : expectedLabel(current);
  check(label() === expected, `wrong first-visible label: expected ${expected}, received ${label()}`);
  if (paged) {
    const { page, total } = current.start.displayed;
    check(Number.isInteger(page) && page >= 1 && total >= page, "real rendition returned unusable paged fields");
    check(detail().includes(`Page ${page} / ${total} in section`), `status counts differ from current layout: ${detail()} versus ${page}/${total}`);
  } else check(!detail() && !bar()!.textContent!.includes("%"), "continuous layout invented a page or percentage");
}
async function display(target: string, paged = true) {
  await rendition.display(target); await readyEpub(paged);
}
function contrast(foreground: string, background: string) {
  const luminance = (value: string) => {
    const channels = value.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((part) => {
      const channel = part / 255; return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    });
    return channels[0]! * .2126 + channels[1]! * .7152 + channels[2]! * .0722;
  };
  const [low, high] = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
  return (high! + .05) / (low! + .05);
}
async function resize(width: number, height: number) {
  bridge({ resize: [width, height], scale: devicePixelRatio });
  await until(() => innerWidth === width && innerHeight === height, `viewport did not resize to ${width}x${height}`);
}
function geometry() {
  const footer = bar()!; const bounds = footer.getBoundingClientRect(); const style = getComputedStyle(footer);
  check(bounds.height === 24 && Math.abs(bounds.bottom - innerHeight) <= 1, "EPUB footer is not the external bottom 24px");
  check(footer.scrollWidth <= footer.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth, "status causes horizontal overflow");
  check(footer.getAttribute("aria-label") === "EPUB reading status" && footer.getAttribute("aria-live") === "off" && footer.getAttribute("role") !== "status", "status must have a non-live accessible name");
  const primary = footer.querySelector<HTMLElement>(".epub-status__chapter")!;
  const secondary = footer.querySelector<HTMLElement>(".epub-status__detail")!;
  check(primary.title === label() && primary.closest('[aria-hidden="true"]'), "visible label lacks its full title or duplicates accessibility text");
  check(secondary.closest('[aria-hidden="true"]'), "visible pagination must not duplicate accessible description");
  const hidden = footer.querySelector<HTMLElement>(".visually-hidden")!;
  check(hidden?.textContent?.includes(label()), "full accessible chapter description missing");
  const current = location()!.start.displayed;
  check(hidden.textContent!.includes(`First visible page ${current.page} of ${current.total} in this section`), "accessible local pagination missing");
  check((getComputedStyle(secondary).display === "none") === (innerWidth <= 600), "narrow secondary-count policy regressed");
  for (const element of [primary, secondary]) {
    if (getComputedStyle(element).display === "none") continue;
    const rect = element.getBoundingClientRect();
    check(rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1 && rect.right <= bounds.right + 1, "status text wraps or escapes footer");
  }
  for (const frame of document.querySelectorAll<HTMLIFrameElement>(".epub-reader iframe")) {
    check(frame.getBoundingClientRect().bottom <= bounds.top + 1, "publication iframe overlaps the external footer");
  }
  const ratio = contrast(getComputedStyle(primary).color, style.backgroundColor);
  check(ratio >= 4.5 && style.fontSize === "11px", `status typography or contrast regressed: ${ratio}`);
  check(!footer.querySelector("button, input, a, [tabindex]"), "status introduced a focus target");
  return { barHeight: bounds.height, ratio, text: footer.textContent, cfi: location()!.start.cfi };
}
async function invalid(name: string, retainedTitle: string, retainedFormat: "pdf" | "epub") {
  const owner = book; const content = document.querySelector(".pdfViewer");
  await open(name);
  await until(() => document.querySelector(".error-banner"), `invalid ${name} did not report its real engine error`);
  check(document.title === retainedTitle, "invalid replacement changed the committed title");
  if (retainedFormat === "epub") { check(book === owner && bar(), "invalid replacement unmounted the active EPUB"); assertStatus(true); }
  else check(document.querySelector(".pdfViewer") === content && document.querySelector(".pdfViewer .textLayer"), "invalid replacement discarded the PDF");
  document.querySelector<HTMLButtonElement>(".error-banner button")!.click();
  await until(() => !document.querySelector(".error-banner"), "error dismissal failed");
}
async function hold(kind: "pdf" | "epub") {
  const count = gates.length; nextGate = kind;
  await open(kind === "pdf" ? "status.pdf" : "no-toc.epub", `held-${kind}.${kind}`);
  await until(() => gates.length > count, `${kind} did not reach its real preparation boundary`);
  return gates.at(-1)!;
}
async function run() {
  await until(() => app && document.querySelector(".document-viewport"), "real App did not mount");
  check(document.title === "Clio", "closed App title is not Clio");
  await resize(1000, 700); await open("status.epub"); await readyEpub();
  check(document.title === "status.epub — Clio", "EPUB filename was not committed");
  const first = location()!.start.cfi;
  focusReader(); await key("PageDown");
  await until(() => location()!.start.cfi !== first, "host PageDown did not move the real rendition"); await readyEpub();
  const forward = location()!.start.cfi;
  await key("PageUp"); await until(() => location()!.start.cfi !== forward, "host PageUp did not reverse the real rendition"); await readyEpub();
  coverage.push("paged-and-page-turns");

  for (const query of ["Opening passage", "Nested deep passage", "Unicode passage"]) {
    await chapter(query);
    // The actual first-visible CFI, not the requested target, determines status.
    assertStatus(true);
  }
  await display("section-0.xhtml#deep");
  for (let turn = 0; turn < 4 && label() !== "Nested deep passage"; turn += 1) { await rendition.next(); await readyEpub(); }
  check(label() === "Nested deep passage", "equal-boundary alias did not prefer the deeper TOC entry");
  await display("section-0.xhtml#%CE%94");
  const unicodeContents = contents().find((content) => content.sectionIndex === 0)!;
  const unicodeTarget = unicodeContents.cfiFromNode(unicodeContents.document.getElementById("Δ")!);
  await display(unicodeTarget);
  for (let turn = 0; turn < 4 && label() !== "Unicode passage"; turn += 1) { await rendition.next(); await readyEpub(); }
  check(label() === "Unicode passage", "encoded fragment did not become the applicable real label, or unresolved fragments shadowed it");
  await display("section-1.xhtml"); check(label() === "Chapter One · Section 2", "multi-file parent gap lost its section identity");
  await display("section-4.xhtml"); check(label() === "Section 5", "blank TOC label invented a chapter number");
  await display("section-5.xhtml"); check(label() === "Section 6", "nonlinear section inherited a chapter range");
  coverage.push("nested-fragments-aliases-and-parent-gap");

  await display("section-0.xhtml"); await command("Continuous layout"); await readyEpub(false);
  const container = document.querySelector<HTMLElement>(".epub-container")!;
  for (let step = 0; step < 100 && location()!.start.index === 0; step += 1) {
    container.scrollBy({ top: container.clientHeight * .85, behavior: "auto" }); await settle();
  }
  await until(() => location()!.start.index > 0, "real continuous scroll did not cross a spine boundary");
  assertStatus(false);
  await command("Paged layout"); await readyEpub();
  coverage.push("continuous-scroll-and-layout-switch");

  await display("section-2.xhtml");
  const cases: object[] = [];
  for (const dark of [false, true]) {
    app.appearance(dark); await settle();
    for (const [width, height] of [[420, 600], [1000, 700], [1440, 800]]) {
      await resize(width!, height!); await readyEpub();
      assertStatus(true); const measured = geometry();
      const before = document.querySelector<HTMLElement>(".epub-reader")!.getBoundingClientRect().height;
      await palette();
      check(!bar() || getComputedStyle(bar()!).display === "none", "EPUB footer did not hide during commands palette");
      check(document.activeElement === document.querySelector(".command-filter"), "palette did not retain filter focus");
      await key("Tab"); await key("Tab", { shiftKey: true });
      check(document.activeElement === document.querySelector(".command-filter"), "palette focus model regressed");
      check(document.querySelector<HTMLElement>(".epub-reader")!.getBoundingClientRect().height === before, "palette returned footer space to publication layout");
      await key("Escape"); await readyEpub();
      check(document.activeElement?.getAttribute("aria-label") === "EPUB reading area", "palette Escape did not restore host reader focus");
      cases.push({ width: innerWidth, height: innerHeight, dark, ...measured });
    }
  }
  coverage.push("six-geometries-and-appearances");

  let invalidated = false;
  const observer = new MutationObserver(() => { if (bar() && !detail()) invalidated = true; });
  observer.observe(document.querySelector(".epub-reader")!, { childList: true, subtree: true, characterData: true });
  try {
    await resize(420, 600); await readyEpub();
    check(invalidated, "resize retained old numeric status through debounce/reflow");
    invalidated = false; await command("Continuous layout"); await readyEpub(false);
    await command("Paged layout"); await readyEpub();
    check(invalidated, "layout switch did not invalidate prior numbers");
  } finally { observer.disconnect(); }
  coverage.push("resize-freshness");

  for (const payload of [undefined, {}, { start: { index: 999, displayed: { page: 1, total: 2 } } },
    { start: { index: 2, displayed: { page: NaN, total: 2 } } },
    { start: { index: 2, displayed: { page: 1.5, total: 3 } } },
    { start: { index: 2, displayed: { page: 4, total: 3 } } },
    { start: { ...location()!.start, index: 0 } }]) {
    rendition.emit("relocated", payload); await settle();
    check(!detail(), "malformed relocation retained or fabricated numeric pages");
    check(!!label(), "malformed relocation erased readable neutral metadata");
  }
  await display("section-2.xhtml");
  await open("no-toc.epub");
  await until(() => document.title === "no-toc.epub — Clio" && /^Section \d+$/.test(label()) && /Page/.test(detail()), "empty TOC did not render Section fallback");
  for (const target of ["section-0.xhtml", "section-2.xhtml", "section-4.xhtml"]) {
    await rendition.display(target); await until(() => label() === `Section ${location()!.start.index + 1}` && /Page/.test(detail()), "empty TOC navigation did not update section"); assertStatus(true, true);
  }
  coverage.push("empty-toc-and-malformed-location");

  await direct("status.epub", "restored.epub", "/status-fixture.epub"); await readyEpub();
  await display("section-0.xhtml#deep"); await rendition.next(); await readyEpub();
  const savedVisible = location()!.start.cfi;
  await close();
  await until(() => window.__readerStatusPositions!.get("/status-fixture.epub")?.cfi, "canonical session did not flush its real CFI");
  const saved = window.__readerStatusPositions!.get("/status-fixture.epub")!.cfi;
  check(saved === savedVisible, "position session saved an unrelated location");
  await direct("status.epub", "restored.epub", "/status-fixture.epub"); await readyEpub();
  const restored = location()!;
  check(compare(restored.start.cfi, saved) <= 0 && restored.end && compare(saved, restored.end.cfi) <= 0, "reopen did not restore the saved passage to the visible spread");
  const range = await book.getRange(saved);
  const restoredPassage = range.startContainer.textContent ?? range.startContainer.parentElement?.textContent ?? "";
  check(/Status section 1|Section 1: passage|Reading status section 1/.test(restoredPassage), "restored canonical CFI does not resolve to fixture passage");
  assertStatus(true); coverage.push("cfi-close-reopen");

  await invalid("invalid.epub", "restored.epub — Clio", "epub");
  await invalid("invalid.pdf", "restored.epub — Clio", "epub");
  await open("status.pdf"); await readyPdf();
  await invalid("invalid.pdf", "status.pdf — Clio", "pdf");
  await invalid("invalid.epub", "status.pdf — Clio", "pdf");
  coverage.push("failed-replacements-both-formats");
  focusReader(); await key("J");
  await until(() => document.querySelector(".status-page")?.textContent?.includes("Page 2 / 3"), "PDF physical-page navigation regressed");
  await command("recolor_preset_sepia_warm");
  check(document.querySelector(".status-preset")?.textContent, "PDF preset status disappeared");
  focusReader(); await key("g");
  const pageInput = document.querySelector<HTMLInputElement>('[aria-label="Page number"]')!;
  check(pageInput, "PDF page input missing"); await inputValue(pageInput, "3"); await key("Enter");
  await until(() => document.querySelector(".status-page")?.textContent?.includes("Page 3 / 3"), "PDF page input no longer navigates");
  await close(); coverage.push("pdf-status-navigation-and-close");

  // Supersession begins at selection, before B's bytes exist. An older real
  // PDF preparation must not commit into the retained reader during that gap.
  await open("status.pdf", "retained.pdf"); await readyPdf("retained.pdf");
  const obsoletePdf = await hold("pdf");
  const delayed = new File([await bytes("status.epub")], "newer-acquisition.epub");
  const readDelayed = delayed.arrayBuffer.bind(delayed);
  const acquisitionGate = Promise.withResolvers<void>();
  let acquisitionEntered = false;
  Object.defineProperty(delayed, "arrayBuffer", { configurable: true, value: async () => {
    acquisitionEntered = true;
    await acquisitionGate.promise;
    return readDelayed();
  } });
  try {
    await select(delayed);
    await until(() => acquisitionEntered, "newer browser acquisition did not enter its real File read");
    obsoletePdf.release();
    await until(() => obsoletePdf.resumed && obsoletePdf.destroys === 1, "new acquisition did not retire the older PDF preparation");
    check(document.title === "retained.pdf — Clio" && document.querySelector(".pdfViewer .textLayer") && !bar(),
      "old PDF committed while the superseding file acquisition was still pending");
    requestedName = "newer-acquisition.epub"; minimumSerial = serial + 1;
    acquisitionGate.resolve();
    await readyEpub();
  } finally { obsoletePdf.release(); acquisitionGate.resolve(); }
  await close();

  for (const terminate of ["replace", "close"] as const) {
    await open("status.epub"); await readyEpub();
    const retained = book;
    const gate = await hold("pdf");
    try {
      check(book === retained && document.title === "status.epub — Clio" && bar(), "EPUB cut over before PDF preparation completed");
      if (terminate === "replace") { await open("status.epub", "latest.epub"); await readyEpub(); await until(() => document.title === "latest.epub — Clio", "replacement EPUB did not commit"); }
      else await close();
    } finally { gate.release(); }
    await until(() => gate.destroys === 1, "unclaimed prepared PDF task was not released exactly once");
    await settle();
    check(document.title === (terminate === "replace" ? "latest.epub — Clio" : "Clio"), "stale prepared PDF resurrected its document/title");
  }
  // A successfully transferred prepared candidate is owned by PdfReader, not App.
  await open("status.epub"); await readyEpub();
  const transferred = await hold("pdf");
  try { transferred.release(); await readyPdf("held-pdf.pdf"); check(transferred.destroys === 0, "App destroyed the transferred active PDF"); await close(); }
  finally { transferred.release(); }
  await until(() => transferred.destroys === 1, "transferred PDF was not closed exactly once by its reader");
  coverage.push("prepared-pdf-supersession-and-close");

  for (const terminate of ["replace", "close"] as const) {
    await open("status.epub"); await readyEpub();
    const gate = await hold("epub");
    try {
      if (terminate === "replace") { await open("status.pdf"); await readyPdf(); }
      else await close();
    } finally { gate.release(); }
    await until(() => gate.destroys === 1, "obsolete prepared EPUB was not destroyed exactly once");
    check(document.title === (terminate === "replace" ? "status.pdf — Clio" : "Clio"), "stale EPUB completion resurrected title");
  }
  coverage.push("epub-supersession-and-close");

  const slow = new File([await bytes("status.epub")], "slow-A.epub");
  const fast = new File([await bytes("status.pdf")], "fast-B.pdf");
  const original = slow.arrayBuffer.bind(slow);
  const readGate = Promise.withResolvers<void>();
  const readFinished = Promise.withResolvers<void>();
  let entered = false;
  const preparationsBeforeSlowRead = epubPreparations;
  Object.defineProperty(slow, "arrayBuffer", { configurable: true, value: async () => {
    entered = true;
    await readGate.promise;
    try { return await original(); }
    finally { readFinished.resolve(); }
  } });
  try {
    await select(slow); await until(() => entered, "real file-input path did not call delayed File.arrayBuffer");
    await select(fast); await readyPdf("fast-B.pdf");
  } finally { readGate.resolve(); }
  // Let the old genuine File read and engine queue drain before asserting B.
  await readFinished.promise; await settle(); await settle();
  check(epubPreparations === preparationsBeforeSlowRead, "stale browser acquisition reached the EPUB engine after B committed");
  check(document.title === "fast-B.pdf — Clio" && document.querySelector(".pdfViewer .textLayer") && !bar(), "late File.arrayBuffer completion stole document identity");
  coverage.push("browser-array-buffer-ordering");

  const unusual = "Résumé & <Notes> “一”.epub";
  await open("status.epub", unusual); await readyEpub();
  check(document.title === `${unusual} — Clio`, "literal Unicode/markup-looking filename was escaped, normalized or replaced by metadata");
  check(!document.querySelector("Notes"), "filename was interpreted as HTML");
  await close(); coverage.push("literal-filename");
  check(nextGate === null && gates.every((gate) => gate.destroys === 1), "candidate preparation ownership leaked or double-destroyed");
  check(openingSnapshots.every((snapshot) => snapshot.label === "EPUB" && !snapshot.detail), "new Book flashed the previous Book's label or pagination before its effect");
  bridge({ passed: true, cases, coverage, renditionInstances: serial, candidates: gates.map(({ kind, destroys }) => ({ kind, destroys })) });
}
window.addEventListener("error", (event) => bridge({ passed: false, error: event.message }));
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
void run().catch((error: unknown) => bridge({ passed: false, error: String(error), stack: error instanceof Error ? error.stack : undefined, coverage, location: location(), label: label(), detail: detail() }))
  .finally(() => { nextGate = null; for (const gate of gates) gate.release(); });
