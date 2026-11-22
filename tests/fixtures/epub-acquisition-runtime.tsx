import { createRoot } from "react-dom/client";
import { StrictMode } from "react";
import { View } from "foliate-js/view.js";
import type { ReaderFileSource } from "../../src/platform/tauriReaderFiles";
import type { EpubReadingPosition } from "../../src/platform/readingPosition";

declare global {
  interface Window {
    __acquisitionOpen: (source: ReaderFileSource) => Promise<void>;
    __acquisitionLoad: (path: string) => Promise<EpubReadingPosition | null>;
    __acquisitionPositions: Map<string, EpubReadingPosition>;
    __acquisitionPreload?: (renderer: View["renderer"], index: number) => Promise<void>;
  }
}
import App from "../../src/App";
import "../../src/index.css";

type Outcome = { status: "fulfilled"; value: unknown } | { status: "rejected"; reason: unknown };
type Gate = { promise: Promise<void>; resolve(): void };
const check: (value: unknown, message: string) => asserts value = (value, message) => {
  if (!value) throw new Error(message);
};
const observe = (promise: PromiseLike<unknown>): Promise<Outcome> => Promise.resolve(promise).then(
  value => ({ status: "fulfilled", value }), reason => ({ status: "rejected", reason }),
);
let failureObservation: unknown;
function paintedPassage(view: View, cfi: string) {
  const { index, anchor } = view.resolveCFI(cfi);
  const doc = view.renderer.getContents().find(content => content.index === index)?.doc;
  if (!doc) return false;
  const range = anchor(doc).cloneRange();
  if (range.startContainer.nodeType === Node.ELEMENT_NODE) {
    const node = range.startContainer.childNodes[range.startOffset] ?? range.startContainer;
    const text = node.nodeType === Node.TEXT_NODE ? node : doc.createTreeWalker(node, NodeFilter.SHOW_TEXT).nextNode();
    if (!text) return false;
    range.setStart(text, 0);
  }
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return false;
  const text = node.textContent ?? "";
  const next = text.slice(range.startOffset).search(/\S/u);
  if (next < 0) return false;
  const start = range.startOffset + next;
  range.setStart(node, start);
  range.setEnd(node, start + String.fromCodePoint(text.codePointAt(start)!).length);
  const frameRect = doc.defaultView?.frameElement?.getBoundingClientRect();
  if (!frameRect) return false;
  const viewport = view.getBoundingClientRect();
  return [...range.getClientRects()].some(rect => rect.width > 0 && rect.height > 0 &&
    frameRect.left + rect.left < viewport.right && frameRect.left + rect.right > viewport.left &&
    frameRect.top + rect.top < viewport.bottom && frameRect.top + rect.bottom > viewport.top);
}
function readingObservation() {
  const saved = [...(window.__acquisitionPositions ?? new Map<string, EpubReadingPosition>())];
  return {
    saved, document: document.body.innerText.slice(0, 1200),
    views: [...document.querySelectorAll<View>("foliate-view")].slice(0, 4).map(view => ({
      busy: view.parentElement?.getAttribute("aria-busy"), primary: view.renderer?.primaryIndex,
      viewport: view.getBoundingClientRect().toJSON(), cfi: view.lastLocation?.cfi,
      cfiSection: view.lastLocation?.cfi ? view.resolveCFI(view.lastLocation.cfi).index : null,
      addressedPaint: view.lastLocation?.cfi ? paintedPassage(view, view.lastLocation.cfi) : false,
      savedPaint: saved.map(([path, position]) => ({ path, cfi: position.cfi,
        section: view.resolveCFI(position.cfi).index, painted: paintedPassage(view, position.cfi) })),
      contents: view.renderer?.getContents().slice(0, 4).map(({ index, doc }) => ({
        index, title: doc.title, text: doc.body.textContent?.slice(0, 180),
        frame: doc.defaultView?.frameElement?.getBoundingClientRect().toJSON(),
      })),
    })),
  };
}
async function bounded<T>(promise: PromiseLike<T>, label: string): Promise<T> {
  const deadline = Promise.withResolvers<never>();
  const timer = setTimeout(() => {
    failureObservation = readingObservation();
    deadline.reject(new Error(`Unsettled ${label}`));
  }, 5_000);
  try {
    return await Promise.race([promise, deadline.promise]);
  } finally { clearTimeout(timer); }
}
const frame = () => {
  const { promise, resolve } = Promise.withResolvers<void>();
  requestAnimationFrame(() => resolve());
  return promise;
};
async function until(predicate: () => unknown, label: string) {
  await bounded((async () => { while (!predicate()) await frame(); })(), label);
}
// Cross an event-loop checkpoint so detached rejections cannot hide behind the
// final bridge message. This is not a cancellation/destruction grace period.
async function checkpoint() {
  const channel = new MessageChannel();
  const { promise, resolve } = Promise.withResolvers<void>();
  channel.port1.onmessage = () => { channel.port1.close(); channel.port2.close(); resolve(); };
  channel.port2.postMessage(null);
  await promise;
  await frame();
}
const cases: string[] = [];
const errors: string[] = [];
window.addEventListener("error", event => errors.push(event.message));
window.addEventListener("unhandledrejection", event => { errors.push(String(event.reason)); event.preventDefault(); });

