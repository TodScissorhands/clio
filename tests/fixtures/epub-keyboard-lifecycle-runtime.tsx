import { createRoot } from "react-dom/client";
import App from "../../src/App";
import type { ReaderCommandId } from "../../src/reader/interactions";
import type { View as FoliateView } from "foliate-js/view.js";
import { foliateView } from "./foliate-test-reader";
import "../../src/index.css";

// Observe actual production registrations; dispatch tests routing, not native input.
type EventType = "keydown" | "keyup";
type Row = {
  document: WeakRef<Document>;
  downAdded: number; downRemoved: number; upAdded: number; upRemoved: number;
};
declare global {
  interface Window {
    __epubKeyboardListener?: (target: Document, type: EventType, delta: number, listener: (event: KeyboardEvent) => void) => void;
    __epubKeyboardContentLoad?: (doc: Document) => void;
    __epubKeyboardLifecycleRun?: () => Promise<unknown>;
    webkit: { messageHandlers: { test: { postMessage: (value: string) => void } } };
  }
}
const cases: string[] = [];
const errors: string[] = [];
const check: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};
const started = performance.now();
const settle = () => {
  const { promise, resolve } = Promise.withResolvers<void>();
  requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  return promise;
};
async function until(predicate: () => unknown, message: string) {
  const deadline = performance.now() + 5_000;
  while (!predicate()) {
    check(performance.now() < deadline && performance.now() - started < 65_000, message);
    await settle();
  }
  await settle();
}
window.addEventListener("error", (event) => errors.push(event.message));
window.addEventListener("unhandledrejection", (event) => errors.push(String(event.reason)));

function inventory(label: string) {
  const ids = new WeakMap<Document, Row>();
  const rows: Row[] = [];
  function note(doc: Document, type: EventType, delta: number) {
    let row = ids.get(doc);
    if (!row) {
      row = { document: new WeakRef(doc), downAdded: 0, downRemoved: 0, upAdded: 0, upRemoved: 0 };
      ids.set(doc, row); rows.push(row);
    }
    const active = type === "keydown" ? row.downAdded - row.downRemoved : row.upAdded - row.upRemoved;
    check(delta === 1 ? active === 0 : active === 1, `${label}: duplicate ${type} ${delta === 1 ? "registration" : "cleanup"}`);
    if (type === "keydown") delta === 1 ? row.downAdded++ : row.downRemoved++;
    else delta === 1 ? row.upAdded++ : row.upRemoved++;
  }
  function summary() {
    return rows.reduce((sum, row) => ({
      documents: sum.documents + 1,
      addedDown: sum.addedDown + row.downAdded, removedDown: sum.removedDown + row.downRemoved,
      addedUp: sum.addedUp + row.upAdded, removedUp: sum.removedUp + row.upRemoved,
      activeDown: sum.activeDown + row.downAdded - row.downRemoved,
      activeUp: sum.activeUp + row.upAdded - row.upRemoved,
    }), { documents: 0, addedDown: 0, removedDown: 0, addedUp: 0, removedUp: 0, activeDown: 0, activeUp: 0 });
  }
  function matchesDocuments(live: Set<Document>) {
    for (const row of rows) {
      const doc = row.document.deref();
      const expected = doc && live.has(doc) ? 1 : 0;
      if (row.downAdded - row.downRemoved !== expected || row.upAdded - row.upRemoved !== expected) return false;
    }
    for (const doc of live) {
      const row = ids.get(doc);
      if (!row || row.downAdded - row.downRemoved !== 1 || row.upAdded - row.upRemoved !== 1) return false;
    }
    return true;
  }
  function assertDocuments(live: Set<Document>, stage: string) {
    check(live.size > 0, `${label}/${stage}: no live iframe content documents`);
    for (const row of rows) {
      const doc = row.document.deref();
      const expected = doc && live.has(doc) ? 1 : 0;
      check(row.downAdded - row.downRemoved === expected && row.upAdded - row.upRemoved === expected,
        `${label}/${stage}: retired/current pair mismatch ${JSON.stringify(summary())}`);
    }
    for (const doc of live) {
      const row = ids.get(doc);
      check(row && row.downAdded - row.downRemoved === 1 && row.upAdded - row.upRemoved === 1,
        `${label}/${stage}: current document lacks its listener pair`);
    }
    return live.size;
  }
  function assertEmpty(stage: string) {
    const value = summary();
    check(value.activeDown === 0 && value.activeUp === 0, `${label}/${stage}: listeners survived teardown ${JSON.stringify(value)}`);
  }
  return { note, summary, assertDocuments, matchesDocuments, assertEmpty };
}
const production = inventory("production");
const loadedFoliateDocuments = new WeakSet<Document>();
window.__epubKeyboardContentLoad = doc => { loadedFoliateDocuments.add(doc); };
let iframeDispatchDelivered = false;
window.__epubKeyboardListener = (doc, type, delta) => {
  // React/framework and host listeners are intentionally outside this census.
  if (doc === document) return;
  production.note(doc, type, delta);
};


