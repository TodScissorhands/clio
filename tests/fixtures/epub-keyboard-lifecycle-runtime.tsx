import { createRoot } from "react-dom/client";
import type { Rendition } from "epubjs";
import App from "../../src/App";
import { openEpubBook } from "../../src/epub/engine";
import { attachEpubKeyboard } from "../../src/epub/iframeKeyboard";
import type { ReaderCommandId } from "../../src/reader/interactions";
import "../../src/index.css";

// This fixture uses installed epub.js and real sandboxed iframe views throughout.
// Only the App registrar and rendition exposure are instrumented by the in-memory
// Vite transform in the test. Neither production behavior nor promises are wrapped.
type Content = { document: Document };
type View = {
  section: { index: number }; contents?: Content; iframe?: HTMLIFrameElement;
  element: HTMLElement; displayed: boolean; expanded: boolean; _expanding: boolean;
  display(request: unknown): Promise<View>; show(): void;
  position(): { top: number; bottom: number; left: number; right: number };
};
type Hook = { list(): ((source: unknown) => unknown)[]; register(callback: (source: unknown) => unknown): void; deregister(callback: (source: unknown) => unknown): void };
type RuntimeRendition = Rendition & {
  hooks: { content: Hook; render: Hook };
  manager: {
    container: HTMLElement; request: unknown; trimTimeout?: number;
    views: { all(): View[]; remove(view: View): void };
    q: { enqueue(callback: () => unknown): Promise<unknown> };
    append(section: unknown): View;
    check(): Promise<unknown>; trim(): Promise<void>;
    scrollTo(x: number, y: number, silent?: boolean): void;
    bounds(): { top: number; bottom: number };
  };
};
type EventType = "keydown" | "keyup";
type Row = {
  document: WeakRef<Document>;
  downAdded: number; downRemoved: number; upAdded: number; upRemoved: number;
};
declare global {
  interface Window {
    __epubKeyboardListener?: (target: Document, type: EventType, delta: number, listener: (event: KeyboardEvent) => void) => void;
    __epubKeyboardRendition?: (rendition: Rendition) => void;
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

function liveDocuments(rendition: Rendition, viewport: HTMLElement) {
  return new Set((rendition.getContents() as unknown as Content[]).map((content) => content.document).filter((doc) => {
    const frame = doc.defaultView?.frameElement;
    return frame instanceof HTMLIFrameElement && viewport.contains(frame) && frame.contentDocument === doc;
  }));
}
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
  function register(doc: Document) {
    const target = doc.defaultView;
    check(target, `${label}: missing embedded Window`);
    const down = (event: KeyboardEvent) => event.preventDefault();
    const up = (event: KeyboardEvent) => event.preventDefault();
    target.addEventListener("keydown", down, true); note(doc, "keydown", 1);
    target.addEventListener("keyup", up, true); note(doc, "keyup", 1);
    return () => {
      target.removeEventListener("keydown", down, true); note(doc, "keydown", -1);
      target.removeEventListener("keyup", up, true); note(doc, "keyup", -1);
    };
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
  function assertLive(rendition: Rendition, viewport: HTMLElement, stage: string) {
    const live = liveDocuments(rendition, viewport);
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
  function retired(live: Set<Document>) {
    return rows.filter((row) => {
      const doc = row.document.deref();
      return (!doc || !live.has(doc)) && row.downAdded > row.downRemoved;
    }).length;
  }
  return { note, register, summary, assertLive, assertEmpty, retired };
}
const helper = inventory("helper");
const production = inventory("production");
const shadow = inventory("former-map-removed-strategy");
const productionHandlers = new WeakMap<Document, Partial<Record<EventType, WeakRef<(event: KeyboardEvent) => void>>>>();
let iframeDispatchDelivered = false;
window.__epubKeyboardListener = (doc, type, delta, listener) => {
  // React/framework and host listeners are intentionally outside this census.
  if (doc === document) return;
  production.note(doc, type, delta);
  const handlers = productionHandlers.get(doc) ?? {};
  if (delta === 1) handlers[type] = new WeakRef(listener);
  else delete handlers[type];
  productionHandlers.set(doc, handlers);
};
let appRendition: WeakRef<RuntimeRendition> | undefined;
window.__epubKeyboardRendition = (rendition) => { appRendition = new WeakRef(rendition as RuntimeRendition); };

// Behavioral failure oracle: the exact former Document Map + rendition removed
// event ownership strategy runs beside the fix on the SAME real library views.
function attachFormerStrategy(rendition: RuntimeRendition) {
  const cleanups = new Map<Document, () => void>();
  const getDocument = (source: unknown): Document | undefined => {
    if (!source || typeof source !== "object") return;
    const content = "contents" in source ? source.contents : source;
    return content && typeof content === "object" && "document" in content ? content.document as Document : undefined;
  };
  const content = (source: unknown) => {
    const doc = getDocument(source);
    if (doc && !cleanups.has(doc)) cleanups.set(doc, shadow.register(doc));
  };
  const removed = (_section: unknown, view: unknown) => {
    const doc = getDocument(view);
    if (!doc) return;
    cleanups.get(doc)?.(); cleanups.delete(doc);
  };
  rendition.hooks.content.register(content);
  rendition.on("removed", removed);
  return () => {
    rendition.hooks.content.deregister(content); rendition.off("removed", removed);
    for (const cleanup of cleanups.values()) cleanup();
    cleanups.clear();
  };
}
function attachCaptured(rendition: RuntimeRendition, viewport: HTMLElement) {
  const before = new Set(rendition.hooks.content.list());
  const dispose = attachEpubKeyboard(rendition, viewport, helper.register);
  const hook = rendition.hooks.content.list().find((candidate) => !before.has(candidate));
  check(hook, "helper did not register its content hook");
  return { dispose, hook };
}
async function drain(rendition: RuntimeRendition) {
  await rendition.q.enqueue(() => undefined);
  await rendition.manager.q.enqueue(() => undefined);
  await settle();
}
async function directCases(bytes: Uint8Array) {
  const viewport = document.createElement("div");
  viewport.style.cssText = "position:absolute;inset:0;width:800px;height:420px;overflow:hidden";
  document.body.append(viewport);
  const book = await openEpubBook(bytes);
  let spine = 0;
  book.spine.each(() => spine++);
  check(spine === 64, "fixture does not contain all 64 real spine sections");
  const options = {
    width: 800, height: 420, manager: "continuous", flow: "paginated", spread: "none",
    allowScriptedContent: false, resizeOnOrientationChange: false, offset: 420,
  };
  const rendition = book.renderTo(viewport, options) as RuntimeRendition;
  let lifetime = attachCaptured(rendition, viewport);
  const disposeShadow = attachFormerStrategy(rendition);
  let baseline = { retiredRegistrations: 0, trimRetiredRegistrations: 0 };
  let trim = { before: 0, after: 0, removed: 0, retainedNeighbors: 0 };
  try {
    await rendition.display(0); await drain(rendition);
    helper.assertLive(rendition, viewport, "initial");
    await rendition.next(); await drain(rendition);
    helper.assertLive(rendition, viewport, "forward");
    await rendition.prev(); await drain(rendition);
    helper.assertLive(rendition, viewport, "back");
    cases.push("initial-open-forward-back");

    rendition.flow("scrolled-continuous");
    await rendition.display(0); await drain(rendition);
    let furthest = 0;
    for (let step = 0; step < 26; step++) {
      await rendition.next(); await drain(rendition);
      helper.assertLive(rendition, viewport, `continuous-forward-${step}`);
      furthest = Math.max(furthest, ...rendition.manager.views.all().map((view) => view.section.index));
    }
    check(furthest >= 10, `continuous sequence did not cross many sections: ${furthest}`);
    const forwardBounds = rendition.manager.bounds();
    const forwardIndex = Math.min(...rendition.manager.views.all()
      .filter((view) => view.position().bottom > forwardBounds.top && view.position().top < forwardBounds.bottom)
      .map((view) => view.section.index));
    for (let step = 0; step < 8; step++) {
      await rendition.prev(); await drain(rendition);
      helper.assertLive(rendition, viewport, `continuous-reverse-${step}`);
    }
    const reverseBounds = rendition.manager.bounds();
    const reverseIndex = Math.min(...rendition.manager.views.all()
      .filter((view) => view.position().bottom > reverseBounds.top && view.position().top < reverseBounds.bottom)
      .map((view) => view.section.index));
    check(Number.isFinite(forwardIndex) && Number.isFinite(reverseIndex) && reverseIndex < forwardIndex,
      `continuous reversal did not move backwards through real sections: ${forwardIndex} -> ${reverseIndex}`);
    cases.push("continuous-traversal-reversal");

    // Append actual views in parallel, then trim once around a real middle view.
    // No fake geometry, flags, manager methods or library event implementations.
    await rendition.display(20); await drain(rendition);
    const last = Math.max(...rendition.manager.views.all().map((view) => view.section.index));
    const appended: View[] = [];
    for (let index = last + 1; index <= last + 10; index++) appended.push(rendition.manager.append(book.spine.get(index)));
    await Promise.all(appended.map(async (view) => { await view.display(rendition.manager.request); view.show(); }));
    await until(() => rendition.manager.views.all().every((view) => view.displayed && view.expanded && !view._expanding), "real views never became trim-eligible");
    helper.assertLive(rendition, viewport, "before-trim");
    const before = rendition.manager.views.all().slice();
    const retiredBeforeTrim = shadow.retired(liveDocuments(rendition, viewport));
    const middle = before[Math.floor(before.length / 2)]!;
    const top = middle.position().top - rendition.manager.bounds().top + rendition.manager.container.scrollTop;
    rendition.manager.scrollTo(0, top + 8, true);
    const bounds = rendition.manager.bounds();
    const visible = before.filter((view) => view.position().bottom > bounds.top && view.position().top < bounds.bottom);
    check(visible.length > 0, "trim setup has no actually visible views");
    const first = before.indexOf(visible[0]!);
    const lastVisible = before.indexOf(visible[visible.length - 1]!);
    const expected = before.slice(Math.max(0, first - 1), Math.min(before.length, lastVisible + 2));
    await rendition.manager.trim();
    await settle();
    const after = rendition.manager.views.all();
    trim = { before: before.length, after: after.length, removed: before.length - after.length,
      retainedNeighbors: expected.filter((view) => !visible.includes(view)).length };
    check(trim.removed >= 2, `actual trim did not remove multiple real views: ${JSON.stringify(trim)}`);
    check(expected.every((view) => after.includes(view)), "trim removed a live visible/retained-neighbor view");
    check(trim.retainedNeighbors === 2, "trim did not exercise both retained neighbors");
    helper.assertLive(rendition, viewport, "after-trim");
    const retiredAfterTrim = shadow.retired(liveDocuments(rendition, viewport));
    baseline = { retiredRegistrations: retiredAfterTrim, trimRetiredRegistrations: retiredAfterTrim - retiredBeforeTrim };
    check(baseline.trimRetiredRegistrations >= trim.removed, "former strategy failed to reproduce newly retired keyboard listeners on this real trim");
    cases.push("actual-multiple-view-trim");

    for (let repeat = 0; repeat < 3; repeat++) {
      for (const flow of ["paginated", "scrolled-continuous"]) {
        rendition.flow(flow); await rendition.display(12 + repeat); await drain(rendition);
        helper.assertLive(rendition, viewport, `reflow-${flow}-${repeat}`);
      }
    }
    cases.push("repeated-reflow-both-modes");
    for (const index of [55, 3, 41, 0]) {
      await rendition.display(index); await drain(rendition);
      check(rendition.manager.views.all().some((view) => view.section.index === index), `chapter ${index} was not rendered`);
      helper.assertLive(rendition, viewport, `jump-${index}`);
    }
    cases.push("chapter-jumps");
    // Keep several genuine live neighbors for the two upcoming removal races.
    const retainedLast = Math.max(...rendition.manager.views.all().map((view) => view.section.index));
    const retained: View[] = [];
    for (let index = retainedLast + 1; index <= retainedLast + 3; index++) {
      retained.push(rendition.manager.append(book.spine.get(index)));
    }
    await Promise.all(retained.map(async (view) => { await view.display(rendition.manager.request); view.show(); }));
    await settle();
    helper.assertLive(rendition, viewport, "additional-real-neighbors");


    const repeatedContent = (rendition.getContents() as unknown as Content[])[0]!;
    const repeatedView = rendition.manager.views.all().find((view) => view.contents === repeatedContent)!;
    const beforeRepeated = helper.summary().addedDown;
    for (let repeat = 0; repeat < 6; repeat++) {
      lifetime.hook(repeatedContent); lifetime.hook(repeatedView);
    }
    check(helper.summary().addedDown === beforeRepeated, "same-document hooks duplicated listeners");
    // Navigate the SAME connected real iframe without a viewport DOM mutation.
    // IframeView.onload may adopt the replacement into getContents; assert from
    // actual ownership, never assume a navigation is always valid or invalid.
    const navigatedFrame = repeatedView.iframe;
    check(navigatedFrame, "missing actual iframe for same-frame navigation");
    check(navigatedFrame.sandbox.contains("allow-same-origin") && !navigatedFrame.sandbox.contains("allow-scripts"),
      "same-frame navigation must preserve the real author-script sandbox");
    let loaded = false;
    navigatedFrame.addEventListener("load", () => { loaded = true; }, { once: true });
    navigatedFrame.srcdoc = '<!doctype html><html><head><title>Replacement document</title></head><body>Same connected frame, new document.</body></html>';
    await until(() => loaded && navigatedFrame.contentDocument !== repeatedContent.document, "same-frame replacement did not load a new Document");
    check(viewport.contains(navigatedFrame), "same-frame replacement detached the frame");
    helper.assertLive(rendition, viewport, "same-frame-document-replacement");
    const afterNavigation = helper.summary().addedDown;
    lifetime.hook(repeatedContent);
    check(helper.summary().addedDown === afterNavigation, "stale Contents hook duplicated replacement registration");
    cases.push("same-frame-document-replacement");

    const removedContent = repeatedView.contents;
    check(removedContent, "real replacement lost its managed Contents before removal");
    rendition.manager.views.remove(repeatedView);
    await settle();
    helper.assertLive(rendition, viewport, "removed-before-late");
    const beforeLate = helper.summary().addedDown;
    lifetime.hook(removedContent);
    check(helper.summary().addedDown === beforeLate, "captured late content hook re-registered a removed document");
    helper.assertLive(rendition, viewport, "removed-after-late");
    cases.push("same-document-hooks-and-late-removed-hook");

    // A DOM removal has queued an observer delivery; synchronous dispose must win.
    const queued = rendition.manager.views.all()[0]!;
    const oldLifetime = lifetime;
    rendition.manager.views.remove(queued);
    oldLifetime.dispose(); oldLifetime.dispose();
    helper.assertEmpty("dispose-before-queued-observer");
    // Seed a new lifetime from still-live getContents without another content hook.
    check(liveDocuments(rendition, viewport).size > 0, "same-Book replay setup has no retained live document");
    lifetime = attachCaptured(rendition, viewport);
    helper.assertLive(rendition, viewport, "same-book-reattach");
    oldLifetime.dispose(); oldLifetime.hook(repeatedContent);
    // Even a stale removed event from the prior lifetime cannot release the new pair.
    const currentView = rendition.manager.views.all()[0]!;
    rendition.emit("removed", currentView.section, currentView);
    await settle();
    helper.assertLive(rendition, viewport, "old-disposer-and-event-after-reattach");
    cases.push("dispose-before-observer-and-same-book-replay");

    // Real render-hook promise remains pending while the real displayed view is
    // removed. Release only the fixture's own gate; never resolve library promises.
    const renderGate = Promise.withResolvers<void>();
    const renderEntered = Promise.withResolvers<View>();
    const renderHook = (source: unknown) => {
      const view = source as View;
      if (view.section.index === 48) { renderEntered.resolve(view); return renderGate.promise; }
    };
    rendition.hooks.render.register(renderHook);
    const rendering = rendition.display(48);
    const pendingRenderView = await renderEntered.promise;
    await rendering; await settle();
    check(pendingRenderView.displayed, "render gate did not hold an actual displayed view");
    const beforeRenderRemoval = helper.summary().addedDown;
    rendition.manager.views.remove(pendingRenderView);
    renderGate.resolve();
    await settle();
    rendition.hooks.render.deregister(renderHook);
    check(helper.summary().addedDown === beforeRenderRemoval, "removed view acquired keyboard listeners after render-hook release");
    // Surviving automatically retained neighbors remain registered and usable.
    helper.assertLive(rendition, viewport, "pending-render-removal");
    cases.push("removed-during-render-hook");

    const contentGate = Promise.withResolvers<void>();
    const contentEntered = Promise.withResolvers<Content>();
    const contentHook = (source: unknown) => {
      const content = source as Content;
      if (content.document.querySelector("h1")?.textContent === "Lifecycle chapter 53") {
        contentEntered.resolve(content); return contentGate.promise;
      }
    };
    rendition.hooks.content.register(contentHook);
    const displaying = rendition.display(52);
    const pendingContent = await contentEntered.promise;
    await displaying; await settle();
    const pendingContentView = rendition.manager.views.all().find((view) => view.contents === pendingContent);
    check(pendingContentView, "content gate did not capture an actual managed view");
    rendition.manager.views.remove(pendingContentView);
    await settle();
    contentGate.resolve(); await settle();
    rendition.hooks.content.deregister(contentHook);
    helper.assertLive(rendition, viewport, "pending-content-removal");
    cases.push("removed-during-content-hook");
  } finally {
    lifetime.dispose(); disposeShadow();
    helper.assertEmpty("final-dispose"); shadow.assertEmpty("shadow-final-dispose");
    book.destroy(); viewport.remove();
    await settle();
    helper.assertEmpty("book-destroy");
  }
  return { baseline, trim };
}

const root = createRoot(document.getElementById("root")!);
function hostKey(key: string, init: KeyboardEventInit = {}) {
  const target = document.querySelector<HTMLElement>('[aria-label="EPUB reading area"]') ?? document.body;
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
  target.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true, ...init }));
}
async function openFile(bytes: Uint8Array, name = "lifecycle.epub") {
  const transfer = new DataTransfer();
  transfer.items.add(new File([Uint8Array.from(bytes).buffer], name));
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await settle();
}
function currentApp() {
  const rendition = appRendition?.deref();
  const viewport = document.querySelector<HTMLElement>('[aria-label="EPUB reading area"]');
  check(rendition && viewport, "missing real App EPUB reader/rendition");
  return { rendition, viewport };
}
async function appReady(previous?: RuntimeRendition) {
  await until(() => {
    const rendition = appRendition?.deref();
    const viewport = document.querySelector<HTMLElement>('[aria-label="EPUB reading area"]');
    return rendition && rendition !== previous && viewport && rendition.manager && liveDocuments(rendition, viewport).size > 0
      && document.activeElement === viewport;
  }, "real App EPUB did not become ready");
  const current = currentApp();
  await drain(current.rendition);
  production.assertLive(current.rendition, current.viewport, "app-ready");
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
  const embedded = [...liveDocuments(current.rendition, current.viewport)][0]!;
  embedded.defaultView!.dispatchEvent(new KeyboardEvent("keydown", { key: ":", code: "Semicolon", shiftKey: true }));
  embedded.defaultView!.dispatchEvent(new KeyboardEvent("keyup", { key: ":", code: "Semicolon", shiftKey: true }));
  await settle();
  iframeDispatchDelivered = !!document.querySelector(".command-filter");
  if (iframeDispatchDelivered) {
    hostKey("Escape");
    await until(() => !document.querySelector(".command-palette"), "dispatched iframe command palette did not close");
  }
  // WebKit may suppress iframe dispatch without allow-scripts. Exercise the real
  // installed callback separately; this is observation, not a focus workaround.
  const embeddedDown = productionHandlers.get(embedded)?.keydown?.deref();
  const embeddedUp = productionHandlers.get(embedded)?.keyup?.deref();
  check(embeddedDown && embeddedUp, "live iframe has no installed production callbacks");
  embeddedDown(new KeyboardEvent("keydown", { key: ":", code: "Semicolon", shiftKey: true }));
  embeddedUp(new KeyboardEvent("keyup", { key: ":", code: "Semicolon", shiftKey: true }));
  await until(() => document.querySelector(".command-filter"), "installed iframe callback did not open the production palette");
  hostKey("Escape");
  await until(() => !document.querySelector(".command-palette"), "installed-callback palette did not close");
  const before = current.rendition.manager.container.scrollLeft;
  hostKey("PageDown"); await drain(current.rendition);
  production.assertLive(current.rendition, current.viewport, "app-host-forward");
  check(current.rendition.manager.container.scrollLeft > before, "host PageDown failed to move the real reader");
  hostKey("PageUp"); await drain(current.rendition);
  production.assertLive(current.rendition, current.viewport, "app-host-back");
  for (let repeat = 0; repeat < 2; repeat++) {
    for (const id of ["continuous_layout", "paged_layout"] as const) {
      await command(id);
      await until(() => current.rendition.manager.views.all().some((view) => view.displayed), `App ${id} did not render`);
      await drain(current.rendition);
      production.assertLive(current.rendition, current.viewport, `app-${id}-${repeat}`);
    }
  }
  cases.push("app-open-host-keys-and-reflow");
  const retainedRendition = current.rendition;
  const retainedViewport = current.viewport;
  const invalid = new Uint8Array(await (await fetch("/__fixtures/invalid.epub")).arrayBuffer());
  await openFile(invalid, "invalid.epub");
  await until(() => document.querySelector(".error-banner"), "invalid replacement did not report an App error");
  check(currentApp().rendition === retainedRendition && currentApp().viewport === retainedViewport,
    "invalid replacement discarded the real committed reader");
  production.assertLive(retainedRendition, retainedViewport, "app-invalid-replacement");
  await command("continuous_layout"); await drain(retainedRendition);
  production.assertLive(retainedRendition, retainedViewport, "app-invalid-replacement-still-usable");
  await openFile(bytes);
  current = await appReady(retainedRendition);
  await settle();
  production.assertLive(current.rendition, current.viewport, "app-valid-replacement");
  cases.push("app-invalid-and-valid-replacement");
  for (let repeat = 0; repeat < 3; repeat++) {
    await command("close_document");
    await until(() => !document.querySelector(".epub-reader"), "real App did not close EPUB");
    production.assertEmpty(`app-close-${repeat}`);
    await openFile(bytes);
    current = await appReady();
    hostKey(":", { code: "Semicolon", shiftKey: true });
    await until(() => document.querySelector(".command-filter"), "reopened reader lost consumer-visible keyboard commands");
    document.querySelector(".command-filter")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await until(() => !document.querySelector(".command-palette"), "reopened palette did not close");
    production.assertLive(current.rendition, current.viewport, `app-reopen-${repeat}`);
  }
  await command("close_document");
  await until(() => !document.querySelector(".epub-reader"), "final real App close failed");
  production.assertEmpty("app-final-close");
  root.unmount(); await settle();
  production.assertEmpty("app-unmount");
  cases.push("app-repeated-close-reopen");
}
async function run() {
  const bytes = new Uint8Array(await (await fetch("/__fixtures/lifecycle.epub")).arrayBuffer());
  const direct = await directCases(bytes);
  await appCases(bytes);
  check(errors.length === 0, `unexpected runtime errors: ${errors.join("; ")}`);
  return { passed: true, spine: 64, cases, ...direct, helper: helper.summary(), production: production.summary(),
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
    passed: false, cases, errors, helper: helper.summary(), production: production.summary(),
    error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined,
  }));
}
