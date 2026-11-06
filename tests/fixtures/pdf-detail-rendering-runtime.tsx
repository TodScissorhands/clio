import { useRef } from "react";
import type { CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import App from "../../src/App";
import { PdfViewerSurface } from "../../src/pdf/PdfViewerSurface";
import type { PdfViewerHandle } from "../../src/pdf/PdfViewerSurface";
import { createPdfLoadingTask } from "../../src/pdf/engine";
import type { PdfDocument, PdfLoadingTask } from "../../src/pdf/engine";
import { computeSvgColorMatrix, DEFAULT_RECOLOR_SETTINGS, parseHexColor, recolorImageDataCpu, RECOLOR_PRESETS } from "../../src/pdf/recolor";
import type { CpuRecolorOptions, PdfRecolorSettings } from "../../src/pdf/recolor";
import { READER_COMMANDS } from "../../src/reader/interactions";
import { pdfAdvancedAppearanceCommands } from "../../src/reader/appearanceCommands";
import type { ReaderCommandId } from "../../src/reader/interactions";
import "../../src/index.css";
import "../../src/reader/Reader.css";

type Owner = { canvas?: HTMLCanvasElement; renderingState: number };
type Page = Owner & { detailView?: Owner | null; viewport: { width: number; height: number } };
type Observation = {
  map: Map<number, HTMLCanvasElement>;
  details: Map<number, { canvas: HTMLCanvasElement; pristine: HTMLCanvasElement }>;
  viewerHandle: PdfViewerHandle; pdf: PdfDocument | null;
  queue: Map<unknown, unknown>; active: () => unknown; timer: () => number | undefined;
};
type CpuProbe = {
  hold: boolean; started: number; settled: number; active: number; maxActive: number;
  buffers: number; maxBuffers: number; discarded: number; yields: number; gpuReady: boolean; gpuDraws: number;
  invoke: (operation: () => Promise<boolean>) => Promise<boolean>;
  yield: (options: CpuRecolorOptions, operation: () => Promise<boolean>) => Promise<boolean>;
};
declare global {
  interface Window {
    __pdfDetail: Observation; __detailCpu: CpuProbe;
    __detailSnapshot: (payload: { id: number; pixels?: number[][]; error?: string }) => void;
    webkit: { messageHandlers: { test: { postMessage: (value: string) => void } } };
  }
}
const check: (value: unknown, message: string) => asserts value = (value, message) => { if (!value) throw new Error(message); };
const errors: string[] = [];
const cases: string[] = [];
const metrics: object[] = [];
window.addEventListener("error", (event) => errors.push(event.message));
window.addEventListener("unhandledrejection", (event) => errors.push(String(event.reason)));
const backend = new URLSearchParams(location.search).get("backend");
const gates = new Set<() => void>();
const cpu: CpuProbe = window.__detailCpu = {
  hold: false, started: 0, settled: 0, active: 0, maxActive: 0, buffers: 0, maxBuffers: 0,
  discarded: 0, yields: 0, gpuReady: false, gpuDraws: 0,
  async invoke(operation) {
    this.started++; this.active++; this.maxActive = Math.max(this.maxActive, this.active);
    try { const complete = await operation(); if (!complete) this.discarded++; return complete; }
    finally { this.active--; this.settled++; }
  },
  async yield(options, operation) {
    // Always execute the production MessageChannel task before the test gate.
    // Abort also opens a held gate, so a cancelled job cannot deadlock the queue.
    this.yields++;
    const resumed = await operation();
    if (!resumed || !this.hold || options.signal?.aborted) return resumed;
    const { promise, resolve } = Promise.withResolvers<void>();
    const finish = () => { gates.delete(finish); options.signal?.removeEventListener("abort", finish); resolve(); };
    gates.add(finish); options.signal?.addEventListener("abort", finish, { once: true });
    if (options.signal?.aborted) finish();
    await promise;
    return !options.signal?.aborted;
  },
};
function release() { cpu.hold = false; for (const finish of [...gates]) finish(); }
const commits = new WeakMap<HTMLCanvasElement, number>();
const originalPut = CanvasRenderingContext2D.prototype.putImageData;
CanvasRenderingContext2D.prototype.putImageData = function (...args: [ImageData, number, number] | [ImageData, number, number, number, number, number, number]) {
  commits.set(this.canvas, (commits.get(this.canvas) ?? 0) + 1);
  return Reflect.apply(originalPut, this, args);
};
const root = createRoot(document.getElementById("root")!);
const tasks: PdfLoadingTask[] = [];
const plain = { ...DEFAULT_RECOLOR_SETTINGS };
const gruvbox = RECOLOR_PRESETS["gruvbox-dark"];
const svg: PdfRecolorSettings = { ...plain, recolor: true, activePreset: "gruvbox-dark", recolorLightcolor: gruvbox.lightColor, recolorDarkcolor: gruvbox.darkColor };
const pixel = { ...svg, recolorKeephue: true, recolorReverseVideo: true };
const alternate = { ...pixel, recolorLightcolor: "#10293F", recolorDarkcolor: "#E8C8AA", recolorAdjustLightness: true };
type Configuration = { pdf: PdfDocument | null; pageNumber: number; scale: number; spread: boolean; continuousScrolling: boolean; recolorSettings: PdfRecolorSettings };
let configuration: Configuration = { pdf: null, pageNumber: 1, scale: .6, spread: false, continuousScrolling: false, recolorSettings: plain };
const emptyMatches = new Map<number, never[]>();
const ignore = () => {};
let renderSignals = 0;
const changedPage = (pageNumber: number) => { configuration = { ...configuration, pageNumber }; draw(); };
function Harness() {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const viewerHandle = useRef<PdfViewerHandle["current"]>(null);
  const settings = configuration.recolorSettings;
  return <>
    <svg aria-hidden="true" style={{ position: "absolute", width: 0, height: 0 }}><defs>
      <filter id="clio-recolor-matrix" colorInterpolationFilters="sRGB"><feColorMatrix type="matrix" values={computeSvgColorMatrix(settings.recolorLightcolor, settings.recolorDarkcolor)} /></filter>
    </defs></svg>
    <div className="reader-layout" data-recolor={String(settings.recolor)} data-recolor-mode={settings.recolorKeephue || settings.recolorReverseVideo ? "pixel" : "svg"}
      style={{ position: "absolute", inset: 0, height: "100%", "--recolor-light-color": settings.recolorLightcolor } as CSSProperties}>
      <div ref={containerRef} className="document-viewport" tabIndex={0}>
        <div ref={viewerRef} className="pdfViewer" />
        <PdfViewerSurface containerRef={containerRef} viewerRef={viewerRef} viewerHandle={viewerHandle} {...configuration}
          matchesByPage={emptyMatches} activeMatch={-1} onPageChange={changedPage} onActiveMatchElement={ignore} onPageElements={ignore}
          onPageRendered={() => { renderSignals++; }} onRenderError={(message) => errors.push(message)} />
      </div>
    </div>
  </>;
}
function draw() { root.render(<Harness />); }
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
async function update(patch: Partial<Configuration>) { configuration = { ...configuration, ...patch }; draw(); await settle(); }
const observed = () => window.__pdfDetail;
const viewer = () => { const value = observed().viewerHandle.current; check(value, "viewer is unavailable"); return value; };
const pageView = (page = viewer().currentPageNumber) => viewer().getPageView(page - 1) as Page | undefined;
const visible = (canvas: HTMLCanvasElement) => getComputedStyle(canvas).visibility !== "hidden";
async function idle(label: string) {
  await until(() => !cpu.active && !gates.size && !observed().queue.size && !observed().active() && observed().timer() === undefined, `${label}: shared queue did not drain`);
  check(!cpu.buffers && cpu.started === cpu.settled, `${label}: CPU work/buffer leaked`);
  check(errors.length === 0, `${label}: ${errors.join("; ")}`);
}
async function ready(pdf: PdfDocument, page = configuration.pageNumber) {
  try {
    await until(() => {
      const view = observed()?.viewerHandle.current?.getPageView(page - 1) as Page | undefined;
      const source = observed()?.map.get(page);
      return observed()?.viewerHandle.current?.pdfDocument === pdf && viewer().currentPageNumber === page && view?.renderingState === 3 &&
        view.canvas && source && source.width === view.canvas.width && source.height === view.canvas.height;
    }, `real page ${page} did not finish`);
  } catch (error) {
    const view = pageView(page);
    throw new Error(`${String(error)}: ${JSON.stringify({ requested: page, configured: configuration.pageNumber,
      current: viewer().currentPageNumber, state: view?.renderingState, main: [view?.canvas?.width, view?.canvas?.height],
      source: [observed().map.get(page)?.width, observed().map.get(page)?.height],
      scroll: [viewer().container.scrollLeft, viewer().container.scrollTop], spread: viewer().spreadMode, mode: viewer().scrollMode })}`);
  }
}
async function detailReady(label: string) {
  await until(() => {
    const detail = pageView()?.detailView;
    return detail?.renderingState === 3 && detail.canvas?.isConnected && detail.canvas.width > 0;
  }, `${label}: PDF.js did not create/finish a genuine detail canvas`);
  await idle(label);
  const detail = pageView()!.detailView!;
  if (configuration.recolorSettings.recolor && (configuration.recolorSettings.recolorKeephue || configuration.recolorSettings.recolorReverseVideo)) {
    // Assert consumer pixels before inspecting new lifecycle observations: the
    // unfixed baseline must fail for its white detail, not a missing map ref.
    pixels(configuration.recolorSettings, label);
    const pair = observed().details.get(viewer().currentPageNumber);
    check(pair?.canvas === detail.canvas && pair.pristine !== detail.canvas && pair.pristine !== observed().map.get(viewer().currentPageNumber), `${label}: detail lacks its own current, independent source`);
    check(pair.pristine.width === pair.canvas.width && pair.pristine.height === pair.canvas.height, `${label}: detail source is not crop-sized`);
    const [u, v] = local(pair.canvas, .26, .08);
    near(at(pair.pristine, u!, v!), [255, 255, 255], `${label}: detail source captured processed/main pixels`);
  }
  return detail;
}
function data(canvas: HTMLCanvasElement) {
  check(canvas.width > 0 && canvas.height > 0, "sampling released canvas");
  return canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
}
function equalBytes(left: Uint8ClampedArray, right: Uint8ClampedArray, label: string) {
  check(left.length === right.length, `${label}: dimensions changed`);
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) throw new Error(`${label}: changed byte ${i}`);
  }
}
function near(actual: ArrayLike<number>, expected: ArrayLike<number>, label: string, tolerance = 2) {
  for (let i = 0; i < 3; i++) check(Math.abs(actual[i]! - expected[i]!) <= tolerance, `${label}: ${Array.from(actual)} != ${Array.from(expected)}`);
}
function at(canvas: HTMLCanvasElement, u: number, v: number) {
  return canvas.getContext("2d")!.getImageData(Math.min(canvas.width - 1, Math.floor(u * canvas.width)), Math.min(canvas.height - 1, Math.floor(v * canvas.height)), 1, 1).data;
}
// Independent full-page -> crop coordinate reference, from PDF.js public DOM
// percentage placement, not production remapping helpers or copied map contents.
function local(canvas: HTMLCanvasElement, u: number, v: number) {
  if (canvas === pageView()!.canvas) return [u, v];
  const minX = parseFloat(canvas.style.left) / 100, minY = parseFloat(canvas.style.top) / 100;
  return [(u - minX) / (parseFloat(canvas.style.width) / 100), (v - minY) / (parseFloat(canvas.style.height) / 100)];
}
function samplePage(canvas: HTMLCanvasElement, u: number, v: number) {
  const [x, y] = local(canvas, u, v);
  check(x! > 0 && x! < 1 && y! > 0 && y! < 1,
    `reference sample outside detail crop: ${JSON.stringify({ u, v, x, y, style: canvas.getAttribute("style"), width: canvas.width, height: canvas.height })}`);
  return at(canvas, x!, y!);
}
function pixels(settings: PdfRecolorSettings, label: string) {
  const page = pageView()!;
  const canvases = [page.canvas!, ...(page.detailView?.canvas ? [page.detailView.canvas] : [])];
  const expectedBackground = settings.recolor ? parseHexColor(settings.recolorLightcolor).map((channel) => Math.round(channel * 255)) : [255, 255, 255];
  for (const canvas of canvases) {
    check(visible(canvas), `${label}: finished output is hidden`);
    near(samplePage(canvas, .26, .08), expectedBackground, `${label}: actual ${canvas === page.canvas ? "main" : "detail"} background`);
    if (settings.recolorReverseVideo) near(samplePage(canvas, .17, .20), [224, 32, 16], `${label}: embedded image was recolored`);
    if (settings.recolor) {
      const reference = new Uint8ClampedArray([51, 89, 153, 255]);
      recolorImageDataCpu(reference, 1, 1, parseHexColor(settings.recolorDarkcolor), parseHexColor(settings.recolorLightcolor), settings.recolorKeephue, settings.recolorAdjustLightness, settings.recolorReverseVideo, []);
      near(samplePage(canvas, .28, .20), reference, `${label}: vector artwork incorrectly preserved`, 3);
    }
  }
}
let snapshotId = 0;
const snapshots = new Map<number, { resolve: (pixels: number[][]) => void; reject: (error: Error) => void }>();
window.__detailSnapshot = (payload) => {
  const pending = snapshots.get(payload.id); check(pending, "unknown compositor snapshot response"); snapshots.delete(payload.id);
  if (payload.error) pending.reject(new Error(payload.error)); else pending.resolve(payload.pixels!);
};
async function snapshotBackground(canvas: HTMLCanvasElement, expected: number[], label: string) {
  const [u, v] = local(canvas, .26, .08);
  const rect = canvas.getBoundingClientRect();
  const point = [rect.left + rect.width * u!, rect.top + rect.height * v!];
  check(point[0]! > 0 && point[0]! < innerWidth && point[1]! > 0 && point[1]! < innerHeight, `${label}: compositor reference is offscreen`);
  await settle();
  const { promise, resolve, reject } = Promise.withResolvers<number[][]>();
  const id = ++snapshotId; snapshots.set(id, { resolve, reject });
  window.webkit.messageHandlers.test.postMessage(JSON.stringify({ snapshot: id, points: [point], width: innerWidth, height: innerHeight }));
  const pixels = await promise;
  near(pixels[0]!, expected, `${label}: compositor pixels`, 3);
  metrics.push({ label, compositor: pixels[0] });
}
function retained() {
  const sources = [...observed().map.values(), ...[...observed().details.values()].map((entry) => entry.pristine)];
  const owned = new Set<HTMLCanvasElement>();
  for (let page = 0; page < viewer().pagesCount; page++) {
    const view = viewer().getPageView(page) as Page;
    if (view.canvas) owned.add(view.canvas);
    if (view.detailView?.canvas) owned.add(view.detailView.canvas);
  }
  check(sources.every((canvas) => !owned.has(canvas)), "private cleanup source aliases a PDF.js-owned output");
  return sources;
}
function released(canvases: HTMLCanvasElement[], observation: Observation, label: string) {
  check(!observation.map.size && !observation.details.size, `${label}: independent source maps retained entries`);
  check(canvases.length > 0 && canvases.every((canvas) => !canvas.width && !canvas.height), `${label}: independent backing stores were not zeroed`);
}
async function load(name: string) {
  const task = createPdfLoadingTask(new Uint8Array(await (await fetch(`/__fixtures/${name}`)).arrayBuffer()));
  tasks.push(task); return task.promise;
}
function dispatch(source: object, pageNumber = 1) { viewer().eventBus.dispatch("pagerendered", { source, pageNumber, cssTransform: false, timestamp: performance.now(), error: null }); }
const premature: string[] = [];
let watchInsertions = false;
const mutation = new MutationObserver((records) => {
  if (!watchInsertions) return;
  for (const record of records) for (const node of record.addedNodes) {
    if (!(node instanceof HTMLCanvasElement) || !node.closest(".canvasWrapper")) continue;
    if (!visible(node)) continue;
    // A synchronous GPU commit may precede MutationObserver delivery. Visible
    // *current recolored* output is safe; visible raw/obsolete output is not.
    const view = pageView();
    if (node !== view?.canvas && node !== view?.detailView?.canvas) {
      premature.push("obsolete native canvas became visible");
      continue;
    }
    try {
      const background = parseHexColor(configuration.recolorSettings.recolorLightcolor).map((channel) => Math.round(channel * 255));
      near(samplePage(node, .26, .08), background, "new visible native canvas has raw/obsolete pixels");
    } catch (error) {
      premature.push(error instanceof Error ? error.message : String(error));
    }
  }
});
mutation.observe(document.getElementById("root")!, { childList: true, subtree: true });
async function hold(settings: PdfRecolorSettings) {
  const count = cpu.started; cpu.hold = true;
  await update({ recolorSettings: settings });
  await until(() => cpu.started > count && gates.size > 0, "real CPU task never reached its native MessageChannel yield");
}
async function key(key: string, init: KeyboardEventInit = {}) {
  const target = document.activeElement ?? document.body;
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
  target.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true, ...init })); await settle();
}
async function command(id: ReaderCommandId) {
  await key(":", { shiftKey: true, code: "Semicolon" });
  await until(() => document.querySelector(".command-filter"), "App palette did not open");
  const input = document.querySelector<HTMLInputElement>(".command-filter")!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, id);
  input.dispatchEvent(new Event("input", { bubbles: true })); await settle();
  const label = [...READER_COMMANDS, ...pdfAdvancedAppearanceCommands()].find((entry) => entry.id === id)!.label;
  const option = [...document.querySelectorAll<HTMLElement>('.command-list [role="option"]')].find((entry) => entry.querySelector(".command-label")?.textContent === label);
  check(option, `App command unavailable: ${id}`); option.click();
  if (id === "toggle_recolor" || id.startsWith("recolor_toggle_")) await key("Escape");
  await until(() => !document.querySelector(".command-palette"), `App command did not execute: ${id}`);
}
async function openFile(name: string) {
  const transfer = new DataTransfer(); transfer.items.add(new File([await (await fetch(`/__fixtures/${name}`)).arrayBuffer()], name));
  const input = document.querySelector<HTMLInputElement>('input[type="file"]'); check(input, "App file input missing");
  input.files = transfer.files; input.dispatchEvent(new Event("change", { bubbles: true })); await settle();
}
async function run() {
  localStorage.clear();
  const long = await load("long.pdf"), short = await load("short.pdf");
  await update({ pdf: long }); await ready(long); await idle("normal Original");
  check(!pageView()!.detailView, "bounded normal scale unexpectedly needed a detail canvas");
  pixels(plain, "A normal Original");
  await snapshotBackground(pageView()!.canvas!, [255, 255, 255], "A normal Original");
  await update({ recolorSettings: svg }); await idle("normal SVG");
  near(samplePage(pageView()!.canvas!, .26, .08), [255, 255, 255], "SVG must not destructively edit source pixels");
  await snapshotBackground(pageView()!.canvas!, [40, 40, 40], "A normal SVG Gruvbox");
  await update({ recolorSettings: pixel }); await idle("normal pixel"); pixels(pixel, "A normal pixel Gruvbox");
  cases.push("A Original/SVG/pixel normal consumer pixels");

  watchInsertions = true;
  await update({ scale: 2 }); await ready(long); let detail = await detailReady("B high zoom");
  pixels(pixel, "B high zoom");
  await snapshotBackground(detail.canvas!, [40, 40, 40], "B cropped pixel Gruvbox");
  const mainResolution = pageView()!.canvas!;
  const mainRect = mainResolution.getBoundingClientRect(), detailRect = detail.canvas!.getBoundingClientRect();
  check(detail.canvas!.width / detailRect.width > mainResolution.width / mainRect.width &&
    detail.canvas!.height / detailRect.height > mainResolution.height / mainRect.height,
  "high-zoom detail lost its sharper native rendering resolution");
  check(premature.length === 0, premature.join("; "));
  watchInsertions = false;
  cases.push("B actual restricted main/full-resolution cropped detail and insertion guard");

  await update({ recolorSettings: svg }); await idle("C SVG detail");
  near(samplePage(detail.canvas!, .26, .08), [255, 255, 255], "C SVG did not restore raw detail pixels");
  await snapshotBackground(detail.canvas!, [40, 40, 40], "C cropped SVG Gruvbox");
  await update({ recolorSettings: plain }); await idle("C Original detail"); pixels(plain, "C Original detail");
  await snapshotBackground(detail.canvas!, [255, 255, 255], "C cropped Original");
  await update({ recolorSettings: pixel }); await idle("C pixel detail"); pixels(pixel, "C reverse video image preservation");
  cases.push("C compositor SVG versus pixel plus cropped image retention");

  for (const scale of [2.2, 1.8, 2]) {
    const old = detail.canvas!, source = observed().details.get(1)!.pristine;
    watchInsertions = true; await update({ scale }); await ready(long);
    detail = await detailReady(`D zoom ${scale}`); watchInsertions = false;
    check(detail.canvas !== old, "D zoom reused obsolete detail backing");
    check(!source.width && !source.height, "D replaced detail pristine backing was not released");
    check(premature.length === 0, premature.join("; ")); pixels(pixel, `D zoom ${scale}`);
  }
  cases.push("D repeated native detail replacement releases old sources");

  if (backend === "cpu") {
    const main = pageView()!.canvas!, crop = detail.canvas!;
    const before = [data(main), data(crop)];
    const beforeCommits = [commits.get(main) ?? 0, commits.get(crop) ?? 0];
    await hold(alternate);
    for (const [index, canvas] of [main, crop].entries()) {
      check(!visible(canvas), "E held main/detail was visible"); equalBytes(data(canvas), before[index]!, "E no partial publication");
      check((commits.get(canvas) ?? 0) === beforeCommits[index], "E held recolor committed partial data");
    }
    const discarded = cpu.discarded;
    const latest = { ...pixel, recolorLightcolor: "#30302A" };
    await update({ recolorSettings: latest });
    await until(() => cpu.discarded > discarded && gates.size > 0, "E rapid appearance did not supersede actual held CPU task");
    equalBytes(data(crop), before[1]!, "E stale cropped task published");
    release(); await idle("E supersession"); pixels(latest, "E latest appearance");

    await hold(alternate); const obsolete = detail.canvas!, obsoleteCommits = commits.get(obsolete) ?? 0;
    await update({ scale: 2.1 }); await ready(long);
    release(); detail = await detailReady("E held zoom replacement");
    check(detail.canvas !== obsolete && (commits.get(obsolete) ?? 0) === obsoleteCommits, "E cancelled detail received a late commit");
    pixels(alternate, "E replacement latest pixels");
    cases.push("E native MessageChannel CPU yields, transactional supersession, zoom cancellation");
  }

  const oldPage = pageView()!, oldDetail = detail, oldCanvas = detail.canvas!;
  const oldSource = observed().details.get(1)!.pristine;
  await update({ pageNumber: 2 }); await ready(long, 2); await detailReady("F page 2");
  pixels(configuration.recolorSettings, "F page 2");
  await update({ pageNumber: 1 }); await ready(long, 1); await detailReady("F page 1 return");
  pixels(configuration.recolorSettings, "F cached page return");
  for (let pageNumber = 2; pageNumber <= 12; pageNumber++) { await update({ pageNumber }); await ready(long, pageNumber); await detailReady(`F cache ${pageNumber}`); }
  check(!observed().map.has(1) && !observed().details.has(1), "F real PDF.js cache eviction retained page 1 resources");
  check(!oldSource.width && !oldSource.height, "F evicted detail retained independent backing");
  cases.push("F page navigation, cached return and real cache eviction");

  // Real UI commands commit navigation, spread and scrolling separately. A
  // batched jump from page 12 plus both layout changes lets PDF.js's interim
  // pagechanging signal replace this fixture's requested page before it renders.
  await update({ pageNumber: 1 }); await ready(long, 1); await detailReady("G return before layout");
  await update({ spread: true }); await ready(long, 1); await detailReady("G paged spread");
  pixels(configuration.recolorSettings, "G paged spread");
  await update({ continuousScrolling: true }); await ready(long, 1);
  await until(() => viewer().spreadMode === 1 && viewer().scrollMode === 0 && document.querySelector(".pdfViewer .spread"), "G spread/continuous did not reach real viewer");
  await detailReady("G spread continuous"); pixels(configuration.recolorSettings, "G spread continuous");
  await update({ continuousScrolling: false }); await ready(long, 1); await detailReady("G paged spread return");
  await update({ spread: false }); await ready(long, 1); await detailReady("G single");
  check(viewer().spreadMode === 0 && viewer().scrollMode === 3, "G single/paged did not restore");
  cases.push("G single/spread/continuous real rendering");

  const staleSignals = renderSignals, staleMap = observed().details.get(1);
  // The genuine owner is stale only after its document is replaced below.
  let sources = retained(), observation = observed();
  if (backend === "cpu") await hold(configuration.recolorSettings === pixel ? alternate : pixel);
  await update({ pdf: short, pageNumber: 1 }); release(); await ready(short); detail = await detailReady("H short replacement");
  check(sources.every((canvas) => !canvas.width && !canvas.height), "H PDF replacement retained old independent backing stores");
  const replacementSignals = renderSignals, currentDetail = observed().details.get(1), currentBytes = data(detail.canvas!);
  dispatch(oldPage); dispatch(oldDetail); dispatch(oldPage, 12); await idle("H stale render events");
  check(renderSignals === replacementSignals && observed().details.get(1) === currentDetail, "H stale real owners reached consumers or replaced detail source");
  equalBytes(data(detail.canvas!), currentBytes, "H stale owner corrupted pixels");
  check(staleSignals > 0 && staleMap && oldCanvas !== detail.canvas, "H stale test did not retain actual prior owners");
  pixels(configuration.recolorSettings, "H PDF replacement");
  cases.push("H document replacement, stale genuine main/detail events and cancellation");

  sources = retained(); observation = observed();
  if (backend === "cpu") await hold(configuration.recolorSettings === pixel ? alternate : pixel);
  await update({ pdf: null }); release(); await idle("I close");
  check(viewer().pdfDocument === null, "I close resurrected PDF"); released(sources, observation, "I close");
  await update({ pdf: short, recolorSettings: pixel }); await ready(short); await detailReady("I reopen"); pixels(pixel, "I reopen");
  sources = retained(); observation = observed();
  root.render(null); await settle(); release();
  await until(() => !cpu.active && !cpu.buffers && !gates.size, "I unmount left CPU resources");
  check(observation.viewerHandle.current === null, "I unmount retained viewer"); released(sources, observation, "I unmount");
  cases.push("I close/reopen/unmount clear every independent source without aliasing PDF.js targets");

  // The real App acquisition boundary, not simulated PDF/EPUB prop replacement.
  root.render(<App />); await until(() => document.querySelector('input[type="file"]'), "J App did not mount");
  await openFile("long.pdf");
  await until(() => observed().pdf?.numPages === 12 && observed().viewerHandle.current?.pdfDocument === observed().pdf && observed().map.has(1), "J App did not acquire PDF");
  await ready(observed().pdf!, 1); await idle("J App PDF");
  // Direct viewer scale is an actual PDF.js operation; fixture cap applies equally
  // to the App-owned surface without changing the production zoom preferences.
  viewer().currentScale = 2;
  await until(() => pageView(1)?.detailView?.renderingState === 3, "J App high zoom did not create detail");
  if (document.querySelector<HTMLElement>(".reader-layout")!.dataset.recolor !== "true") await command("toggle_recolor");
  if (document.querySelector<HTMLElement>(".reader-layout")!.dataset.recolorMode !== "pixel") await command("recolor_toggle_keephue");
  await until(() => observed().details.get(1)?.canvas === pageView(1)?.detailView?.canvas && visible(pageView(1)!.detailView!.canvas!), "J App pixel detail did not complete");
  await idle("J App pixel");
  const appPair = observed().details.get(1)!;
  const appOriginal = data(appPair.pristine);
  check(data(appPair.canvas).some((byte, index) => index % 4 !== 3 && byte !== appOriginal[index]), "J App pixel detail remained pristine");
  sources = retained(); observation = observed();
  await openFile("short.pdf");
  await until(() => observed().pdf?.numPages === 1 && observed().viewerHandle.current?.pdfDocument === observed().pdf && observed().map.has(1), "J App PDF replacement did not commit");
  await idle("J App replacement");
  check(sources.every((canvas) => !canvas.width && !canvas.height), "J App PDF replacement leaked independent sources");
  sources = retained(); observation = observed();
  await openFile("lifecycle.epub");
  await until(() => document.querySelector('.epub-reader__viewport[aria-busy="false"] iframe') && observation.viewerHandle.current === null, "K actual App PDF to EPUB replacement did not finish real EPUB rendering/unmount PDF");
  released(sources, observation, "K App PDF to EPUB");
  await openFile("short.pdf");
  await until(() => observed().pdf?.numPages === 1 && observed().viewerHandle.current?.pdfDocument === observed().pdf && observed().map.has(1) &&
    !document.querySelector(".epub-reader"), "K actual App EPUB-to-PDF replacement did not commit");
  await ready(observed().pdf!, 1); await idle("K App PDF return");
  viewer().currentScale = 2;
  await until(() => {
    const crop = pageView(1)?.detailView?.canvas;
    return pageView(1)?.detailView?.renderingState === 3 && crop && observed().details.get(1)?.canvas === crop && visible(crop);
  }, "K returned App PDF did not render/recolor genuine detail");
  await idle("K returned App detail");
  const returnedPage = pageView(1)!;
  const returnedBackground = samplePage(returnedPage.canvas!, .26, .08);
  near(samplePage(returnedPage.detailView!.canvas!, .26, .08), returnedBackground, "K returned App main/detail pixels disagree");
  check(returnedBackground[0] !== 255 || returnedBackground[1] !== 255 || returnedBackground[2] !== 255, "K returned App lost advanced appearance");
  sources = retained(); observation = observed();
  await command("close_document"); await settle();
  released(sources, observation, "K returned App close");
  root.unmount(); mutation.disconnect(); await settle();
  await Promise.all(tasks.map((task) => task.destroy()));
  check(!snapshots.size && !gates.size && !cpu.active && !cpu.buffers, "K final native resources pending");
  check(errors.length === 0, errors.join("; "));
  cases.push("J App acquisition and PDF replacement", "K App PDF-to-EPUB-to-PDF replacement, close and final cleanup");
  return { passed: true, backend, dpr: devicePixelRatio, testOnlyMaxCanvasPixels: 1_500_000, cases, metrics, cpu: { ...cpu, invoke: undefined, yield: undefined }, errors };
}
run().then((result) => window.webkit.messageHandlers.test.postMessage(JSON.stringify(result))).catch((error: unknown) => {
  release(); mutation.disconnect(); root.unmount();
  window.webkit.messageHandlers.test.postMessage(JSON.stringify({ passed: false, backend, cases, metrics, cpu, errors, error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined }));
});
