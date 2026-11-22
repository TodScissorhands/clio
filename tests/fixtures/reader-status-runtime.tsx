import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { View } from "foliate-js/view.js";
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
    __readerStatusView?: (view: View) => void;
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
let view: View;
let book: View["book"];
let serial = 0;
let requestedName = "";
let minimumSerial = 0;
let nextGate: "pdf" | "epub" | null = null;
type Gate = { kind: "pdf" | "epub"; release: () => void; destroys: number; resumed: boolean };
const gates: Gate[] = [];
const coverage: string[] = [];
const scrolling: Record<string, unknown> = {};
const openingSnapshots: { label: string; detail: string }[] = [];
const destinations: object[] = [];
const reversals: object[] = [];
let epubPreparations = 0;
const epubOnly = new URLSearchParams(window.location.search).has("epubOnly");
window.__readerStatusEngine = () => { epubPreparations += 1; };
window.__readerStatusApp = (value) => { app = value; };
window.__readerStatusView = (value) => {
  if (view !== value) {
    openingSnapshots.push({
      label: document.querySelector(".epub-status__chapter")?.textContent ?? "",
      detail: document.querySelector(".epub-status__progress")?.textContent ?? "",
    });
  }
  view = value; book = value.book; serial += 1;
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
const detail = () => bar()?.querySelector<HTMLElement>(".epub-status__progress")?.textContent ?? "";
const location = (): Snapshot | undefined => view?.lastLocation ? {
  start: { cfi: view.lastLocation.cfi, index: view.resolveCFI(view.lastLocation.cfi).index, href: "",
    displayed: { page: (view.renderer.page ?? NaN) + 1, total: view.renderer.pages ?? NaN } },
} : undefined;
const contents = () => view.renderer.getContents();
function focusReader() {
  const reader = document.querySelector<HTMLElement>('[aria-label="EPUB reading area"], .epub-viewport, .document-viewport');
  check(reader, "reader focus target missing"); reader!.focus();
}
async function key(value: string, init: KeyboardEventInit = {}) {
  const method = value === "PageDown" ? "next" : value === "PageUp" ? "prev" : null;
  const original = method ? view[method] : null;
  let completion: ReturnType<View["next"]> | undefined;
  if (method && original) view[method] = (distance?: number) => completion = original.call(view, distance);
  try {
    const target = document.activeElement ?? document.body;
    target.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...init }));
    target.dispatchEvent(new KeyboardEvent("keyup", { key: value, bubbles: true, ...init }));
    await completion;
    await settle();
  } finally {
    if (method && original) view[method] = original;
  }
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
async function chapter(query: string, paged = true) {
  await command("Go to chapter");
  await until(() => document.querySelector(".command-filter"), "chapter palette did not open");
  const original = view.goTo;
  let navigation: ReturnType<View["goTo"]> | undefined;
  view.goTo = target => navigation = original.call(view, target);
  try {
    await choose(query);
    check(navigation, `${query} did not navigate through the reader`);
    await navigation;
  } finally {
    view.goTo = original;
  }
  await readyEpub(paged);
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
  let progressView = view;
  let progressCfi = progressView?.lastLocation?.cfi;
  let progress = progressCfi ? await progressView.getCFIProgress(progressCfi) : null;
  await until(() => {
    if (!bar() || !location()?.start || !contents().length || serial < minimumSerial || document.title !== `${requestedName} — Clio`) return false;
    const current = location()!;
    if (!contents().some((content) => content.index === current.start.index)) return false;
    if (label() !== expectedLabel(current)) return false;
    if (view !== progressView || current.start.cfi !== progressCfi) {
      const candidateView = progressView = view;
      const candidateCfi = progressCfi = current.start.cfi;
      progress = null;
      void candidateView.getCFIProgress(candidateCfi).then(result => {
        if (progressView === candidateView && progressCfi === candidateCfi) progress = result;
      });
    }
    // One readiness snapshot: a separate percentage wait adds another native
    // event-loop checkpoint between navigation and the next layout command.
    return progress && Number.isFinite(progress.fraction) &&
      detail().trim() === `${Math.round(progress.fraction * 100)}% ·`;
  }, "EPUB location and current-CFI percentage did not reach fresh layout");
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
  if (requestedName === "destinations.epub") return `Chapter ${String(index + 1).padStart(2, "0")}`;
  if (requestedName === "reversal.epub") return ["Chapter 1", "Section 2", "Chapter 2", "Chapter 3"][index]!;
  if (!book.toc?.length) return `Section ${index + 1}`;
  // Fixture-specific oracle: real destinations and live heading positions,
  // independent of Foliate's TOCProgress and Clio's status adapter.
  if (index === 0) {
    const doc = contents().find(content => content.index === 0)!.doc;
    const start = view.resolveCFI(snapshot.start.cfi).anchor(doc);
    start.collapse(true);
    for (const [id, title] of [["Δ", "Unicode passage"], ["deep", "Nested deep passage"], ["opening", "Opening passage"]]) {
      const heading = doc.getElementById(id!);
      if (heading && start.comparePoint(heading, 0) <= 0) return title!;
    }
    return "Chapter One";
  }
  if (index === 1) return "Chapter One · Section 2";
  if (index === 2) return "A long labeled section within Chapter One with enough descriptive words to exercise restrained single-line truncation at narrow widths";
  if (index === 3) return "Chapter Two";
  return `Section ${index + 1}`;
}
function assertStatus(paged: boolean, noToc = false) {
  const current = location()!; check(current?.start, "real first-visible location missing");
  const expected = noToc ? `Section ${current.start.index + 1}` : expectedLabel(current);
  check(label() === expected, `wrong first-visible label: expected ${expected}, received ${label()}`);
  check(/\d+%/.test(detail()), "publication percentage missing");
  check(view.renderer.getAttribute("flow") === (paged ? "paginated" : "scrolled"), "requested reading mode did not apply");
}
async function display(target: string, paged = true) {
  const destination = view.resolveNavigation(target);
  check(destination && destination.index >= 0 && destination.index < book.sections.length,
    `unresolved navigation target: ${target}`);
  const arrived = await view.goTo(target);
  check(arrived?.index === destination!.index, `navigation rejected target: ${target}`);
  await until(() => location()?.start.index === destination!.index &&
    view.resolveCFI(location()!.start.cfi).index === destination!.index,
    `navigation did not reach requested section: ${target}`);
  await readyEpub(paged);
}
function cfiVisible(cfi: string) {
  const { index, anchor } = view.resolveCFI(cfi);
  const doc = contents().find(content => content.index === index)?.doc;
  const frame = doc?.defaultView?.frameElement?.getBoundingClientRect();
  const viewport = view.renderer.shadowRoot?.querySelector<HTMLElement>("#container");
  if (!doc || !frame || !viewport) return false;
  const range = anchor(doc).cloneRange();
  if (range.startContainer.nodeType === Node.ELEMENT_NODE) {
    const target = range.startContainer.childNodes[range.startOffset];
    if (!target) return false;
    range.selectNodeContents(target);
  }
  // A CFI boundary need not paint a caret. Inspect its next painted character
  // in the same node; never substitute a neighboring visible passage.
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
  const bounds = viewport.getBoundingClientRect();
  return Array.from(range.getClientRects()).some(rect => rect.width > 0 && rect.height > 0 &&
    frame.top + rect.bottom > bounds.top && frame.top + rect.top < bounds.bottom &&
    frame.left + rect.right > bounds.left && frame.left + rect.left < bounds.right);
}
function clippedFrameBounds(frame: Element) {
  const rect = frame.getBoundingClientRect();
  const clipped = { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
  let parent: Element | null = frame.parentElement;
  while (parent) {
    const style = getComputedStyle(parent);
    const bounds = parent.getBoundingClientRect();
    if (/hidden|clip|scroll|auto/.test(style.overflowX)) {
      clipped.left = Math.max(clipped.left, bounds.left); clipped.right = Math.min(clipped.right, bounds.right);
    }
    if (/hidden|clip|scroll|auto/.test(style.overflowY)) {
      clipped.top = Math.max(clipped.top, bounds.top); clipped.bottom = Math.min(clipped.bottom, bounds.bottom);
    }
    const root = parent.getRootNode();
    parent = parent.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
  }
  return clipped;
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
  const secondary = footer.querySelector<HTMLElement>(".epub-status__progress")!;
  check(primary.title === label() && primary.closest('[aria-hidden="true"]'), "visible label lacks its full title or duplicates accessibility text");
  check(secondary.closest('[aria-hidden="true"]'), "visible progress must not duplicate accessible description");
  const hidden = footer.querySelector<HTMLElement>(".visually-hidden")!;
  check(hidden?.textContent?.includes(label()) && hidden.textContent.includes("% of book"), "accessible chapter and whole-book progress missing");
  check(getComputedStyle(secondary).display !== "none" && secondary.getBoundingClientRect().width > 0, "narrow footer lost primary progress");
  for (const element of [primary, secondary]) {
    if (getComputedStyle(element).display === "none") continue;
    const rect = element.getBoundingClientRect();
    check(rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1 && rect.right <= bounds.right + 1, "status text wraps or escapes footer");
  }
  for (const { doc } of contents()) {
    const frame = doc.defaultView?.frameElement;
    check(frame, "live publication frame missing");
    const painted = clippedFrameBounds(frame!);
    if (painted.right > painted.left && painted.bottom > painted.top) {
      check(painted.bottom <= bounds.top + 1, "visible publication paint overlaps the external footer");
    }
  }
  const ratio = contrast(getComputedStyle(primary).color, style.backgroundColor);
  check(ratio >= 4.5 && style.fontSize === "11px", `status typography or contrast regressed: ${ratio}`);
  const commands = footer.querySelector<HTMLButtonElement>(".status-commands")!;
  check(commands?.getAttribute("aria-label") === "Open reader commands (:)", "status lacks an accessible commands entry");
  const button = commands.getBoundingClientRect();
  check(button.height === 24 && button.left >= bounds.left && button.right <= bounds.right, "commands target escapes the reserved status bar");
  check(footer.querySelector(".status-document")!.getBoundingClientRect().right <= button.left, "commands target overlaps reading location");
  check(contrast(getComputedStyle(commands).color, style.backgroundColor) >= 4.5, "commands entry lacks readable contrast");
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
  const visiblePassage = (topFraction = 0, bottomFraction = 1) => {
    const viewport = view.renderer.shadowRoot!.querySelector<HTMLElement>("#container")!;
    const rect = viewport.getBoundingClientRect();
    const bounds = { left: rect.left, right: rect.right,
      top: rect.top + rect.height * topFraction, bottom: rect.top + rect.height * bottomFraction };
    let first: { index: number; paragraph: string; top: number; left: number; cfi: string } | null = null;
    for (const { doc, index } of contents()) {
      const frame = doc.defaultView?.frameElement?.getBoundingClientRect();
      if (!frame || frame.bottom <= bounds.top || frame.top >= bounds.bottom ||
        frame.right <= bounds.left || frame.left >= bounds.right) continue;
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent?.trim()) continue;
        const textBounds = doc.createRange();
        textBounds.selectNodeContents(node);
        if (!Array.from(textBounds.getClientRects()).some(rect => rect.width > 0 && rect.height > 0 &&
          frame.top + rect.bottom > bounds.top && frame.top + rect.top < bounds.bottom &&
          frame.left + rect.right > bounds.left && frame.left + rect.left < bounds.right)) continue;
        for (const match of node.textContent.matchAll(/\S/gu)) {
          const range = doc.createRange();
          range.setStart(node, match.index);
          range.setEnd(node, match.index + match[0].length);
          const rect = Array.from(range.getClientRects()).find(rect => rect.width > 0 && rect.height > 0 &&
            frame.top + rect.bottom > bounds.top && frame.top + rect.top < bounds.bottom &&
            frame.left + rect.right > bounds.left && frame.left + rect.left < bounds.right);
          if (!rect) continue;
          const top = frame.top + rect.top;
          const left = frame.left + rect.left;
          if (!first || top < first.top || (top === first.top && left < first.left))
            first = { index, paragraph: node.textContent.trim().slice(0, 100), top, left, cfi: view.getCFI(index, range) };
          break;
        }
        if (first?.index !== index) continue;
        break;
      }
    }
    return first;
  };