const root = createRoot(document.getElementById("root")!);
function hostKey(key: string, init: KeyboardEventInit = {}) {
  const target = document.querySelector<HTMLElement>('[aria-label="EPUB reading area"]') ?? document.body;
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
  target.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true, ...init }));
}
async function hostPage(view: FoliateView, key: "PageDown" | "PageUp") {
  const method = key === "PageDown" ? "next" : "prev";
  const original = view[method];
  let completion: ReturnType<FoliateView["next"]> | undefined;
  let calls = 0;
  view[method] = (distance?: number) => {
    calls++;
    return completion = original.call(view, distance);
  };
  try {
    hostKey(key);
    check(completion, `${key} did not reach the real reader`);
    await completion;
    check(calls === 1, `${key} caused ${calls} reader actions`);
  } finally {
    view[method] = original;
  }
}
async function openFile(bytes: Uint8Array, name = "lifecycle.epub") {
  const transfer = new DataTransfer();
  transfer.items.add(new File([Uint8Array.from(bytes).buffer], name));
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await settle();
}
function appDocuments(view: FoliateView) {
  return new Set(view.renderer.getContents().map(({ doc }) => doc).filter(doc => loadedFoliateDocuments.has(doc)));
}
function currentApp() {
  const view = foliateView();
  const viewport = document.querySelector<HTMLElement>('.foliate-publication[aria-busy="false"]');
  check(view && viewport, "missing real App Foliate reader");
  return { view, viewport };
}
async function appReady(previous?: FoliateView) {
  await until(() => {
    const view = foliateView();
    return view && view !== previous && appDocuments(view).size > 0;
  }, "real App EPUB did not become ready");
  const current = currentApp();
  await Promise.all([...appDocuments(current.view)].map(doc => doc.fonts.ready));
  await settle();
  await until(() => production.matchesDocuments(appDocuments(current.view)), "production router did not settle to exactly one live Document pair");
  production.assertDocuments(appDocuments(current.view), "app-ready");
  return current;
}
async function command(id: ReaderCommandId) {
  hostKey(":", { code: "Semicolon", shiftKey: true });
  await until(() => document.querySelector(".command-filter"), "host key did not open production palette");
  const filter = document.querySelector<HTMLInputElement>(".command-filter")!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(filter, id);
  filter.dispatchEvent(new Event("input", { bubbles: true }));
  await settle();
  const rows = document.querySelectorAll<HTMLElement>('.command-list [role="option"]');
  check(rows.length === 1, `missing or ambiguous production command: ${id}`);
  rows[0]!.click();
  await until(() => !document.querySelector(".command-palette"), `${id} did not close the palette`);
}
async function appCases(bytes: Uint8Array) {
  root.render(<App />);
  await until(() => document.querySelector('input[type="file"]'), "real App did not mount");
  await openFile(bytes);
  let current = await appReady();
  const embedded = [...appDocuments(current.view)][0]!;
  embedded.defaultView!.dispatchEvent(new KeyboardEvent("keydown", { key: ":", code: "Semicolon", shiftKey: true }));
  embedded.defaultView!.dispatchEvent(new KeyboardEvent("keyup", { key: ":", code: "Semicolon", shiftKey: true }));
  await settle();
  iframeDispatchDelivered = !!document.querySelector(".command-filter");
  check(iframeDispatchDelivered, "live publication event did not reach the shared router");
  check(current.view.book.sections.length === 64, "fixture does not contain 64 real sections");
  hostKey("Escape");
  await until(() => !document.querySelector(".command-palette"), "iframe command palette did not close");
  const before = { index: current.view.renderer.primaryIndex, page: current.view.renderer.page };
  const atBeforePage = () => current.view.renderer.primaryIndex === before.index && current.view.renderer.page === before.page;
  await hostPage(current.view, "PageDown");
  await until(() => !atBeforePage(), "host PageDown failed to move the real reader");
  await appReady();
  production.assertDocuments(appDocuments(current.view), "app-host-forward");
  await hostPage(current.view, "PageUp");
  await until(atBeforePage, "host PageUp failed to reverse the real reader");
  await appReady();
  for (let repeat = 0; repeat < 2; repeat++) {
    for (const id of ["continuous_layout", "paged_layout"] as const) {
      await command(id);
      await until(() => current.view.renderer.getAttribute("flow") === (id === "continuous_layout" ? "scrolled" : "paginated"),
        `App ${id} did not change the renderer presentation`);
      await appReady();
      production.assertDocuments(appDocuments(current.view), `app-${id}-${repeat}`);
    }
  }
  cases.push("app-open-host-keys-and-reflow");
  const retainedView = current.view;
  const retainedViewport = current.viewport;
  const invalid = new Uint8Array(await (await fetch("/__fixtures/invalid.epub")).arrayBuffer());
  await openFile(invalid, "invalid.epub");
  await until(() => document.querySelector(".error-banner"), "invalid replacement did not report an App error");
  check(currentApp().view === retainedView && currentApp().viewport === retainedViewport,
    "invalid replacement discarded the real committed reader");
  production.assertDocuments(appDocuments(retainedView), "app-invalid-replacement");
  await command("continuous_layout"); await appReady();
  production.assertDocuments(appDocuments(retainedView), "app-invalid-replacement-still-usable");
  await openFile(bytes);
  current = await appReady(retainedView);
  await settle();
  production.assertDocuments(appDocuments(current.view), "app-valid-replacement");
  cases.push("app-invalid-and-valid-replacement");
  for (let repeat = 0; repeat < 3; repeat++) {
    await command("close_document");
    await until(() => !foliateView(), "real App did not close EPUB");
    production.assertEmpty(`app-close-${repeat}`);
    await openFile(bytes);
    current = await appReady();
    hostKey(":", { code: "Semicolon", shiftKey: true });
    await until(() => document.querySelector(".command-filter"), "reopened reader lost consumer-visible keyboard commands");
    document.querySelector(".command-filter")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await until(() => !document.querySelector(".command-palette"), "reopened palette did not close");
    production.assertDocuments(appDocuments(current.view), `app-reopen-${repeat}`);
  }
  await command("close_document");
  await until(() => !foliateView(), "final real App close failed");
  production.assertEmpty("app-final-close");
  root.unmount(); await settle();
  production.assertEmpty("app-unmount");
  cases.push("app-repeated-close-reopen");
}
async function run() {
  const bytes = new Uint8Array(await (await fetch("/__fixtures/lifecycle.epub")).arrayBuffer());
  await appCases(bytes);
  check(errors.length === 0, `unexpected runtime errors: ${errors.join("; ")}`);
  return { passed: true, spine: 64, cases, production: production.summary(),
    errors, iframeDispatchDelivered, elapsedMs: Math.round(performance.now() - started) };
}
// Native reuse: serve this same bundle/assets with ?manual=1, call this function,
// and/or use ?resultUrl=/result to POST JSON instead of the offscreen WebKit bridge.
window.__epubKeyboardLifecycleRun = run;
async function bridge(result: object) {
  const endpoint = new URL(location.href).searchParams.get("resultUrl");
  if (endpoint) await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(result) });
  else window.webkit.messageHandlers.test.postMessage(JSON.stringify(result));
}
if (!new URL(location.href).searchParams.has("manual")) {
  run().then(bridge).catch((error: unknown) => bridge({
    passed: false, cases, errors, production: production.summary(),
    error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined,
  }));
}
