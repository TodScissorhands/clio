import { useRef } from "react";
import { createRoot } from "react-dom/client";
import App from "../../src/App";
import { PdfViewerSurface } from "../../src/pdf/PdfViewerSurface";
import type { PdfViewerHandle } from "../../src/pdf/PdfViewerSurface";
import { createPdfLoadingTask } from "../../src/pdf/engine";
import type { PdfDocument, PdfLoadingTask } from "../../src/pdf/engine";
import { DEFAULT_RECOLOR_SETTINGS, parseHexColor, recolorImageDataCpu } from "../../src/pdf/recolor";
import type { CpuRecolorOptions, PdfRecolorSettings } from "../../src/pdf/recolor";
import { READER_COMMANDS } from "../../src/reader/interactions";
import { pdfAdvancedAppearanceCommands } from "../../src/reader/appearanceCommands";
import type { ReaderCommandId } from "../../src/reader/interactions";
import "../../src/index.css";

type Observation = {
  map: Map<number, HTMLCanvasElement>;
  viewerHandle: PdfViewerHandle;
  pdf: PdfDocument | null;
  queue: Map<number, unknown>;
  active: () => unknown;
  timer: () => number | undefined;
  completedSource: (canvas: HTMLCanvasElement) => HTMLCanvasElement | undefined;
};
type PageView = { canvas?: HTMLCanvasElement; renderingState: number };
type Sample = { pristine: HTMLCanvasElement; canvas: HTMLCanvasElement; bytes: Uint8ClampedArray; commits: number };
type Gate = { release: () => void };
type CpuProbe = {
  hold: boolean; started: number; settled: number; active: number; maxActive: number;
  buffers: number; maxBuffers: number; completed: number; discarded: number; yields: number;
  invoke: (operation: () => Promise<boolean>) => Promise<boolean>;
  yield: (options: CpuRecolorOptions, operation: () => Promise<boolean>) => Promise<boolean>;
};
declare global {
  interface Window {
    __pdfCooperative: Observation;
    __cpuTest: CpuProbe;
    webkit: { messageHandlers: { test: { postMessage: (message: string) => void } } };
  }
}