const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;
const created: string[] = [];
const revoked: string[] = [];
const foliateUrls = new Map<string, { type: string; phase?: string; stack?: string }>();
URL.createObjectURL = blob => {
  const url = originalCreate.call(URL, blob);
  created.push(url);
  foliateUrls.set(url, { type: (blob as Blob).type, phase: cases.at(-1), stack: new Error().stack });
  return url;
};
URL.revokeObjectURL = url => { revoked.push(url); originalRevoke.call(URL, url); };
function assertUrlsRetired(start: number) {
  for (const url of created.slice(start)) {
    check(revoked.filter(value => value === url).length === 1, `Blob URL was not revoked exactly once: ${url}`);
  }
}
function select(bytes: Uint8Array, name: string) {
  const transfer = new DataTransfer();
  const file = new File([Uint8Array.from(bytes).buffer], name);
  transfer.items.add(file);
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  check(input, "App file input is missing");
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}
// Gates delay actual Foliate results; no renderer, search result or CFI is faked.
async function foliateLifecycle(a: Uint8Array, b: Uint8Array, invalid: Uint8Array) {
  const sessions: { view: View; closed: number; destroyed: number; rendererDestroyed: number; docs: Document[] }[] = [];
  type Hold = { entered: Gate; release: Gate; error?: Error };
  const gate = (error?: Error): Hold => ({ entered: Promise.withResolvers<void>(), release: Promise.withResolvers<void>(), error });
  let pendingInit: Hold | undefined;
  let pendingLoad: Hold | undefined;
  const positions = window.__acquisitionPositions = new Map<string, EpubReadingPosition>();
  window.__acquisitionLoad = async path => {
    const saved = positions.get(path) ?? null;
    const hold = pendingLoad;
    pendingLoad = undefined;
    if (hold) { hold.entered.resolve(); await hold.release.promise; if (hold.error) throw hold.error; }
    return saved;
  };
  const originalViewOpen = View.prototype.open;
  const originalInit = View.prototype.init;
  View.prototype.open = async function (book) {
    await originalViewOpen.call(this, book);
    const record = { view: this, closed: 0, destroyed: 0, rendererDestroyed: 0, docs: [] as Document[] };
    sessions.push(record);
    const close = this.close.bind(this);
    this.close = () => { record.docs.push(...this.renderer.getContents().map(c => c.doc)); record.closed++; close(); };
    const destroy = book.destroy.bind(book);
    book.destroy = () => { record.destroyed++; destroy(); };
    const renderer = this.renderer as typeof this.renderer & { destroy(): void };
    const destroyRenderer = renderer.destroy.bind(renderer);
    renderer.destroy = () => { record.rendererDestroyed++; destroyRenderer(); };
  };
  View.prototype.init = async function (options) {
    const hold = pendingInit;
    pendingInit = undefined;
    await originalInit.call(this, options);
    if (hold) { hold.entered.resolve(); await hold.release.promise; if (hold.error) throw hold.error; }
  };
  const current = () => document.querySelector<View>('.foliate-publication[aria-busy="false"] > foliate-view');
  const readable = (label: string, index = 0) => {
    const view = current();
    const cfi = view?.lastLocation?.cfi;
    if (!view || !cfi || view.resolveCFI(cfi).index !== index) return false;
    // Primary is the renderer's navigation selection, not the publication
    // passage reported for a spread. Require the addressed document and paint.
    const doc = view.renderer.getContents().find(content => content.index === index)?.doc;
    return doc?.body.textContent?.includes(`book ${label} section ${index + 1}`) && paintedPassage(view, cfi);
  };
  const ready = async (label: string, index = 0, restoredCfi?: string) => {
    await until(() => readable(label, index) && (!restoredCfi || paintedPassage(current()!, restoredCfi)),
      `${label} readable section ${index + 1}`);
    check(document.querySelectorAll('.foliate-reader:not([inert])').length === 1, "duplicate active Foliate sessions");
    return current()!;
  };
  const menu = async (label: string) => {
    await until(() => document.querySelector('button[aria-label="Open reader commands (:)"]'), "reader commands");
    (document.querySelector('button[aria-label="Open reader commands (:)"]') as HTMLElement).click();
    await until(() => [...document.querySelectorAll('[role="option"]')].some(el => el.textContent?.trim().startsWith(label)), label);
    ([...document.querySelectorAll('[role="option"]')].find(el => el.textContent?.trim().startsWith(label)) as HTMLElement).click();
    await frame();
  };
  const open = (label: "A" | "B") => window.__acquisitionOpen({
    kind: "epub", bytes: label === "A" ? a : b, name: `acquisition-${label.toLowerCase()}.epub`, path: `/canonical/${label}.epub`,
  });
  const root = createRoot(document.getElementById("root")!);
  root.render(<StrictMode><App /></StrictMode>);
  try {
    await until(() => window.__acquisitionOpen, "App acquisition observation");
    await checkpoint();
    await open("A"); const first = await ready("A");
    cases.push("foliate-single-session");
    select(invalid, "invalid.epub");
    await until(() => document.querySelector(".error-banner"), "invalid replacement error");
    check(current() === first && readable("A"), "invalid EPUB discarded the readable session");
    cases.push("foliate-invalid-retention");
    for (const fail of [false, true]) {
      const hold = pendingInit = gate(fail ? Error("late acquisition failure") : undefined);
      select(a, "late-a.epub");
      await bounded(hold.entered.promise, "late A renderer preparation");
      await open("B"); const winner = await ready("B");
      hold.release.resolve();
      await until(() => sessions.filter(s => s.closed === 0).length === 1, "stale candidate retirement");
      await checkpoint();
      check(current() === winner && readable("B") && !document.querySelector(".error-banner"), "late A success/failure changed B");
    }
    cases.push("foliate-stale-success-and-failure");
    const closing = pendingInit = gate();
    select(a, "closing-a.epub");
    await bounded(closing.entered.promise, "close during preparation");
    await menu("Close document");
    closing.release.resolve();
    await until(() => sessions.every(s => s.closed === 1), "cancelled candidate disposal");
    await checkpoint();
    check(!current() && !document.querySelector(".foliate-reader") && document.title === "Clio", "closed acquisition reappeared");
    cases.push("foliate-close-during-acquisition");
    await open("A"); const searching = await ready("A");
    await searching.goTo(2);
    await until(() => readable("A", 2) && positions.get("/canonical/A.epub")?.cfi === searching.lastLocation?.cfi,
      "A navigation position did not finish saving");
    const savedA = positions.get("/canonical/A.epub")!;
    check(savedA?.cfiModel === "foliate-html-v1", "A navigation was not persisted");
    const searchHold = gate();
    const search = searching.search.bind(searching);
    let returned = false;
    searching.search = options => {
      const iterator = search(options);
      let first = true;
      return {
        [Symbol.asyncIterator]() { return this; },
        async next(...args) {
          const result = await iterator.next(...args);
          if (first) { first = false; searchHold.entered.resolve(); await searchHold.release.promise; }
          return result;
        },
        async return(value) { returned = true; return iterator.return(value); },
        throw(error) { return iterator.throw(error); },
      };
    };
    await menu("Search document");
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Search query"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Paragraph");
    input.dispatchEvent(new Event("input", { bubbles: true })); await frame();
    ([...document.querySelectorAll("button")].find(el => el.textContent === "Find")!).click();
    await bounded(searchHold.entered.promise, "real pending search result");
    const resourceHold = gate();
    searching.book.transformTarget.addEventListener("data", event => {
      const detail = (event as CustomEvent<{ name: string; data: Promise<unknown> }>).detail;
      if (!detail.name.endsWith("/late.png")) return;
      detail.data = Promise.all([detail.data, resourceHold.release.promise]).then(([data]) => data);
      resourceHold.entered.resolve();
    });
    const section = searching.book.sections[0] as typeof searching.book.sections[0] & { loadHref(href: string): Promise<string> };
    const lateResource = observe(section.loadHref("late.png"));
    await bounded(resourceHold.entered.promise, "pending real archive resource");
    const oldDoc = searching.renderer.getContents()[0]!.doc;
    await open("B"); const replacement = await ready("B");
    check(returned && !searching.isConnected, "replacement retained pending search or renderer");
    resourceHold.release.resolve();
    const resourceResult = await bounded(lateResource, "retired archive resource completion");
    check(resourceResult.status === "fulfilled" && !resourceResult.value, "retired book published a late archive resource");
    searchHold.release.resolve(); await checkpoint();
    const progress = await replacement.getCFIProgress(replacement.lastLocation!.cfi);
    check(progress, "replacement has no CFI progress");
    await until(() => document.querySelector(".epub-status__progress")?.textContent?.trim() ===
      `${Math.round(progress.fraction * 100)}% ·`, "replacement progress did not settle before retirement snapshot");
    const status = document.querySelector(".epub-status")?.textContent;
    searching.dispatchEvent(new CustomEvent("link", { detail: { href: "EPUB/chapter-3.xhtml" } }));
    const retiredKey = new KeyboardEvent("keydown", { key: ":", code: "Semicolon", shiftKey: true, bubbles: true, cancelable: true });
    oldDoc.body.dispatchEvent(retiredKey);
    await checkpoint();
    check(!retiredKey.defaultPrevented && !document.querySelector(".command-palette,.search-status") &&
      current() === replacement && readable("B") && document.querySelector(".epub-status")?.textContent === status,
      "retired listeners/search changed replacement state");
    cases.push("foliate-replacement-retires-search-and-listeners");
    await replacement.goTo(1);
    await until(() => readable("B", 1) && positions.get("/canonical/B.epub")?.cfi === replacement.lastLocation?.cfi,
      "B navigation position did not finish saving");
    const savedB = positions.get("/canonical/B.epub")!;
    check(savedB?.cfiModel === "foliate-html-v1", "B navigation was not persisted");
    for (const fail of [false, true]) {
      positions.delete("/canonical/A.epub");
      const load = pendingLoad = gate(fail ? Error("late position load failure") : undefined);
      await open("A"); await bounded(load.entered.promise, "A pending stored position");
      // Keep B's real adjacent iframe at about:blank through the saved-position
      // restore attempt. Navigation must await that preload, not resolve the CFI
      // against its unfinished Document and fall back to the start of B.
      const preload = gate();
      window.__acquisitionPreload = async (renderer, index) => {
        if (index !== 1 || !renderer.getContents().some(content => content.doc.body?.textContent?.includes("book B section 1"))) return;
        delete window.__acquisitionPreload;
        preload.entered.resolve();
        await preload.release.promise;
      };
      try {
        await open("B");
        await bounded(preload.entered.promise, "B adjacent frame begins loading");
        await checkpoint();
      } finally {
        delete window.__acquisitionPreload;
        preload.release.resolve();
      }
      await ready("B", 1, savedB.cfi);
      positions.set("/canonical/A.epub", savedA);
      await open("A"); const winner = await ready("A", 2, savedA.cfi);
      const before = winner.lastLocation!.cfi;
      load.release.resolve(); await checkpoint();
      check(current() === winner && readable("A", 2) && winner.lastLocation!.cfi === before &&
        !document.querySelector('[role="alert"],.search-status') && document.querySelector(".epub-status")?.textContent?.includes("Acquisition A chapter 3"),
        "late position success/failure changed rapid A-B-A state");
      check(positions.get("/canonical/A.epub")?.cfi === savedA.cfi && positions.get("/canonical/B.epub")?.cfi === savedB.cfi, "replacement overwrote another document position");
    }
    cases.push("foliate-rapid-position-success-and-failure");
    const previous = current()!;
    await menu("Close document"); await until(() => !current(), "close for same-book reopen");
    await open("A"); const reopened = await ready("A", 2, savedA.cfi);
    check(reopened !== previous && !previous.isConnected, "same-book reopen reused a retired session");
    await menu("Previous chapter"); await until(() => readable("A", 1), "single reopened navigation");
    cases.push("foliate-fresh-reopen");
  } finally {
    root.unmount(); await checkpoint();
    View.prototype.open = originalViewOpen;
    View.prototype.init = originalInit;
  }
  for (const record of sessions) {
    check(record.closed === 1 && record.destroyed === 1 && record.rendererDestroyed === 1 &&
      record.docs.every(doc => !doc.defaultView?.frameElement?.isConnected), "session resources were not retired exactly once");
  }
  check(!document.querySelector("foliate-view,.foliate-reader"), "final reader ownership survived unmount");
}