async function destinationProbe() {
  const path = "/destinations.epub";
  await direct("destinations.epub", "destinations.epub", path); await readyEpub();
  const failures: string[] = [];
  for (const paged of [true, false]) {
    if (!paged) { await command("Continuous layout"); await readyEpub(false); }
    for (const route of ["toc", "link", "fragment"]) {
      for (const number of [48, 49, 48, 47, 1, 50]) {
        const href = `EPUB/chapter-${number}.xhtml${route === "fragment" ? "#opening" : ""}`;
        const resolved = view.resolveNavigation(href)!;
        if (route === "toc") await chapter(`Chapter ${String(number).padStart(2, "0")}`, paged);
        else {
          const original = view.goTo;
          let navigation: Promise<{ index: number } | undefined> | undefined;
          view.goTo = target => navigation = original.call(view, target);
          try {
            const doc = contents().find(content => content.index === location()!.start.index)!.doc;
            doc.getElementById(`${route === "fragment" ? "fragment" : "to"}-${number}`)!.click();
            check(navigation, "publication link did not invoke navigation");
            await navigation;
          } finally { view.goTo = original; }
          await readyEpub(paged);
        }
        await until(() => window.__readerStatusPositions!.get(path)?.cfi === view.lastLocation!.cfi,
          "destination save did not settle");
        const viewport = view.renderer.shadowRoot!.querySelector<HTMLElement>("#container")!;
        const visible = visiblePassage();
        const cfi = view.lastLocation!.cfi;
        const targetDoc = contents().find(content => content.index === resolved.index)?.doc;
        const heading = targetDoc?.getElementById("opening");
        const range = targetDoc?.createRange();
        if (heading) range?.selectNodeContents(heading);
        const targetCfi = range ? view.getCFI(resolved.index, range) : null;
        destinations.push({ route, layout: paged ? "paged" : "continuous", href, fragment: route === "fragment" ? "opening" : null,
          resolvedIndex: resolved.index, primaryIndex: view.renderer.primaryIndex, visible,
          cfi, cfiIndex: view.resolveCFI(cfi).index, footer: label(),
          savedCfi: window.__readerStatusPositions!.get(path)?.cfi,
          targetPainted: targetCfi && cfiVisible(targetCfi),
          viewport: viewport.getBoundingClientRect().toJSON(), scrollTop: viewport.scrollTop,
          scrollLeft: viewport.scrollLeft, scrollHeight: viewport.scrollHeight,
          frames: contents().map(({ index, doc }) => ({ index, bounds: doc.defaultView!.frameElement!.getBoundingClientRect().toJSON() })) });
        if (visible?.index !== resolved.index || !targetCfi || !cfiVisible(targetCfi) ||
          view.resolveCFI(cfi).index !== visible?.index) failures.push(`${route}/${paged}/${number}`);
      }
    }
  }
  const viewport = view.renderer.shadowRoot!.querySelector<HTMLElement>("#container")!;
  const movement: object[] = [];
  scrolling.longSpine = movement;
  const sample = async (step: string) => {
    await until(() => {
      const cfi = view.lastLocation!.cfi;
      const visible = visiblePassage();
      const savedCfi = window.__readerStatusPositions!.get(path)?.cfi;
      scrolling.pending = { step, cfi, visible, savedCfi, painted: cfiVisible(cfi),
        primaryIndex: view.renderer.primaryIndex, scrollTop: viewport.scrollTop,
        scrollHeight: viewport.scrollHeight, viewport: viewport.getBoundingClientRect().toJSON() };
      return cfiVisible(cfi) && visible?.index === location()!.start.index && savedCfi === cfi;
    }, `${step}: painted/status/saved location disagreement`);
    await readyEpub(view.renderer.getAttribute("flow") !== "scrolled");
    movement.push({ step, visible: visiblePassage(), cfi: view.lastLocation!.cfi,
      footer: label(), savedCfi: window.__readerStatusPositions!.get(path)?.cfi,
      scrollTop: viewport.scrollTop, scrollHeight: viewport.scrollHeight,
      viewport: viewport.getBoundingClientRect().toJSON(),
      loaded: contents().map(({ index }) => index) });
  };
  await sample("before-large-jumps");
  for (const edge of ["start", "end", "start", "end"]) {
    const before = view.lastLocation!.cfi;
    viewport.scrollTo(0, edge === "start" ? 0 : viewport.scrollHeight);
    await until(() => view.lastLocation!.cfi !== before, `large ${edge} jump did not relocate`);
    await sample(`large-${edge}`);
  }
  await resize(1000, 700); await sample("continuous-resize");
  await command("Paged layout"); await readyEpub();
  await display("EPUB/chapter-48.xhtml#p20");
  focusReader(); await key("PageDown"); await readyEpub();
  const pagedAnchor = view.lastLocation!.cfi;
  await sample("passage-paged");
  await command("Continuous layout"); await readyEpub(false);
  await until(() => cfiVisible(pagedAnchor), "mode-only paged-to-continuous lost painted passage");
  await sample("passage-continuous");
  const beforeScroll = view.lastLocation!.cfi;
  viewport.scrollBy(0, viewport.clientHeight * .85);
  await until(() => view.lastLocation!.cfi !== beforeScroll, "layout sequence scroll did not relocate");
  const scrolledAnchor = view.lastLocation!.cfi;
  await sample("passage-scrolled");
  await command("Paged layout"); await readyEpub();
  await until(() => cfiVisible(scrolledAnchor), "mode-only continuous-to-paged lost painted passage");
  await sample("passage-paged-again");
  await command("Continuous layout"); await readyEpub(false);
  await until(() => cfiVisible(scrolledAnchor), "second continuous transition lost painted passage");
  await sample("passage-continuous-again");
  const saved = window.__readerStatusPositions!.get(path)!.cfi;
  await close();
  await direct("destinations.epub", "destinations.epub", path); await readyEpub();
  await until(() => cfiVisible(saved), "long-spine reopen lost saved painted passage");
  movement.push({ step: "reopen", visible: visiblePassage(), cfi: view.lastLocation!.cfi,
    footer: label(), savedCfi: window.__readerStatusPositions!.get(path)?.cfi });
  await command("Paged layout"); await readyEpub();
  await close();
  check(!failures.length, `destination integrity failures: ${failures.join(",")}`);
}
async function chapterReversalProbe() {
  const path = "/reversal.epub";
  await direct("reversal.epub", "reversal.epub", path); await readyEpub();
  await view.goTo(1); await readyEpub();
  check(book.sections[1].linear === "no", "nonlinear fixture no longer has notes");
  const notes = contents().find(content => content.index === 1)!.doc;
  const range = notes.createRange();
  range.selectNodeContents(notes.body); range.collapse(true);
  const notesStart = view.getCFI(1, range);
  range.selectNodeContents(notes.body); range.collapse(false);
  const notesEnd = view.getCFI(1, range);
  const beforeNotes = (await view.getCFIProgress(notesStart))!.fraction;
  const afterNotes = (await view.getCFIProgress(notesEnd))!.fraction;
  check(beforeNotes === afterNotes, "nonlinear notes advanced publication progress");
  check(detail().trim() === `${Math.round(beforeNotes * 100)}% ·`, "nonlinear footer did not report its linear boundary");
  for (const paged of [true, false]) {
    if (!paged) { await command("Continuous layout"); await readyEpub(false); }
    // Retain the original 420×676 reader repro alongside the design geometries.
    for (const [width, height] of [[420, 700], [420, 600], [1000, 700], [1440, 800]] as const) {
      await resize(width, height); await readyEpub(paged);
      await chapter("Chapter 1", paged);
      // Inspect paint and the physical scroll limit independently of the
      // resolved index. A short final section cannot fill a continuous screen.
      const sample = (index: number) => {
        const viewport = view.renderer.shadowRoot!.querySelector<HTMLElement>("#container")!;
        const doc = contents().find(content => content.index === index)?.doc;
        const frame = doc?.defaultView?.frameElement?.getBoundingClientRect();
        const heading = doc?.querySelector("h1")?.getBoundingClientRect();
        return {
          cfi: view.lastLocation!.cfi, cfiIndex: location()!.start.index,
          primaryIndex: view.renderer.primaryIndex, visible: visiblePassage(),
          footer: label(), detail: detail(), savedCfi: window.__readerStatusPositions!.get(path)?.cfi,
          page: view.renderer.page, pages: view.renderer.pages,
          viewport: viewport.getBoundingClientRect().toJSON(),
          scrollLeft: viewport.scrollLeft, scrollTop: viewport.scrollTop,
          maximumScrollTop: viewport.scrollHeight - viewport.clientHeight,
          targetFrame: frame?.toJSON(),
          headingTop: frame && heading ? frame.top + heading.top : null,
          frames: contents().map(({ index, doc }) => ({
            index, bounds: doc.defaultView!.frameElement!.getBoundingClientRect().toJSON(),
          })),
        };
      };
      const transition = async (name: string, nextPaged: boolean, addressed: string, restoring = false) => {
        const renderer = view.renderer;
        let revision = 0;
        let stabilized = false;
        const events: object[] = [];
        const observe = (event: Event) => {
          revision++;
          if (event.type === "stabilized") stabilized = true;
          events.push({ at: performance.now(), type: event.type,
            reason: (event as CustomEvent).detail?.reason, ...sample(2) });
        };
        renderer.addEventListener("relocate", observe);
        renderer.addEventListener("stabilized", observe);
        renderer.addEventListener("scroll", observe);
        const before = sample(2);
        let previous = "";
        let equalFrames = 0;
        try {
          await command(nextPaged ? "Paged layout" : "Continuous layout");
          const immediate = sample(2);
          await until(() => {
            const state = sample(2);
            const tuple = JSON.stringify({ revision, ...state });
            equalFrames = tuple === previous ? equalFrames + 1 : 0;
            previous = tuple;
            if (!stabilized || equalFrames < 4 ||
              renderer.getAttribute("flow") !== (nextPaged ? "paginated" : "scrolled") ||
              state.visible?.index !== state.cfiIndex || !cfiVisible(state.cfi) ||
              state.savedCfi !== (restoring ? addressed : state.cfi) ||
              state.footer !== expectedLabel(location()!)) return false;
            const { index, anchor } = view.resolveCFI(state.cfi);
            const doc = contents().find(content => content.index === index)!.doc;
            const painted = view.resolveCFI(state.visible.cfi).anchor(doc);
            // The reported range must include the independently painted first
            // character, not merely some later visible paragraph in the section.
            return anchor(doc).comparePoint(painted.startContainer, painted.startOffset) === 0;
          }, `${name}: mode paint/CFI/footer/save did not settle`);
          await readyEpub(nextPaged);
          const settled = sample(2);
          reversals.push({ name, paged, width, height, nextPaged, addressed,
            addressedPainted: cfiVisible(addressed), before, immediate, ...settled, events });
          check(cfiVisible(addressed), `${name}: chapter mode reversal lost addressed passage`);
        } catch (error) {
          reversals.push({ name: `${name}-failure`, paged, width, height, addressed,
            addressedPainted: cfiVisible(addressed), ...sample(2), events });
          throw error;
        } finally {
          renderer.removeEventListener("relocate", observe);
          renderer.removeEventListener("stabilized", observe);
          renderer.removeEventListener("scroll", observe);
        }
      };
      const roundTrip = async (name: string, addressed = view.lastLocation!.cfi) => {
        for (let cycle = 0; cycle < 2; cycle++) {
          await transition(`${name}-switch-${cycle}`, !paged, addressed);
          await transition(`${name}-return-${cycle}`, paged, addressed);
        }
        const reopening = window.__readerStatusPositions!.get(path)!.cfi;
        await close(); await direct("reversal.epub", "reversal.epub", path); await readyEpub();
        await until(() => cfiVisible(reopening), `${name}: chapter reopen lost saved passage`);
        if (!paged) {
          // Restoration/reflow alone must retain the saved record until an
          // intentional navigation enables writes for this new reader.
          await transition(`${name}-reopened-continuous`, false, reopening, true);
        }
      };
      const step = async (name: string, expected: number, direction: 1 | -1, boundary = false) => {
        const before = view.lastLocation!.cfi;
        const primaryBefore = view.renderer.primaryIndex;
        const original = view.goTo;
        let navigation: ReturnType<View["goTo"]> | undefined;
        let target: Parameters<View["goTo"]>[0] | undefined;
        let requested: ReturnType<View["resolveNavigation"]>;
        const relocations: object[] = [];
        const observe = (event: Event) => relocations.push({
          reason: (event as CustomEvent).detail.reason, ...sample(expected),
        });
        view.renderer.addEventListener("relocate", observe);
        view.goTo = value => {
          target = value; requested = view.resolveNavigation(value);
          return navigation = original.call(view, value);
        };
        let arrived: Awaited<ReturnType<View["goTo"]>>;
        let immediate: ReturnType<typeof sample>;
        try {
          focusReader();
          await key(direction === 1 ? "n" : "N", { code: "KeyN", shiftKey: direction === -1 });
          arrived = await navigation;
          immediate = sample(expected);
        } finally { view.goTo = original; }
        // Include the debounced container-scroll relocation and asynchronous
        // fill, rather than treating goTo's returned index as visual arrival.
        await new Promise<void>(resolve => setTimeout(resolve, 400));
        await readyEpub(paged);
        if (navigation) await until(() => window.__readerStatusPositions!.get(path)?.cfi === view.lastLocation!.cfi,
          `${name}: chapter position did not save`);
        view.renderer.removeEventListener("relocate", observe);
        const settled = sample(expected);
        const { cfi, visible } = settled;
        reversals.push({ name, paged, width, before, primaryBefore, target: target ?? null,
          requestedIndex: requested?.index, requestedAnchor: requested?.anchor ? "anchor" : 0,
          completed: !!navigation, arrival: arrived?.index ?? null, immediate, ...settled, relocations });
        if (boundary) check(!navigation && cfi === before, `${name}: chapter boundary navigated`);
        else check(target === expected && arrived?.index === expected, `${name}: wrong chapter target ${target}, expected ${expected}`);
        const clamped = !paged && expected === 3;
        if (clamped) {
          check(settled.targetFrame && settled.targetFrame.height < settled.viewport.height &&
            Math.abs(settled.scrollTop - settled.maximumScrollTop) <= 1 &&
            settled.targetFrame.top > settled.viewport.top + 1,
          `${name}: short final destination is not explained by the physical scroll limit`);
          check(settled.headingTop !== null && settled.headingTop > settled.viewport.top &&
            settled.headingTop < settled.viewport.bottom, `${name}: clamped destination opening is not painted`);
        } else if (!boundary) {
          check(visible?.paragraph === `Chapter ${expected === 0 ? 1 : expected === 2 ? 2 : 3} opening`,
            `${name}: preceding passage paints above the reachable chapter opening`);
          // Scroll offsets quantize while accumulated section bounds retain
          // fractional CSS pixels (including WebKit's device-scale rounding).
          if (!paged) check(settled.targetFrame && Math.abs(settled.targetFrame.top - settled.viewport.top) <= 2,
            `${name}: reachable continuous section did not align at reading start`);
        }
        check(visible?.index === (clamped ? 2 : expected) &&
          view.resolveCFI(cfi).index === visible?.index && cfiVisible(cfi),
          `${name}: painted passage and current CFI disagree`);
        check(label() === expectedLabel(location()!), `${name}: footer misidentifies first-visible text`);
        if (!boundary) check(window.__readerStatusPositions!.get(path)?.cfi === cfi, `${name}: stale chapter save`);
      };
      await step("first-boundary", 0, -1, true);
      for (let repeat = 0; repeat < 2; repeat++) {
        await step(`next-${repeat}`, 2, 1);
        await step(`previous-${repeat}`, 0, -1);
      }
      await step("skip-nonlinear-forward", 2, 1);
      await step("last-chapter", 3, 1);
      await roundTrip("short-final-chapter");
      if (paged) {
        await step("last-boundary", 3, 1, true);
        await step("previous-adjacent", 2, -1);
        await step("skip-nonlinear-backward", 0, -1);
      } else {
        // The clamp truthfully leaves Chapter 2 first-visible: repeated next
        // still requests Chapter 3; previous follows that same visible CFI.
        await step("repeat-clamped-destination", 3, 1);
        await step("previous-from-clamped-location", 0, -1);
      }
      // Issue a reverse without the usual 400ms settlement after the forward
      // command; also overlap explicit navigation with a screen/page turn.
      focusReader(); await key("n", { code: "KeyN" });
      await until(() => location()?.start.index === 2, "rapid forward did not reach Chapter 2");
      await step("rapid-reverse", 0, -1);
      focusReader();
      const turning = key("PageDown");
      await step("chapter-during-page-turn", 2, 1);
      await turning;
      await roundTrip("chapter-opening");
      const middle = "EPUB/reversal-2.xhtml#p20";
      await view.goTo(middle); await readyEpub(paged);
      await until(() => window.__readerStatusPositions!.get(path)?.cfi === view.lastLocation!.cfi,
        "middle-passage navigation did not save");
      const doc = contents().find(content => content.index === 2)!.doc;
      const target = doc.createRange();
      target.selectNodeContents(doc.getElementById("p20")!);
      target.collapse(true);
      // Navigation addressed p20, not the earlier p19 suffix that shares its
      // paginated page. Reflow may change that page-start CFI legitimately.
      await roundTrip("long-middle-passage", view.getCFI(2, target));
    }
  }
  await command("Paged layout"); await readyEpub(); await close();
}
async function keyboardMotionProbe() {
  const viewport = view.renderer.shadowRoot!.querySelector<HTMLElement>("#container")!;
  const matchMedia = window.matchMedia;
  let reduced = false;
  window.matchMedia = query => query === "(prefers-reduced-motion: reduce)"
    ? { matches: reduced } as MediaQueryList : matchMedia.call(window, query);
  const moves: object[] = [];
  try {
    for (const [value, distance, reduce] of [
      ["ArrowDown", 40, false], ["PageDown", viewport.clientHeight, false],
      ["ArrowDown", 40, true], ["PageDown", viewport.clientHeight, true],
    ] as const) {
      reduced = reduce;
      focusReader();
      const focused = document.activeElement;
      const before = viewport.scrollTop;
      const anchor = viewport.firstElementChild!;
      const top = anchor.getBoundingClientRect().top;
      const positions: number[] = [];
      const renderer = view.renderer;
      // Also prove that reduced motion temporarily suppresses an existing opt-in.
      if (reduce) renderer.setAttribute("animated", "saved");
      const previousAttribute = renderer.getAttribute("animated");
      const next = view.next;
      let calls = 0, animated = false, finished = false;
      let completion: Promise<void> | undefined;
      view.next = amount => {
        calls++;
        animated = renderer.hasAttribute("animated");
        completion = next.call(view, amount).finally(() => { finished = true; });
        return completion;
      };
      const target = focused!;
      try {
        target.dispatchEvent(new KeyboardEvent("keydown",
          { key: value, code: value, bubbles: true, cancelable: true }));
        for (let frame = 0; frame < 5; frame++) {
          await settle();
          positions.push(top - anchor.getBoundingClientRect().top);
          if (!reduce && !finished) target.dispatchEvent(new KeyboardEvent("keydown",
            { key: value, code: value, bubbles: true, cancelable: true, repeat: true }));
        }
        target.dispatchEvent(new KeyboardEvent("keyup", { key: value, code: value, bubbles: true }));
        await completion;
        await settle();
        const delta = viewport.scrollTop - before;
        check(calls === 1, `keyboard repeat queued extra movements: ${calls}`);
        check(Math.abs(delta - distance) <= 2, `${value} travelled ${delta}, expected ${distance}`);
        check(animated === !reduce, "keyboard motion ignored reduced-motion preference");
        if (!reduce) check(positions.some(position => position > 1 && position < delta - 1),
          `smooth movement had no painted intermediate frame: ${positions}`);
        else check(positions.every(position => Math.abs(position - delta) <= 2), "reduced motion still animated");
        check(renderer.getAttribute("animated") === previousAttribute, "keyboard motion leaked its animation opt-in");
        check(document.activeElement === focused, "keyboard movement stole focus");
        const quiet = Promise.withResolvers<void>();
        setTimeout(quiet.resolve, 400);
        await quiet.promise;
        check(Math.abs(viewport.scrollTop - before - distance) <= 2, "released keyboard movement kept travelling");
        moves.push({ value, reduced: reduce, delta, positions, calls });
      } finally {
        view.next = next;
        renderer.removeAttribute("animated");
      }
    }
    const saved = location()!.start.cfi;
    await until(() => window.__readerStatusPositions!.get("/status-scroll-fixture.epub")?.cfi === saved,
      "smooth keyboard destination was not persisted");
    await close();
    await direct("status.epub", "status.epub", "/status-scroll-fixture.epub"); await readyEpub();
    await until(() => cfiVisible(saved), "reopen lost the smooth keyboard destination");
    await command("Continuous layout"); await readyEpub(false);
    check(document.activeElement?.getAttribute("aria-label") === "EPUB reading area", "layout restore lost reader focus");
    scrolling.keyboard = moves;
  } finally {
    window.matchMedia = matchMedia;
  }
}