const check: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};
const errors: string[] = [];
window.addEventListener("error", (event) => { errors.push(event.message); });
window.addEventListener("unhandledrejection", (event) => { errors.push(String(event.reason)); });
const gates = new Set<Gate>();
const cpu: CpuProbe = window.__cpuTest = {
  hold: false, started: 0, settled: 0, active: 0, maxActive: 0,
  buffers: 0, maxBuffers: 0, completed: 0, discarded: 0, yields: 0,
  async invoke(operation: () => Promise<boolean>) {
    this.started++; this.active++;
    this.maxActive = Math.max(this.maxActive, this.active);
    try {
      const result = await operation();
      if (result) this.completed++; else this.discarded++;
      return result;
    } finally { this.active--; this.settled++; }
  },
  async yield(options: CpuRecolorOptions, operation: () => Promise<boolean>) {
    this.yields++;
    const resumed = await operation();
    if (!resumed || !this.hold || options.signal?.aborted) return resumed;
    const { promise, resolve } = Promise.withResolvers<void>();
    const finish = () => {
      gates.delete(gate);
      options.signal?.removeEventListener("abort", finish);
      resolve();
    };
    const gate = { release: finish };
    gates.add(gate);
    options.signal?.addEventListener("abort", finish, { once: true });
    if (options.signal?.aborted) finish();
    await promise;
    return !options.signal?.aborted;
  },
};
function release() { cpu.hold = false; for (const gate of [...gates]) gate.release(); }
const commits = new WeakMap<HTMLCanvasElement, number>();
let commitOrder: number[] | null = null;
const originalPut = CanvasRenderingContext2D.prototype.putImageData;
CanvasRenderingContext2D.prototype.putImageData = function (this: CanvasRenderingContext2D, ...args: [ImageData, number, number] | [ImageData, number, number, number, number, number, number]) {
  commits.set(this.canvas, (commits.get(this.canvas) ?? 0) + 1);
  if (commitOrder) commitOrder.push(Number(this.canvas.closest<HTMLElement>(".page")?.dataset.pageNumber));
  return Reflect.apply(originalPut, this, args);
};
const root = createRoot(document.getElementById("root")!);
const cases: string[] = [];
const metrics: object[] = [];
const tasks: PdfLoadingTask[] = [];
const plain = { ...DEFAULT_RECOLOR_SETTINGS };
const pixel = { ...plain, recolor: true, recolorKeephue: true };
const alternate = { ...pixel, recolorDarkcolor: "#E8C8AA", recolorLightcolor: "#10293F", recolorAdjustLightness: true };
type Configuration = { pdf: PdfDocument | null; pageNumber: number; scale: number; spread: boolean; continuousScrolling: boolean; recolorSettings: PdfRecolorSettings };
let configuration: Configuration = { pdf: null, pageNumber: 1, scale: 1, spread: false, continuousScrolling: false, recolorSettings: plain };
let geometrySignals = 0;
const emptyMatches = new Map<number, never[]>();
const ignore = () => {};
const changedPage = (pageNumber: number) => { configuration = { ...configuration, pageNumber }; draw(); };
function Harness() {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const viewerHandle = useRef<PdfViewerHandle["current"]>(null);
  return <div ref={containerRef} className="document-viewport" tabIndex={0} style={{ position: "absolute", inset: 0, overflow: "auto" }}>
    <div ref={viewerRef} className="pdfViewer" />
    <PdfViewerSurface containerRef={containerRef} viewerRef={viewerRef} viewerHandle={viewerHandle}
      {...configuration} matchesByPage={emptyMatches} activeMatch={-1} onPageChange={changedPage}
      onActiveMatchElement={ignore} onPageElements={ignore} onPageRendered={() => { geometrySignals++; }}
      onRenderError={(message) => { errors.push(message); }} />
  </div>;
}
function draw() { root.render(<Harness />); }
const settle = () => {
  const { promise, resolve } = Promise.withResolvers<void>();
  requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  return promise;
};
async function until(predicate: () => unknown, message: string) {
  const deadline = performance.now() + 12_000;
  while (!predicate()) { check(performance.now() < deadline, message); await settle(); }
  await settle();
}
async function update(patch: Partial<Configuration>) { configuration = { ...configuration, ...patch }; draw(); await settle(); }
const observed = () => window.__pdfCooperative;
const viewer = () => {
  const result = observed().viewerHandle.current;
  check(result, "PDF.js viewer is unavailable"); return result;
};
const pageView = (page = configuration.pageNumber) => viewer().getPageView(page - 1) as PageView | undefined;
const bytes = (canvas: HTMLCanvasElement) => {
  check(canvas.width > 0 && canvas.height > 0, "cannot sample released canvas");
  return canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
};
function equal(actual: Uint8ClampedArray, expected: Uint8ClampedArray, label: string) {
  check(actual.length === expected.length, `${label}: byte length changed`);
  for (let index = 0; index < actual.length; index++) {
    if (actual[index] !== expected[index]) throw new Error(`${label}: byte ${index}: ${actual[index]} !== ${expected[index]}`);
  }
}
function pair(page = configuration.pageNumber): Sample {
  const pristine = observed().map.get(page); const canvas = pageView(page)?.canvas;
  check(pristine && canvas && pristine !== canvas, `page ${page}: missing independent pristine/render canvas`);
  return { pristine, canvas, bytes: bytes(canvas), commits: commits.get(canvas) ?? 0 };
}
function pending(sample: Sample, label: string) {
  equal(bytes(sample.canvas), sample.bytes, `${label}: partial pixels published`);
  check(getComputedStyle(sample.canvas).visibility === "hidden", `${label}: stale pending canvas is visible`);
  check((commits.get(sample.canvas) ?? 0) === sample.commits, `${label}: pending task committed early`);
}
function expected(sample: Sample, settings: PdfRecolorSettings) {
  const data = bytes(sample.pristine);
  if (settings.recolor && (settings.recolorKeephue || settings.recolorReverseVideo)) {
    recolorImageDataCpu(data, sample.pristine.width, sample.pristine.height,
      parseHexColor(settings.recolorDarkcolor), parseHexColor(settings.recolorLightcolor),
      settings.recolorKeephue, settings.recolorAdjustLightness, settings.recolorReverseVideo, []);
  }
  return data;
}
function exact(page: number, settings: PdfRecolorSettings, label: string) {
  const sample = pair(page);
  equal(bytes(sample.canvas), expected(sample, settings), label);
  check(getComputedStyle(sample.canvas).visibility !== "hidden", `${label}: completed canvas remained hidden`);
}
async function idle(label: string) {
  await until(() => cpu.active === 0 && gates.size === 0 && observed().queue.size === 0 && !observed().active() && observed().timer() === undefined, `${label}: CPU/queue did not drain`);
  check(cpu.started === cpu.settled && cpu.buffers === 0, `${label}: unresolved jobs or live CPU buffers`);
  check(errors.length === 0, `${label}: asynchronous errors: ${errors.join("; ")}`);
}
async function ready(pdf: PdfDocument, page = configuration.pageNumber) {
  await until(() => {
    const current = observed()?.viewerHandle.current;
    const view = current?.getPageView(page - 1) as PageView | undefined;
    const pristine = observed()?.map.get(page);
    return current?.pdfDocument === pdf && current.currentPageNumber === page && view?.renderingState === 3 &&
      view.canvas && pristine && pristine.width === view.canvas.width && pristine.height === view.canvas.height;
  }, `real PDF.js page ${page} did not render`);
}
async function begin(settings: PdfRecolorSettings = pixel) {
  const sample = pair(); const count = cpu.started;
  cpu.hold = true;
  await update({ recolorSettings: settings });
  await until(() => gates.size > 0 && cpu.started > count, "CPU invocation never reached controlled real task yield");
  pending(sample, "held CPU"); return sample;
}
function released(retained: HTMLCanvasElement[], map: Map<number, HTMLCanvasElement>, label: string) {
  check(map.size === 0, `${label}: pristine map not empty`);
  check(retained.length > 0 && retained.every((canvas) => canvas.width === 0 && canvas.height === 0), `${label}: pristine backing stores not zeroed`);
}
async function load(name: string) {
  const task = createPdfLoadingTask(new Uint8Array(await (await fetch(`/__fixtures/${name}`)).arrayBuffer()));
  tasks.push(task); return task.promise;
}
async function command(id: ReaderCommandId) {
  const target = document.activeElement ?? document.body;
  target.dispatchEvent(new KeyboardEvent("keydown", { key: ":", code: "Semicolon", shiftKey: true, bubbles: true, cancelable: true }));
  target.dispatchEvent(new KeyboardEvent("keyup", { key: ":", code: "Semicolon", shiftKey: true, bubbles: true }));
  await until(() => document.querySelector(".command-filter"), "App palette did not open");
  const input = document.querySelector<HTMLInputElement>(".command-filter")!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, id);
  input.dispatchEvent(new Event("input", { bubbles: true })); await settle();
  const label = [...READER_COMMANDS, ...pdfAdvancedAppearanceCommands()].find((entry) => entry.id === id)!.label;
  const option = [...document.querySelectorAll<HTMLElement>('.command-list [role="option"]')].find((entry) => entry.querySelector(".command-label")?.textContent === label);
  check(option, `App command unavailable: ${id}`); option.click();
  if (id === "toggle_recolor" || id.startsWith("recolor_toggle_")) {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  }
  await until(() => !document.querySelector(".command-palette"), `${id} did not execute`);
}
async function openFile(name: string) {
  const transfer = new DataTransfer();
  transfer.items.add(new File([await (await fetch(`/__fixtures/${name}`)).arrayBuffer()], name));
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  check(input, "App file input missing"); input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true })); await settle();
}
async function run() {
  localStorage.clear();
  const long = await load("long.pdf"); const short = await load("short.pdf");
  await update({ pdf: long }); await ready(long); await idle("initial");
  equal(bytes(pair().canvas), bytes(pair().pristine), "initial original pixels");

  // A: the held task has already entered the real cooperative processor. Its
  // isolated work must never publish, even after a newer settings request lands.
  const first = await begin(); const discardedBefore = cpu.discarded;
  await update({ recolorSettings: alternate });
  await until(() => cpu.discarded > discardedBefore && gates.size > 0, "settings did not cancel and supersede held CPU work");
  pending(first, "A supersession"); release(); await idle("A"); exact(1, alternate, "A latest settings exact bytes");
  const completedBeforeClose = observed().completedSource;
  check(completedBeforeClose(first.canvas) === first.pristine, "A completed recolor did not retain the expected pristine metadata");
  cases.push("A settings supersession transactional exact pixels");

  await update({ recolorSettings: plain }); await idle("plain before B");
  const disabled = await begin(); await update({ recolorSettings: plain }); release(); await idle("B");
  equal(bytes(disabled.canvas), bytes(disabled.pristine), "B disabling restores exact pristine bytes");
  check(getComputedStyle(disabled.canvas).visibility !== "hidden", "B disabling left canvas hidden");
  cases.push("B disable cancels and restores");
  // Retain the old target as PDF.js or a consumer can, then let real navigation
  // evict its page. The source is no longer owned by the pristine map, so resetting
  // only that map cannot release a completed metadata edge from this live target.
  for (let pageNumber = 2; pageNumber <= 12; pageNumber++) {
    await update({ pageNumber }); await ready(long, pageNumber); await idle(`C cache eviction page ${pageNumber}`);
  }
  check(!observed().map.has(1), "C real twelve-page navigation did not prune the first pristine source");
  check(first.pristine.width > 0 && first.pristine.height > 0, "C pruned source no longer has the backing required to exercise retention");
  check(completedBeforeClose(first.canvas) === first.pristine, "C retained target lost completed source metadata before document teardown");

  const closed = await begin(); let retained = [...observed().map.values()]; let oldMap = observed().map;
  await update({ pdf: null }); release(); await idle("C");
  check(viewer().pdfDocument === null, "C close resurrected document"); released(retained, oldMap, "C close");
  check((commits.get(closed.canvas) ?? 0) === closed.commits, "C closed target received a late commit");
  check(completedBeforeClose(first.canvas) === undefined, "C close retained a completed pristine edge from an evicted live target");
  metrics.push({ evictedCompletedSource: true, retainedTargetMetadataClearedOnClose: true });
  cases.push("C close cancels and zeros");

  await update({ pdf: long, pageNumber: 1, recolorSettings: plain }); await ready(long); await idle("D original");
  const replaced = await begin(); retained = [...observed().map.values()];
  const replacedCommits = commits.get(replaced.canvas) ?? 0;
  await update({ pdf: short }); release(); await ready(short); await idle("D");
  check(retained.every((canvas) => !canvas.width && !canvas.height), "D replacement retained old pristine storage");
  check((commits.get(replaced.canvas) ?? 0) === replacedCommits, "D obsolete target received a late CPU commit");
  exact(1, pixel, "D short replacement exact output"); cases.push("D replacement rejects old target");

  await update({ recolorSettings: plain }); await idle("F plain");
  const zoomed = await begin(); const zoomCommits = commits.get(zoomed.canvas) ?? 0;
  const geometryBefore = geometrySignals;
  await update({ scale: 1.25 });
  await ready(short);
  check((commits.get(zoomed.canvas) ?? 0) === zoomCommits, "F resized old target received a late commit");
  check(geometrySignals > geometryBefore, "F geometry callbacks stalled behind CPU work");
  release(); await idle("F zoom");
  exact(1, pixel, "F zoom exact output");
  cases.push("F zoom and production viewport resize invalidate stale dimensions");

  await update({ pdf: long, pageNumber: 1, scale: 1, recolorSettings: plain }); await ready(long); await idle("G initial");
  const navigated = await begin(); const navigationDiscards = cpu.discarded;
  await update({ pageNumber: 7 }); await ready(long, 7);
  await until(() => cpu.discarded > navigationDiscards, "G navigation did not cancel old visible-page work");
  check((commits.get(navigated.canvas) ?? 0) === navigated.commits, "G navigated-away target received late output");
  await update({ pageNumber: 1 }); await ready(long, 1); release(); await idle("G");
  exact(1, pixel, "G navigation back exact output"); cases.push("G navigation away and back");

  await update({ recolorSettings: plain }); await idle("H plain");
  await begin();
  for (let index = 0; index < 12; index++) {
    await update({ recolorSettings: index % 2 ? alternate : { ...pixel, recolorReverseVideo: true } });
    check(cpu.active <= 1 && cpu.buffers <= 1, "H incompatible settings overlapped CPU buffers");
    check(observed().queue.size <= observed().map.size, "H obsolete requests accumulated beyond cached pages");
  }
  await update({ recolorSettings: alternate }); release(); await idle("H"); exact(1, alternate, "H final exact output");
  cases.push("H repeated incompatible settings remain bounded");

  await update({ recolorSettings: plain }); await idle("I plain");
  for (let pageNumber = 2; pageNumber <= 6; pageNumber++) { await update({ pageNumber }); await ready(long, pageNumber); }
  await update({ pageNumber: 1 }); await ready(long, 1); await idle("I cached");
  check(observed().map.size >= 4, "I fixture did not retain several real cached pages");
  const cached = [...observed().map.keys()]; const visible = configuration.pageNumber;
  await begin();
  const queueMax = observed().queue.size;
  check(queueMax >= 2 && queueMax <= cached.length, "I cached pages were not a bounded pending queue");
  for (let index = 0; index < 5; index++) await update({ recolorSettings: index % 2 ? pixel : alternate });
  await update({ recolorSettings: alternate });
  check(observed().queue.size <= cached.length && cpu.active === 1 && cpu.buffers === 1, "I latest-wins queue or single active buffer violated");
  commitOrder = [];
  release(); await idle("I");
  check(commitOrder[0] === visible, "I cached work published before the visible page");
  exact(visible, alternate, "I visible page exact latest output");
  const completedPair = pair(visible);
  check(observed().completedSource(completedPair.canvas) === completedPair.pristine, "I finished recolor metadata does not identify its source");
  for (const page of cached) if (observed().map.has(page) && pageView(page)?.canvas?.width) exact(page, alternate, `I cached page ${page}`);
  metrics.push({ cachedPages: cached.length, queueMax, commitOrder }); commitOrder = null;
  cases.push("I cached pages bounded latest queue and exact output");

  await update({ recolorSettings: plain }); await idle("J plain"); const unmountedSample = await begin();
  retained = [...observed().map.values()]; oldMap = observed().map; const oldViewer = observed().viewerHandle;
  const completedBeforeUnmount = observed().completedSource;
  check(completedBeforeUnmount(unmountedSample.canvas) === unmountedSample.pristine, "J live target has no completed source metadata to release");
  root.render(null); await settle(); release();
  await until(() => cpu.active === 0 && gates.size === 0, "J unmount left CPU pending");
  check(oldViewer.current === null, "J unmount retained viewer"); released(retained, oldMap, "J unmount");
  check((commits.get(unmountedSample.canvas) ?? 0) === unmountedSample.commits, "J unmounted target received a late commit");
  check(completedBeforeUnmount(unmountedSample.canvas) === undefined, "J unmount retained a completed pristine edge from a live target");
  metrics.push({ retainedTargetMetadataClearedOnUnmount: true });
  check(cpu.started === cpu.settled && cpu.buffers === 0, "J unmount leaked CPU jobs"); cases.push("J pending unmount settles and releases");

  await update({ pdf: short, pageNumber: 1, scale: 1, recolorSettings: pixel }); await ready(short); await idle("K");
  exact(1, pixel, "K reopen exact recolor");
  await update({ recolorSettings: plain }); await idle("K restore"); exact(1, plain, "K reopen pristine restore");
  cases.push("K reopen correct pixels");
  retained = [...observed().map.values()]; oldMap = observed().map;
  await update({ pdf: null }); await idle("L"); released(retained, oldMap, "L close");
  await update({ pdf: null }); check(observed().map.size === 0, "L repeated close revived map");
  cases.push("L H02B1 map zeroing retained");
  root.render(null); await settle();

  // E exercises actual App/PdfReader load-failure retention while CPU is pending,
  // not a simulated failed Surface prop update or a mocked PDF loading result.
  root.render(<App />); await until(() => document.querySelector('input[type="file"]'), "App did not mount");
  await openFile("long.pdf");
  await until(() => observed()?.pdf?.numPages === 12 && observed().map.has(1), "App valid PDF did not render");
  const appPdf = observed().pdf!; await ready(appPdf, 1); await idle("E App initial");
  const layout = () => document.querySelector<HTMLElement>(".reader-layout")!;
  if (layout().dataset.recolor === "true") await command("toggle_recolor");
  await idle("E App plain"); const appSample = pair(1); const appPristine = appSample.pristine;
  cpu.hold = true;
  await command("toggle_recolor"); await command("recolor_toggle_keephue");
  await until(() => gates.size > 0, "E App did not enter CPU gate"); pending(appSample, "E App held");
  await openFile("corrupt.pdf");
  await until(() => document.querySelector('[role="alert"]')?.textContent?.match(/valid PDF|Invalid PDF/i), "E invalid replacement did not report real error");
  check(observed().pdf === appPdf && viewer().pdfDocument === appPdf && observed().map.get(1) === appPristine, "E invalid replacement discarded committed reader/pristine");
  pending(appSample, "E invalid replacement pending"); release(); await idle("E");
  const appSettings = { ...pixel };
  exact(1, appSettings, "E valid reader finishes exact recolor after invalid replacement");
  document.querySelector<HTMLButtonElement>('[role="alert"] button')!.click(); await settle();
  // The actual reader's ResizeObserver, fit-page calculation and Surface scale
  // update must invalidate pending work when the available viewport changes.
  const beforeResize = pair(1); const oldWidth = beforeResize.canvas.width;
  const oldHeight = beforeResize.canvas.height;
  cpu.hold = true; await command("recolor_toggle_adjust_lightness");
  await until(() => gates.size > 0, "F production resize did not start pending CPU work");
  pending(beforeResize, "F before production resize");
  const resizeCommits = commits.get(beforeResize.canvas) ?? 0;
  document.querySelector<HTMLElement>(".document-viewport")!.style.width = "360px";
  await until(() => {
    const canvas = pageView(1)?.canvas;
    return canvas && (canvas.width !== oldWidth || canvas.height !== oldHeight) && pageView(1)?.renderingState === 3;
  }, "F actual reader viewport resize did not cause real PDF.js rerender");
  await ready(appPdf, 1);
  check((commits.get(beforeResize.canvas) ?? 0) === resizeCommits, "F production resize published obsolete CPU target");
  release(); await idle("F production resize");
  appSettings.recolorAdjustLightness = true;
  exact(1, appSettings, "F production viewport resize exact output");
  metrics.push({ resizeFrom: [oldWidth, oldHeight], resizeTo: [pair(1).canvas.width, pair(1).canvas.height] });
  await command("next_page"); await ready(appPdf, 2); await idle("E navigation");
  exact(2, appSettings, "E retained reader navigation exact pixels");
  cases.push("E invalid replacement preserves active real App reader");
  retained = [...observed().map.values()]; oldMap = observed().map;
  await command("close_document"); await idle("App close"); released(retained, oldMap, "App close");
  root.unmount(); await Promise.all(tasks.map((task) => task.destroy()));
  check(cpu.started > 20 && cpu.yields > 0, "forced cooperative CPU path was not exercised");
  check(cpu.maxActive === 1 && cpu.maxBuffers === 1 && cpu.started === cpu.settled && !cpu.buffers && !gates.size, "final bounded task/buffer accounting violated");
  check(errors.length === 0, `unhandled runtime failures: ${errors.join("; ")}`);
  CanvasRenderingContext2D.prototype.putImageData = originalPut;
  return { passed: true, cases, metrics, cpu: { started: cpu.started, settled: cpu.settled, completed: cpu.completed, discarded: cpu.discarded, yields: cpu.yields, maxActive: cpu.maxActive, maxBuffers: cpu.maxBuffers, buffers: cpu.buffers, pendingGates: gates.size }, errors };
}
run().then((result) => window.webkit.messageHandlers.test.postMessage(JSON.stringify(result))).catch((error: unknown) => {
  release(); root.unmount();
  window.webkit.messageHandlers.test.postMessage(JSON.stringify({ passed: false, cases, metrics, errors,
    cpu: { started: cpu.started, settled: cpu.settled, active: cpu.active, buffers: cpu.buffers, gates: gates.size },
    error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined }));
});
