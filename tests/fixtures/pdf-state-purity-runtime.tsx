import { StrictMode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import App from "../../src/App";
import type { PdfRecolorSettings } from "../../src/pdf/recolor";
import type { ReaderCommandId } from "../../src/reader/interactions";
import type { ReaderFileSource } from "../../src/platform/tauriReaderFiles";
import type { ReadingPosition } from "../../src/platform/readingPosition";
import "../../src/index.css";

type Geometry = {
  page: number; width: number; height: number; scrollTop: number; scrollHeight: number;
  pageTop: number; pageHeight: number; firstText: string | null; textTop: number | null;
};
type Reader = {
  command: (id: ReaderCommandId) => void; settings: PdfRecolorSettings;
  page: number; path: string | null; size: { width: number; height: number };
};
type Commit = { settings: PdfRecolorSettings; path: string | null; geometry: Geometry | null };
type Write = { phase: string; payload: PdfRecolorSettings; committed: PdfRecolorSettings | null; calculating: number };
declare global {
  interface Window {
    __pdfPurity: {
      reader: Reader | null; open?: (source: ReaderFileSource) => Promise<void>;
      updaters: string[]; calculating: number; commits: Commit[];
      captures: { calculating: number; geometry: Geometry | null }[];
      applies: { anchor: { page: number; top: number }; geometry: Geometry | null }[];
      surfaceSetups: number; surfaceCleanups: number; viewersCreated: number; viewersDisposed: number; listeners: number;
      records: Map<string, ReadingPosition>; positionWrites: { path: string; position: ReadingPosition }[];
      measure: (page: number) => Geometry | null; resizeQueued?: () => void;
    };
  }
}
const key = "clio:pdf-recolor-settings";
const seed: PdfRecolorSettings = {
  recolor: true, recolorLightcolor: "#EEDDCF", recolorDarkcolor: "#123456",
  recolorKeephue: false, recolorReverseVideo: false, recolorAdjustLightness: false, activePreset: "custom",
};
const native = window as unknown as { webkit: { messageHandlers: { test: { postMessage: (message: string) => void } } } };
const post = (value: object) => native.webkit.messageHandlers.test.postMessage(JSON.stringify(value));
const errors: string[] = [];
const evidence: Record<string, unknown> = {};
const writes: Write[] = [];
let phase = "mount";
let reads = 0;
const originalGet = Storage.prototype.getItem;
const originalSet = Storage.prototype.setItem;
originalSet.call(localStorage, key, JSON.stringify(seed));
const stored = (): PdfRecolorSettings => JSON.parse(originalGet.call(localStorage, key)!);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const check = (value: unknown, message: string) => { if (!value) errors.push(`${phase}: ${message}`); };
function measure(page: number): Geometry | null {
  const viewer = document.querySelector<HTMLElement>(".document-viewport");
  const element = document.querySelector<HTMLElement>(`.page[data-page-number="${page}"]`);
  if (!viewer || !element) return null;
  const viewport = viewer.getBoundingClientRect();
  const bounds = element.getBoundingClientRect();
  const first = [...viewer.querySelectorAll<HTMLElement>(".textLayer span")].find(span => {
    const rect = span.getBoundingClientRect();
    return span.textContent?.trim() && rect.bottom > viewport.top && rect.top < viewport.bottom && rect.right > viewport.left && rect.left < viewport.right;
  });
  return { page, width: viewer.clientWidth, height: viewer.clientHeight, scrollTop: viewer.scrollTop, scrollHeight: viewer.scrollHeight,
    pageTop: bounds.top - viewport.top, pageHeight: bounds.height, firstText: first?.textContent ?? null, textTop: first ? first.getBoundingClientRect().top - viewport.top : null };
}
const trace = window.__pdfPurity = {
  reader: null, open: undefined, updaters: [], calculating: 0, commits: [], captures: [], applies: [],
  surfaceSetups: 0, surfaceCleanups: 0, viewersCreated: 0, viewersDisposed: 0, listeners: 0,
  records: new Map(), positionWrites: [], measure, resizeQueued: undefined,
} as Window["__pdfPurity"];
Storage.prototype.getItem = function(name) { if (name === key) reads += 1; return originalGet.call(this, name); };
Storage.prototype.setItem = function(name, value) {
  if (name === key) writes.push({ phase, payload: JSON.parse(value), committed: trace.reader?.settings ?? null, calculating: trace.calculating });
  originalSet.call(this, name, value);
};
const frame = () => {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const watchdog = setTimeout(() => reject(new Error(`${phase}: animation frame unavailable`)), 15_000);
  requestAnimationFrame(() => { clearTimeout(watchdog); resolve(); });
  return promise;
};
async function until(predicate: () => unknown, label: string) {
  const deadline = performance.now() + 15_000;
  while (!predicate()) { if (performance.now() > deadline) throw new Error(`${phase}: ${label}; viewport=${innerWidth}×${innerHeight}; requested=${evidence.requestedViewport}`); await frame(); }
}
const painted = () => {
  const page = trace.reader?.page;
  const element = document.querySelector<HTMLElement>(`.page[data-page-number="${page}"]`);
  return element?.querySelector(".textLayer")?.textContent?.includes(`Status PDF page ${page}`) &&
    [...element.querySelectorAll("canvas")].some(canvas => canvas.width > 0 && canvas.height > 0 && getComputedStyle(canvas).visibility !== "hidden");
};
async function settled() {
  await until(painted, "PDF text/canvas paint");
  let previous = "", quiet = 0;
  await until(() => {
    const tuple = JSON.stringify([trace.reader?.settings, measure(trace.reader!.page), trace.commits.length, trace.captures.length, trace.applies.length, writes.length]);
    quiet = painted() && tuple === previous ? quiet + 1 : 0;
    previous = tuple;
    return quiet >= 3;
  }, "paint/geometry/commit quiescence");
}
function commands(...ids: ReaderCommandId[]) { flushSync(() => { for (const id of ids) trace.reader!.command(id); }); }
async function open(path: string) {
  const bytes = new Uint8Array(await (await fetch("/status.pdf")).arrayBuffer());
  await trace.open!({ kind: "pdf", bytes, name: path.split("/").pop()!, path });
  await until(() => trace.reader?.path === path, "PDF acquisition");
  await settled();
}
async function color(target: "light" | "dark", value: string) {
  commands(target === "light" ? "recolor_set_lightcolor" : "recolor_set_darkcolor");
  const input = document.querySelector<HTMLInputElement>(`[aria-label="${target === "light" ? "Background" : "Foreground"} hex color"]`);
  if (!input) throw new Error("Custom color editor missing");
  flushSync(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  flushSync(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
}
async function resize(width: number, height: number) {
  const before = trace.reader!.size;
  evidence.requestedViewport = [width, height];
  post({ resize: [width, height], scale: devicePixelRatio });
  await until(() => Math.abs(window.innerWidth - width) <= 1 && Math.abs(window.innerHeight - height) <= 1, "native window resize");
  await until(() => trace.reader?.size !== before, "committed viewport measurement");
  await settled();
}
const root = createRoot(document.getElementById("root")!);
root.render(<StrictMode><App /></StrictMode>);
void (async () => {
  await until(() => trace.open && trace.reader, "reader mount");
  trace.records.set("/purity/A.pdf", { page: 2, offset: 0.35 });
  await open("/purity/A.pdf");
  check(writes.length === 0 && same(stored(), seed), "mount/replay overwrote stored custom settings");
  check(trace.viewersCreated - trace.viewersDisposed === 1 && trace.listeners === 5, "duplicate live PDF viewer/listeners");
  evidence.mount = { reads, writes: writes.length, setups: trace.surfaceSetups, cleanups: trace.surfaceCleanups,
    viewersCreated: trace.viewersCreated, viewersDisposed: trace.viewersDisposed, listeners: trace.listeners, settings: stored() };

  phase = "batched appearance";
  const batchStart = writes.length, updaterStart = trace.updaters.length;
  commands("theme_dark", "theme_sepia", "toggle_recolor", "recolor_toggle_keephue", "recolor_toggle_reverse_video", "recolor_toggle_adjust_lightness", "theme_light", "toggle_recolor", "toggle_recolor");
  await settled();
  check(trace.reader!.settings.activePreset === "light" && trace.reader!.settings.recolor, "rapid commands lost final theme/recolor");
  check(trace.reader!.settings.recolorKeephue && trace.reader!.settings.recolorReverseVideo && trace.reader!.settings.recolorAdjustLightness, "rapid commands lost advanced settings");
  check(writes.length - batchStart === 1 && same(stored(), trace.reader!.settings), "batch persisted intermediate/replayed rather than one final committed appearance");
  evidence.batch = { commands: 9, updaterEvaluations: trace.updaters.length - updaterStart, writes: writes.slice(batchStart), settings: stored() };

  phase = "custom colors";
  const invalidStart = writes.length, beforeInvalid = stored();
  await color("light", "not-hex");
  check(!!document.querySelector('[role="alert"]')?.textContent?.includes("Invalid hex color"), "invalid custom color not reported");
  check(writes.length === invalidStart && same(stored(), beforeInvalid), "invalid custom color was persisted");
  await color("light", "#abc"); await settled();
  await color("dark", "123456"); await settled();
  check(stored().recolorLightcolor === "#AABBCC" && stored().recolorDarkcolor === "#123456" && stored().activePreset === "custom", "custom colors/preset did not commit");
  for (const id of ["toggle_recolor", "toggle_recolor", "recolor_toggle_keephue", "recolor_toggle_reverse_video", "recolor_toggle_adjust_lightness"] as const) {
    commands(id); await settled();
    check(same(stored(), trace.reader!.settings), `${id} durable/committed appearance disagree`);
    check(document.querySelector(".reader-layout")?.getAttribute("data-recolor") === String(stored().recolor), `${id} visible recolor state disagrees`);
  }
  evidence.custom = { invalidWrites: writes.slice(invalidStart).filter(write => write.payload.recolorLightcolor === "not-hex").length, settings: stored() };

  phase = "discarded appearance batch";
  const durable = stored(), committed = trace.commits.length, start = writes.length;
  flushSync(() => {
    trace.reader!.command("theme_dark");
    trace.reader!.command("theme_sepia");
    root.render(<main>Reader retired</main>);
  });
  await until(() => trace.viewersCreated === trace.viewersDisposed, "viewer retirement");
  check(trace.commits.length === committed, "retired batch unexpectedly committed");
  check(writes.length === start && same(stored(), durable), "discarded updater changed durable appearance");
  check(trace.listeners === 0, "retirement leaked PDF event listeners");
  evidence.discarded = { before: durable, after: stored(), writes: writes.slice(start), newCommits: trace.commits.length - committed };
  root.render(<StrictMode><App /></StrictMode>);
  await until(() => trace.open && trace.reader, "StrictMode remount");
  check(same(trace.reader!.settings, durable), "reopen recovered uncommitted appearance");
  check(writes.length === start, "remount persisted initial/default settings");
  evidence.reopenedAppearance = trace.reader!.settings;
  await open("/purity/A.pdf");

  phase = "resize anchors";
  commands("fit_to_page_width"); await settled();
  commands("toggle_continuous_scrolling"); await settled();
  const viewer = document.querySelector<HTMLElement>(".document-viewport")!;
  const page = document.querySelector<HTMLElement>('.page[data-page-number="2"]')!;
  viewer.scrollTop += page.getBoundingClientRect().top - viewer.getBoundingClientRect().top + page.getBoundingClientRect().height * 0.06;
  await settled();
  const resizeStart = writes.length;
  const geometries = [{ before: measure(2) }];
  for (const [width, height] of [[900, 650], [1200, 760], [760, 600], [1000, 700]]) {
    const applied = trace.applies.length;
    await resize(width, height);
    const last = trace.applies.at(-1);
    check(trace.applies.length > applied && last?.anchor.page === 2 && Math.abs(last.geometry!.pageTop - last.anchor.top) <= 2,
      `resize ${width}×${height} lost the pre-layout page anchor`);
    check(trace.reader!.page === 2 && measure(2)?.firstText === "Status PDF page 2", `resize ${width}×${height} lost painted page 2`);
    geometries.push({ before: measure(2) });
  }
  check(writes.length === resizeStart, "geometry changes wrote appearance preferences");
  check(trace.captures.every(capture => capture.calculating === 0), "anchor capture ran inside updater evaluation");
  evidence.resize = { geometries, captures: trace.captures, applies: trace.applies, position: trace.records.get("/purity/A.pdf") };
  commands("two_page_spread"); await settled();
  commands("single_page_view"); await settled();
  commands("zoom_in"); await settled();
  commands("fit_to_page"); await settled();
  check(trace.records.get("/purity/A.pdf")?.offset !== 0, "layout rewrote restored nonzero offset to zero");

  phase = "replacement";
  commands("theme_light"); await open("/purity/B.pdf");
  const replacementSettings = stored();
  check(same(trace.reader!.settings, replacementSettings), "PDF replacement reset appearance");
  commands("theme_sepia");
  const bytes = new Uint8Array(await (await fetch("/status.epub")).arrayBuffer());
  await trace.open!({ kind: "epub", bytes, name: "status.epub", path: null });
  await until(() => document.querySelector(".epub-status") && !trace.reader, "PDF to EPUB retirement");
  check(stored().activePreset === "sepia-warm", "cross-format replacement lost committed appearance");
  const epubWrites = writes.length;
  await open("/purity/A.pdf");
  check(writes.length === epubWrites && same(trace.reader!.settings, stored()), "PDF remount wrote defaults or stale preferences");
  evidence.replacement = { records: Object.fromEntries(trace.records), settings: stored() };

  phase = "close with pending resize";
  const resizeQueued = Promise.withResolvers<void>();
  trace.resizeQueued = resizeQueued.resolve;
  post({ resize: [920, 660], scale: devicePixelRatio });
  const resizeWatchdog = setTimeout(() => resizeQueued.reject(new Error("Pending resize was not observed")), 15_000);
  try { await resizeQueued.promise; } finally { clearTimeout(resizeWatchdog); }
  trace.resizeQueued = undefined;
  commands("close_document");
  await until(() => trace.reader?.path === null && !document.querySelector(".page"), "close during queued resize");
  await open("/purity/A.pdf");
  await settled();
  evidence.close = { settings: stored(), position: trace.records.get("/purity/A.pdf"), geometry: measure(trace.reader!.page) };

  root.unmount();
  check(trace.viewersCreated === trace.viewersDisposed && trace.listeners === 0, "final cleanup leaked viewer/listeners");
  check(writes.every(write => !write.calculating && same(write.payload, write.committed)), "storage write occurred during calculation or disagreed with committed appearance");
  evidence.lifecycle = { setups: trace.surfaceSetups, cleanups: trace.surfaceCleanups, created: trace.viewersCreated, disposed: trace.viewersDisposed, listeners: trace.listeners };
  post({ passed: errors.length === 0, runtime: process.env.NODE_ENV, errors, evidence, writes });
})().catch(error => post({ passed: false, runtime: process.env.NODE_ENV, error: String(error), errors, evidence, writes, geometry: trace.reader && measure(trace.reader.page) }));