async function bytes(name: string) {
  const response = await fetch(`/__fixtures/${name}`);
  check(response.ok, `missing fixture ${name}`);
  return new Uint8Array(await response.arrayBuffer());
}
async function run() {
  try {
    const [a, b, invalid] = await Promise.all(["acquisition-a.epub", "acquisition-b.epub", "invalid.epub"].map(bytes));
    await foliateLifecycle(a!, b!, invalid!);
    await checkpoint();
    check(errors.length === 0, `unexpected Foliate runtime errors: ${errors.join("; ")}`);
    check(created.every(url => revoked.includes(url)), `Unretired Foliate resources: ${JSON.stringify(created.filter(url => !revoked.includes(url)).map(url => foliateUrls.get(url)))}`);
    assertUrlsRetired(0);
    check(created.length > 0 && revoked.length === created.length, "Foliate archive URLs leaked or were revoked twice");
    return { passed: true, cases, errors, created: created.length, revoked: revoked.length, spine: 3 };
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  }
}
const bridge = (result: object) => {
  document.body.dataset.result = JSON.stringify(result);
  check("webkit" in window, "WebKit test bridge is unavailable");
  // The unchanged WebKit runner injects this fixed result-only bridge.
  const runtime = window as unknown as { webkit: { messageHandlers: { test: { postMessage(value: string): void } } } };
  runtime.webkit.messageHandlers.test.postMessage(JSON.stringify(result));
};
run().then(bridge).catch(error => bridge({
  passed: false, cases, errors, created: created.length, revoked: revoked.length,
  error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined,
  observation: failureObservation ?? readingObservation(),
}));