async function run() {
  await until(() => app && document.querySelector(".document-viewport"), "real App did not mount");
  check(document.title === "Clio", "closed App title is not Clio");
  await destinationProbe();
  await chapterReversalProbe();
  await resize(1000, 700); await open("status.epub"); await readyEpub();
  check(document.title === "status.epub — Clio", "EPUB filename was not committed");
  const first = location()!.start.cfi;
  focusReader(); await key("PageDown");
  await until(() => location()!.start.cfi !== first, "host PageDown did not move the real rendition"); await readyEpub();
  const forward = location()!.start.cfi;
  await key("PageUp"); await until(() => location()!.start.cfi !== forward, "host PageUp did not reverse the real rendition"); await readyEpub();
  coverage.push("paged-and-page-turns");

  const tocChildren = book.toc!.find(item => item.label === "Chapter One")!.subitems!;
  check(tocChildren.slice(0, 4).map(item => item.label).join("|") ===
    "Opening passage|Deep passage|Unicode passage|Invalid fragment", "TOC sibling labels or ordering changed");
  check(tocChildren[0]!.href.endsWith("#opening"), "valid opening destination changed");
  check(tocChildren[1]!.subitems![0]!.label === "Nested deep passage" &&
    tocChildren[1]!.subitems![0]!.href.endsWith("#deep"), "nested destination changed");
  check(tocChildren[2]!.href.endsWith("#Δ"), "valid Unicode decoding changed");
  check(tocChildren[3]!.href === null, "malformed destination did not become inert");
  for (const query of ["Opening passage", "Nested deep passage", "Unicode passage"]) {
    await chapter(query);
    // The actual first-visible CFI, not the requested target, determines status.
    assertStatus(true);
  }
  const beforeInvalid = location()!.start.cfi;
  const goTo = view.goTo;
  let invalidNavigations = 0;
  view.goTo = target => { invalidNavigations++; return goTo.call(view, target); };
  try {
    await command("Go to chapter");
    await inputValue(document.querySelector<HTMLInputElement>(".command-filter")!, "Invalid fragment");
    const rows = document.querySelectorAll<HTMLElement>('.command-list [role="option"]');
    check(rows.length === 1, "malformed TOC label was discarded");
    rows[0]!.click();
    await until(() => !document.querySelector(".command-palette"), "invalid TOC activation did not close the palette");
    check(invalidNavigations === 0 && location()!.start.cfi === beforeInvalid,
      "malformed TOC destination caused navigation");
    await readyEpub();
  } finally {
    view.goTo = goTo;
  }
  await display("EPUB/section-0.xhtml#deep");
  const deepTarget = view.resolveCFI(location()!.start.cfi);
  check(deepTarget.index === 0, "fragment chapter navigation selected a different section");
  await display("EPUB/section-0.xhtml#%CE%94");
  check(view.resolveCFI(location()!.start.cfi).index === 0, "encoded fragment escaped its section");
  for (const index of [1, 4, 5]) {
    await display(`EPUB/section-${index}.xhtml`);
    check(location()!.start.index === index, "chapter navigation did not reach its actual section");
  }
  // Navigate through production commands from a directly selected nonlinear section.
  check(book.sections[5].linear === "no", "fixture lost its nonlinear section");
  // Start within the nonlinear section, not a spread shared with its predecessor.
  await display("EPUB/section-5.xhtml#deep");
  const previousGoTo = view.goTo;
  let previousNavigation: Promise<{ index: number } | undefined> | undefined;
  view.goTo = target => previousNavigation = previousGoTo.call(view, target);
  try {
    await command("Previous chapter");
    check(previousNavigation, "reverse chapter command did not navigate");
    check((await previousNavigation)!.index === 4, "reverse chapter command targeted the wrong section");
  } finally { view.goTo = previousGoTo; }
  await until(() => {
    const doc = contents().find(content => content.index === 4)?.doc;
    const heading = doc?.querySelector("h1");
    if (!doc || !heading) return false;
    const range = doc.createRange();
    range.selectNodeContents(heading); range.collapse(true);
    return cfiVisible(view.getCFI(4, range));
  }, "reverse chapter navigation did not paint the linear section");
  await readyEpub();
  // At a shared spread the requested section need not be first-visible. Move
  // inside the final linear section before proving forward nonlinear skipping.
  await display("EPUB/section-4.xhtml#deep");
  await command("Next chapter"); await readyEpub();
  check(location()!.start.index === 4, "forward chapter navigation entered a trailing nonlinear section");
  coverage.push("nested-fragments-aliases-and-parent-gap");

  await direct("status.epub", "status.epub", "/status-scroll-fixture.epub"); await readyEpub();
  await display("EPUB/section-0.xhtml"); await command("Continuous layout"); await readyEpub(false);
  await keyboardMotionProbe();
  await display("EPUB/section-0.xhtml", false);
  const renderer = view.renderer;
  const container = renderer.shadowRoot?.querySelector<HTMLElement>("#container");
  check(container, "Foliate's open shadow root has no native scroll container");
  const viewport = container!;
  const doc = contents().find(content => content.index === 0)!.doc;
  const writingMode = getComputedStyle(doc.documentElement).writingMode;
  const direction = getComputedStyle(doc.documentElement).direction;
  const style = getComputedStyle(viewport);
  Object.assign(scrolling, { writingMode, direction, flow: renderer.getAttribute("flow"),
    overflowX: style.overflowX, overflowY: style.overflowY, initialScrollTop: viewport.scrollTop,
    initialScrollHeight: viewport.scrollHeight, clientHeight: viewport.clientHeight });
  check(writingMode === "horizontal-tb" && direction === "ltr" &&
    renderer.getAttribute("flow") === "scrolled" && style.overflowY === "auto",
    "fixture is not horizontal-writing continuous scroll");
  check(viewport.scrollHeight > viewport.clientHeight, "native viewport has no scrollable content");
  check(style.getPropertyValue("scrollbar-width") === "thin", "Foliate's actual scroll owner did not receive thin scrollbar styling");
  const firstVisibleIndex = () => view.resolveCFI(view.lastLocation!.cfi).index;
  const reportedSection = () => (view.lastLocation as { section?: { current: number } } | null)?.section?.current ?? null;
  let scrollEvents = 0;
  let relocations = 0;
  let rendererRelocationIndex: number | null = null;
  let rendererRelocationReason: string | null = null;
  let backwardAnchor: string | undefined;
  const samples: object[] = [];
  scrolling.samples = samples;
  const sample = (reason: string) => samples.push({ reason, scrollTop: viewport.scrollTop,
    scrollHeight: viewport.scrollHeight, clientHeight: viewport.clientHeight,
    primaryIndex: renderer.primaryIndex, reportedSection: reportedSection(), cfiSection: firstVisibleIndex(),
    rendererRelocationIndex, rendererRelocationReason,
    visible: visiblePassage(), loadedSections: contents().map(content => content.index),
    scrollEvents, relocations, status: label(), detail: detail() });
  const onScroll = () => { scrollEvents += 1; sample("scroll"); };
  const onRelocate = () => { relocations += 1; sample("relocate"); };
  const onRendererRelocate = (event: Event) => {
    const { index, reason } = (event as CustomEvent<{ index: number; reason: string }>).detail;
    rendererRelocationIndex = index;
    rendererRelocationReason = reason;
    sample("renderer-relocate");
  };
  const onStabilized = () => { sample("stabilized"); };
  viewport.addEventListener("scroll", onScroll);
  view.addEventListener("relocate", onRelocate);
  renderer.addEventListener("relocate", onRendererRelocate);
  renderer.addEventListener("stabilized", onStabilized);
  const reachLaterSection = async () => {
    const beforeRelocations = relocations;
    let moves = 0;
    for (let step = 0; step < 100 && visiblePassage()?.index === 0; step += 1) {
      await until(() => viewport.scrollHeight - viewport.clientHeight > viewport.scrollTop + 1,
        "adjacent section preload did not extend the native scroll viewport");
      const before = viewport.scrollTop;
      const eventsBefore = scrollEvents;
      viewport.scrollBy(0, innerHeight * .85);
      moves++;
      await until(() => viewport.scrollTop > before && scrollEvents > eventsBefore,
        `native continuous scroll did not advance from ${before}`);
    }
    await until(() => viewport.scrollTop > viewport.clientHeight && scrollEvents > 0 && relocations > 0 &&
      location()!.start.index > 0 && firstVisibleIndex() === visiblePassage()?.index &&
      reportedSection() === firstVisibleIndex() && rendererRelocationIndex === firstVisibleIndex() &&
      (moves === 0 || (relocations > beforeRelocations && rendererRelocationReason === "scroll")),
      "real continuous scroll did not cross a spine boundary");
  };
  try {
    sample("before");
    await reachLaterSection();
    await readyEpub(false);
    assertStatus(false);
    sample("boundary-status");
    check(label() === "Chapter One · Section 2", "reused fragment IDs supplied a different section's label");
    const forwardAnchor = location()!.start.cfi;
    check(cfiVisible(forwardAnchor), "continuous relocation did not address painted reading text");
    await until(() => window.__readerStatusPositions!.get("/status-scroll-fixture.epub")?.cfi === forwardAnchor,
      "forward continuous first-visible CFI was not persisted");
    check(view.resolveCFI(window.__readerStatusPositions!.get("/status-scroll-fixture.epub")!.cfi).index === visiblePassage()?.index,
      "forward persisted CFI differs from the first painted section");
    await command("Paged layout"); await readyEpub();
    await until(() => cfiVisible(forwardAnchor), "continuous-to-paged switching lost the visible passage");
    sample("forward-paged");
    await command("Continuous layout"); await readyEpub(false);
    await until(() => cfiVisible(forwardAnchor), "paged-to-continuous switching lost the visible passage");
    sample("forward-continuous");
    await reachLaterSection();
    await readyEpub(false);
    sample("backward-start");
    const backwardStart = viewport.scrollTop;
    const previousDoc = contents().find(content => content.index === 0)?.doc;
    check(previousDoc, "backward boundary precondition lost the adjacent previous section");
    const previousFrame = previousDoc!.defaultView!.frameElement!;
    const walker = previousDoc!.createTreeWalker(previousDoc!.body, NodeFilter.SHOW_TEXT);
    let lastText: Node | null = null;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.textContent?.trim()) lastText = node;
    }
    check(lastText, "previous section has no painted-text boundary");
    const lastMatch = [...lastText!.textContent!.matchAll(/\S/gu)].at(-1)!;
    const boundaryRange = previousDoc!.createRange();
    boundaryRange.setStart(lastText!, lastMatch.index);
    boundaryRange.setEnd(lastText!, lastMatch.index + lastMatch[0].length);
    const boundaryRect = Array.from(boundaryRange.getClientRects()).find(rect => rect.width > 0 && rect.height > 0);
    check(boundaryRect, "previous section's last character has no painted geometry");
    const viewportBounds = viewport.getBoundingClientRect();
    // Put actual section-0 text in the top eighth, leaving section 1 at
    // viewport centre. A centre-preferred relocation must fail this oracle.
    const target = viewport.scrollTop + previousFrame.getBoundingClientRect().top +
      boundaryRect!.top - viewportBounds.top - viewportBounds.height / 8;
    check(target < backwardStart, "boundary-relative target does not require backward native scrolling");
    const eventsBefore = scrollEvents;
    const beforeBackwardRelocations = relocations;
    viewport.scrollTo(0, target);
    const backwardMoves = 1;
    await until(() => viewport.scrollTop < backwardStart && scrollEvents > eventsBefore &&
      visiblePassage(0, .25)?.index === 0 && visiblePassage(.45, .55)?.index === 1,
      "backward input did not establish section 0 at viewport start and section 1 at centre");
    await until(() => relocations > beforeBackwardRelocations && firstVisibleIndex() === 0 &&
      reportedSection() === 0 && visiblePassage()?.index === 0 && rendererRelocationIndex === 0 &&
      rendererRelocationReason === "scroll", "backward continuous scroll did not restore the previous section");
    await readyEpub(false);
    assertStatus(false);
    check(label() === "Unicode passage", "boundary status did not independently identify section 0's final passage");
    check(backwardMoves > 0 && viewport.scrollTop < backwardStart, "backward case did not exercise negative native scrolling");
    scrolling.backward = { before: backwardStart, after: viewport.scrollTop,
      delta: viewport.scrollTop - backwardStart, moves: backwardMoves, cfiSection: firstVisibleIndex(),
      relocationIndex: rendererRelocationIndex, status: label() };
    Object.assign(scrolling.backward as object, { target, topQuarter: visiblePassage(0, .25),
      centre: visiblePassage(.45, .55), auditedReference: { before: 4997, after: 4402, delta: -595 } });
    sample("backward-status");
    // Cross the same real spine boundary with the keyboard, not raw scrollBy.
    focusReader();
    await key("PageDown");
    await until(() => firstVisibleIndex() === 1 && visiblePassage()?.index === 1,
      "smooth keyboard movement did not settle across the section boundary");
    await readyEpub(false);
    await key("PageUp");
    await until(() => firstVisibleIndex() === 0 && visiblePassage()?.index === 0,
      "smooth keyboard reverse did not restore the previous section");
    await readyEpub(false);
    backwardAnchor = location()!.start.cfi;
    await until(() => window.__readerStatusPositions!.get("/status-scroll-fixture.epub")?.cfi === backwardAnchor,
      "backward continuous first-visible CFI was not persisted");
    check(view.resolveCFI(window.__readerStatusPositions!.get("/status-scroll-fixture.epub")!.cfi).index === visiblePassage()?.index,
      "backward persisted CFI differs from the first painted section");
  } finally {
    sample("final");
    viewport.removeEventListener("scroll", onScroll);
    view.removeEventListener("relocate", onRelocate);
    renderer.removeEventListener("relocate", onRendererRelocate);
    renderer.removeEventListener("stabilized", onStabilized);
  }
  await command("Paged layout"); await readyEpub();
  await until(() => cfiVisible(backwardAnchor!), "backward continuous-to-paged switching lost the visible passage");
  sample("backward-paged");
  coverage.push("continuous-scroll-and-layout-switch");

  await display("EPUB/section-2.xhtml");
  const cases: object[] = [];
  for (const dark of [false, true]) {
    app.appearance(dark); await settle();
    for (const [width, height] of [[420, 600], [1000, 700], [1440, 800]]) {
      const focusBeforeResize = document.activeElement;
      await resize(width!, height!); await readyEpub();
      check(document.activeElement === focusBeforeResize, "status/resize updates stole keyboard focus");
      assertStatus(true); const measured = geometry();
      const before = document.querySelector<HTMLElement>(".foliate-reader")!.getBoundingClientRect().height;
      bar()!.querySelector<HTMLButtonElement>(".status-commands")!.click();
      await until(() => document.querySelector(".command-filter"), "commands entry did not open the real palette");
      check(!bar()!.querySelector(".status-commands"), "commands entry remains focusable behind the palette");
      check(bar()?.getBoundingClientRect().height === 24, "palette did not reserve the external status bar");
      check(document.activeElement === document.querySelector(".command-filter"), "palette did not retain filter focus");
      await key("Tab"); await key("Tab", { shiftKey: true });
      check(document.activeElement === document.querySelector(".command-filter"), "palette focus model regressed");
      check(document.querySelector<HTMLElement>(".foliate-reader")!.getBoundingClientRect().height === before, "palette returned footer space to publication layout");
      await key("Escape"); await readyEpub();
      check(document.activeElement?.getAttribute("aria-label") === "EPUB reading area", "palette Escape did not restore host reader focus");
      cases.push({ width: innerWidth, height: innerHeight, dark, ...measured });
    }
  }
  coverage.push("six-geometries-and-appearances");

  const previousViewportWidth = view.renderer.shadowRoot!.querySelector<HTMLElement>("#container")!.clientWidth;
  await resize(420, 600);
  await until(() => view.renderer.shadowRoot!.querySelector<HTMLElement>("#container")!.clientWidth !== previousViewportWidth,
    "resize did not recompute the native reader viewport");
  await readyEpub();
  await command("Continuous layout"); await readyEpub(false);
  await command("Paged layout"); await readyEpub();
  coverage.push("resize-freshness");

  await display("EPUB/section-2.xhtml");
  await open("no-toc.epub");
  await until(() => document.title === "no-toc.epub — Clio" && /^Section \d+$/.test(label()) && /%/.test(detail()), "empty TOC did not render Section fallback");
  for (const target of ["EPUB/section-0.xhtml", "EPUB/section-2.xhtml", "EPUB/section-4.xhtml"]) {
    await display(target); await until(() => label() === `Section ${location()!.start.index + 1}` && /%/.test(detail()), "empty TOC navigation did not update section"); assertStatus(true, true);
  }
  coverage.push("empty-toc-and-section-fallback");

  await direct("status.epub", "restored.epub", "/status-fixture.epub"); await readyEpub();
  await display("EPUB/section-0.xhtml#deep"); focusReader(); await key("PageDown"); await readyEpub();
  const savedVisible = location()!.start.cfi;
  await close();
  await until(() => window.__readerStatusPositions!.get("/status-fixture.epub")?.cfi, "canonical session did not flush its real CFI");
  const saved = window.__readerStatusPositions!.get("/status-fixture.epub")!.cfi;
  check(saved === savedVisible, "position session saved an unrelated location");
  await direct("status.epub", "restored.epub", "/status-fixture.epub"); await readyEpub();
  const restored = location()!;
  const resolved = view.resolveCFI(saved);
  check(resolved.index === restored.start.index, "reopen restored a different section");
  await until(() => cfiVisible(saved), "saved passage is outside the restored visible spread");
  assertStatus(true); coverage.push("cfi-close-reopen");

  await invalid("invalid.epub", "restored.epub — Clio", "epub");
  if (!epubOnly) {
  await invalid("invalid.pdf", "restored.epub — Clio", "epub");
  await open("status.pdf"); await readyPdf();
  await invalid("invalid.pdf", "status.pdf — Clio", "pdf");
  await invalid("invalid.epub", "status.pdf — Clio", "pdf");
  coverage.push("failed-replacements-both-formats");
  focusReader(); await key("J", { shiftKey: true, code: "KeyJ" });
  await until(() => document.querySelector(".status-page")?.textContent?.includes("Page 2 / 3"), "PDF physical-page navigation regressed");
  await command("theme_sepia");
  check(document.activeElement === document.querySelector(".command-filter"), "PDF theme selection lost filter focus");
  await key("Escape");
  check(document.activeElement?.getAttribute("aria-label") === "PDF reading area", "PDF theme chooser Escape did not restore reader focus");
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
  } else {
    await close();
    coverage.push("failed-epub-replacement");
  }

  for (const terminate of ["replace", "close"] as const) {
    await open("status.epub"); await readyEpub();
    const gate = await hold("epub");
    try {
      if (terminate === "replace") {
        if (epubOnly) { await open("status.epub", "replacement.epub"); await readyEpub(); }
        else { await open("status.pdf"); await readyPdf(); }
      }
      else await close();
    } finally { gate.release(); }
    await until(() => gate.destroys === 1, "obsolete prepared EPUB was not destroyed exactly once");
    check(document.title === (terminate === "replace" ? (epubOnly ? "replacement.epub — Clio" : "status.pdf — Clio") : "Clio"), "stale EPUB completion resurrected title");
  }
  coverage.push("epub-supersession-and-close");

  const slow = new File([await bytes("status.epub")], "slow-A.epub");
  const fast = new File([await bytes(epubOnly ? "no-toc.epub" : "status.pdf")], epubOnly ? "fast-B.epub" : "fast-B.pdf");
  const original = slow.arrayBuffer.bind(slow);
  const readGate = Promise.withResolvers<void>();
  const readFinished = Promise.withResolvers<void>();
  let entered = false;
  let preparationsAfterB: number | undefined;
  Object.defineProperty(slow, "arrayBuffer", { configurable: true, value: async () => {
    entered = true;
    await readGate.promise;
    try { return await original(); }
    finally { readFinished.resolve(); }
  } });
  try {
    await select(slow); await until(() => entered, "real file-input path did not call delayed File.arrayBuffer");
    if (epubOnly) { requestedName = "fast-B.epub"; minimumSerial = serial + 1; }
    await select(fast);
    if (epubOnly) await readyEpub();
    else await readyPdf("fast-B.pdf");
    preparationsAfterB = epubPreparations;
  } finally { readGate.resolve(); }
  // Let the old genuine File read and engine queue drain before asserting B.
  await readFinished.promise; await settle(); await settle();
  check(preparationsAfterB !== undefined && epubPreparations === preparationsAfterB,
    "stale browser acquisition reached the EPUB engine after B committed");
  check(epubOnly
    ? document.title === "fast-B.epub — Clio" && bar()
    : document.title === "fast-B.pdf — Clio" && document.querySelector(".pdfViewer .textLayer") && !bar(),
    "late File.arrayBuffer completion stole document identity");
  coverage.push("browser-array-buffer-ordering");

  const unusual = "Résumé & <Notes> “一”.epub";
  await open("status.epub", unusual); await readyEpub();
  check(document.title === `${unusual} — Clio`, "literal Unicode/markup-looking filename was escaped, normalized or replaced by metadata");
  check(!document.querySelector("Notes"), "filename was interpreted as HTML");
  await close(); coverage.push("literal-filename");
  check(nextGate === null && gates.every((gate) => gate.destroys === 1), "candidate preparation ownership leaked or double-destroyed");
  check(openingSnapshots.every((snapshot) => (!snapshot.label || snapshot.label === "EPUB") && !snapshot.detail), "new Book flashed the previous Book's label or pagination before its effect");
  bridge({ passed: true, cases, coverage, scrolling, destinations, reversals, renditionInstances: serial, candidates: gates.map(({ kind, destroys }) => ({ kind, destroys })) });
}
window.addEventListener("error", (event) => bridge({ passed: false, error: event.message }));
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
void run().catch((error: unknown) => bridge({ passed: false, error: String(error), stack: error instanceof Error ? error.stack : undefined, coverage, scrolling, destinations, reversals, location: location(), label: label(), detail: detail() }))
  .finally(() => { nextGate = null; for (const gate of gates) gate.release(); });
