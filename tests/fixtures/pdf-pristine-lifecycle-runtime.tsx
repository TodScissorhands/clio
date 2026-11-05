import { useRef } from "react";
import { createRoot } from "react-dom/client";
import App from "../../src/App";
import { PdfViewerSurface } from "../../src/pdf/PdfViewerSurface";
import type { PdfViewerHandle } from "../../src/pdf/PdfViewerSurface";
import { createPdfLoadingTask } from "../../src/pdf/engine";
import type { PdfDocument, PdfLoadingTask } from "../../src/pdf/engine";
import { DEFAULT_RECOLOR_SETTINGS } from "../../src/pdf/recolor";
import type { PdfRecolorSettings } from "../../src/pdf/recolor";
import { READER_COMMANDS } from "../../src/reader/interactions";
import type { ReaderCommandId } from "../../src/reader/interactions";
import "../../src/index.css";

type Observation = { map: Map<number, HTMLCanvasElement>; viewerHandle: PdfViewerHandle; pdf: PdfDocument | null };
type PageView = {
  canvas?: HTMLCanvasElement;
  renderingState: number;
  detailView?: { renderingState: number } | null;
  maxCanvasPixels: number;
};
declare global {
  interface Window {
    __pdfLifecycle: Observation;
    __pdfViewerGate?: Promise<void>;
    webkit: { messageHandlers: { test: { postMessage: (message: string) => void } } };
  }
}

const cases: string[] = [];
const metrics: { label: string; entries: number; pixels: number }[] = [];
const tasks: PdfLoadingTask[] = [];
const root = createRoot(document.getElementById("root")!);
const check: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};
const settle = () => {
  const { promise, resolve } = Promise.withResolvers<void>();
  requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  return promise;
};
async function until(predicate: () => unknown, message: string) {
  const deadline = performance.now() + 12_000;
  while (!predicate()) {
    check(performance.now() < deadline, message);
    await settle();
  }
  await settle();
}
const observed = () => window.__pdfLifecycle;
const viewer = () => {
  const current = observed().viewerHandle.current;
  check(current, "PDF.js viewer is unavailable");
  return current;
};
const pageView = (page = viewer().currentPageNumber) => viewer().getPageView(page - 1) as PageView | undefined;
function fingerprint(canvas: HTMLCanvasElement) {
  check(canvas.width > 0 && canvas.height > 0, "cannot sample a released canvas");
  const context = canvas.getContext("2d");
  check(context, "canvas has no 2D context");
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let hash = 2166136261;
  for (let index = 0; index < pixels.length; index += 388) {
    for (let channel = 0; channel < 4; channel++) hash = Math.imul(hash ^ pixels[index + channel]!, 16777619);
  }
  return `${canvas.width}x${canvas.height}:${hash >>> 0}`;
}
function measure(label: string) {
  const map = observed().map;
  metrics.push({ label, entries: map.size, pixels: [...map.values()].reduce((sum, canvas) => sum + canvas.width * canvas.height, 0) });
}
function retainedCanvases() {
  return [...observed().map.values()];
}
function released(canvases: HTMLCanvasElement[], label: string) {
  check(observed().map.size === 0, `${label}: private pristine map is not empty`);
  check(canvases.length > 0, `${label}: no original canvases were observed`);
  check(canvases.every((canvas) => canvas.width === 0 && canvas.height === 0), `${label}: owned pristine backing dimensions were not both zeroed`);
  canvases.length = 0;
  measure(label);
}
async function load(name: string) {
  const task = createPdfLoadingTask(new Uint8Array(await (await fetch(`/__fixtures/${name}`)).arrayBuffer()));
  tasks.push(task);
  return task.promise;
}
const plain = { ...DEFAULT_RECOLOR_SETTINGS };
const pixel = { ...plain, recolor: true, recolorKeephue: true };
type Configuration = { pdf: PdfDocument | null; pageNumber: number; scale: number; spread: boolean; continuousScrolling: boolean; recolorSettings: PdfRecolorSettings };
let configuration: Configuration = { pdf: null, pageNumber: 1, scale: 1, spread: false, continuousScrolling: false, recolorSettings: plain };
let renderSignals = 0;
const emptyMatches = new Map<number, never[]>();
const ignore = () => {};
const rendered = () => { renderSignals++; };
const changedPage = (pageNumber: number) => { configuration = { ...configuration, pageNumber }; draw(); };
function Harness() {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const viewerHandle = useRef<PdfViewerHandle["current"]>(null);
  return <div ref={containerRef} className="document-viewport" tabIndex={0} style={{ position: "absolute", inset: 0, overflow: "auto" }}>
    <div ref={viewerRef} className="pdfViewer" />
    <PdfViewerSurface containerRef={containerRef} viewerRef={viewerRef} viewerHandle={viewerHandle}
      {...configuration} matchesByPage={emptyMatches} activeMatch={-1} onPageChange={changedPage}
      onActiveMatchElement={ignore} onPageElements={ignore} onPageRendered={rendered} onRenderError={(message) => { throw new Error(message); }} />
  </div>;
}
function draw() { root.render(<Harness />); }
async function update(patch: Partial<Configuration>) {
  configuration = { ...configuration, ...patch };
  draw();
  await settle();
}
async function ready(pdf: PdfDocument, page = configuration.pageNumber) {
  await until(() => {
    const current = observed()?.viewerHandle.current;
    const view = current?.getPageView(page - 1) as PageView | undefined;
    const pristine = observed()?.map.get(page);
    return current?.pdfDocument === pdf && current.currentPageNumber === page && view?.renderingState === 3 &&
      view.canvas && view.canvas.width > 0 && pristine && pristine.width === view.canvas.width && pristine.height === view.canvas.height;
  }, `PDF ${pdf.numPages}-page document/page ${page} did not finish real rendering`);
}
function pristineAndCanvas(page = configuration.pageNumber) {
  const pristine = observed().map.get(page);
  const canvas = pageView(page)?.canvas;
  check(pristine && canvas, `page ${page} has no rendered/pristine pair`);
  check(pristine !== canvas, "Clio pristine aliases the PDF.js-owned render canvas");
  return { pristine, canvas };
}
function dispatchRendered(source: object, pageNumber: number) {
  viewer().eventBus.dispatch("pagerendered", { source, pageNumber, cssTransform: false, timestamp: performance.now(), error: null });
}
async function key(key: string, init: KeyboardEventInit = {}) {
  const target = document.activeElement ?? document.body;
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
  target.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true, ...init }));
  await settle();
}
async function command(id: ReaderCommandId) {
  await key(":", { shiftKey: true, code: "Semicolon" });
  await until(() => document.querySelector(".command-filter"), "production palette did not open");
  const input = document.querySelector<HTMLInputElement>(".command-filter")!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, id);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await settle();
  const label = READER_COMMANDS.find((entry) => entry.id === id)!.label;
  const option = [...document.querySelectorAll<HTMLElement>('.command-list [role="option"]')]
    .find((entry) => entry.querySelector(".command-label")?.textContent === label);
  check(option, `production command unavailable: ${id}`);
  option.click();
  await until(() => !document.querySelector(".command-palette"), `${id} did not execute`);
}
async function openFile(name: string) {
  const data = await (await fetch(`/__fixtures/${name}`)).arrayBuffer();
  const transfer = new DataTransfer();
  transfer.items.add(new File([data], name));
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  check(input, "production App file input is unavailable");
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await settle();
}

async function run() {
  localStorage.clear();
  const long = await load("long.pdf");
  const short = await load("short.pdf");
  await update({ pdf: long });
  await ready(long);
  let pair = pristineAndCanvas();
  check(pair.pristine.width > 0 && pair.pristine.height > 0 && fingerprint(pair.pristine) === fingerprint(pair.canvas), "A pristine does not hold the original rendered pixels");
  measure("A rendered"); cases.push("A rendered pristine");

  let retained = retainedCanvases();
  await update({ pdf: null });
  await until(() => viewer().pdfDocument === null, "close did not detach the PDF.js document");
  released(retained, "B close"); cases.push("B close releases");
  await update({ pdf: null });
  check(observed().map.size === 0 && viewer().pdfDocument === null, "C repeat close resurrected resources");
  cases.push("C repeated close");

  await update({ pdf: long }); await ready(long);
  pair = pristineAndCanvas();
  check(fingerprint(pair.pristine) === fingerprint(pair.canvas), "D reopen captured incorrect original pixels");
  cases.push("D fresh reopen");
  for (let pageNumber = 2; pageNumber <= 12; pageNumber++) {
    await update({ pageNumber }); await ready(long, pageNumber);
  }
  check([...observed().map.keys()].some((page) => page > 1), "E long fixture never populated non-first-page pristine entries");
  await update({ pageNumber: 1 }); await ready(long, 1);
  // Force a bounded real PDF.js partial/detail render, not a synthetic page-view object.
  const oldPage = pageView(1)!;
  oldPage.maxCanvasPixels = 120_000;
  await update({ scale: 3 }); await ready(long, 1);
  await until(() => oldPage.detailView?.renderingState === 3, "real PDF.js detail rendering did not finish");
  const oldDetail = oldPage.detailView!;
  const beforeDetail = renderSignals;
  dispatchRendered(oldDetail, 1);
  check(renderSignals === beforeDetail + 1, "current real detail-view render event was incorrectly rejected");
  retained = retainedCanvases();
  await update({ pdf: short, pageNumber: 1, scale: 1 });
  // Assert zeroing on retained resources even after the new map has repopulated.
  await ready(short);
  check(retained.every((canvas) => canvas.width === 0 && canvas.height === 0), "E replacement did not release all prior pristine backing stores");
  retained.length = 0;
  check(observed().map.size === 1 && observed().map.has(1), "E replacement retained old page IDs");
  measure("E short replacement"); cases.push("E long to short");

  await update({ recolorSettings: pixel });
  pair = pristineAndCanvas();
  await until(() => getComputedStyle(pair.canvas).visibility !== "hidden" && fingerprint(pair.canvas) !== fingerprint(pair.pristine), "G pixel recolor did not complete");
  const original = fingerprint(pair.pristine);
  check(fingerprint(pair.canvas) !== original, "G pixel recolor did not alter the real PDF.js canvas");
  const beforeStale = renderSignals;
  const entriesBefore = [...observed().map];
  dispatchRendered(oldPage, 1);
  dispatchRendered(oldDetail, 1);
  dispatchRendered(oldPage, 12);
  check(renderSignals === beforeStale, "G stale page/detail render event reached the current render consumer");
  check(observed().map.size === entriesBefore.length && entriesBefore.every(([page, canvas]) => observed().map.get(page) === canvas), "G stale event polluted pristine entries");
  check(fingerprint(pair.pristine) === original, "G stale pixel-path event overwrote pristine pixels with recolored pixels");
  await update({ recolorSettings: plain });
  check(fingerprint(pair.canvas) === original, "G stale render corrupted later restoration");
  cases.push("G stale render sources");

  for (let cycle = 0; cycle < 3; cycle++) {
    retained = retainedCanvases();
    await update({ pdf: null }); released(retained, `H close ${cycle}`);
    await update({ pdf: cycle % 2 ? long : short }); await ready(configuration.pdf!);
  }
  cases.push("H repeated cycles");
  pair = pristineAndCanvas();
  const reopenedOriginal = fingerprint(pair.pristine);
  await update({ recolorSettings: pixel });
  await until(() => getComputedStyle(pair.canvas).visibility !== "hidden" && fingerprint(pair.canvas) !== reopenedOriginal, "I reopened pixel recolor did not complete");
  check(fingerprint(pair.canvas) !== reopenedOriginal, "I recolor after reopen had no pixel effect");
  await update({ recolorSettings: plain });
  check(fingerprint(pair.canvas) === reopenedOriginal, "I recolor after reopen did not restore exact original pixels");
  cases.push("I reopen recolor");

  // Navigation/layout are still owned by the real viewer and Surface effects.
  await update({ pdf: long, pageNumber: 1 }); await ready(long);
  const stable = observed().map.get(1)!;
  await update({ recolorSettings: { ...plain }, spread: false });
  check(observed().map.get(1) === stable && stable.width > 0, "same-PDF ordinary rerender invalidated a valid pristine entry");
  await update({ pageNumber: 7 }); await ready(long, 7);
  const scaleBefore = viewer().currentScale;
  await update({ scale: 1.25 }); await ready(long, 7);
  check(viewer().currentScale > scaleBefore, "K zoom did not reach PDF.js");
  await update({ spread: true, continuousScrolling: true });
  await until(() => viewer().spreadMode === 1 && viewer().scrollMode === 0, "K spread/continuous modes did not reach PDF.js");
  check(document.querySelector(".pdfViewer .spread"), "K spread mode has no real spread DOM");
  await update({ pageNumber: 9 }); await ready(long, 9);
  await update({ spread: false, continuousScrolling: false });
  await until(() => viewer().spreadMode === 0 && viewer().scrollMode === 3, "K single/paged mode did not restore");

  retained = retainedCanvases();
  const unmounted = observed();
  root.render(null); await settle();
  check(unmounted.viewerHandle.current === null, "unmount retained the PDF.js viewer handle");
  released(retained, "unmount");

  // The actual lazy viewer import is gated only in this test bundle. Commit two
  // documents and null while it is pending; release it without any timed sleep.
  const { promise: initializationGate, resolve: release } = Promise.withResolvers<void>();
  window.__pdfViewerGate = initializationGate;
  await update({ pdf: long, pageNumber: 1, scale: 1, recolorSettings: plain });
  check(observed().viewerHandle.current === null, "pending initialization gate was not effective");
  await update({ pdf: short });
  await update({ pdf: null });
  release(); delete window.__pdfViewerGate;
  await until(() => observed().viewerHandle.current !== null, "pending viewer did not initialize");
  check(viewer().pdfDocument === null && observed().map.size === 0, "pending initialization resurrected a superseded document");
  await update({ pdf: short }); await ready(short);
  retained = retainedCanvases(); root.render(null); await settle(); released(retained, "pending unmount");

  // The invalid replacement path uses the production App/PdfReader file input,
  // loading generation and error UI rather than a simulated failed prop update.
  root.render(<App />);
  await until(() => document.querySelector('input[type="file"]'), "App did not mount");
  await openFile("long.pdf");
  await until(() => observed().pdf?.numPages === 12 && observed().viewerHandle.current?.pdfDocument === observed().pdf && observed().map.has(1), "App did not render long PDF");
  const appPdf = observed().pdf!;
  await ready(appPdf, 1);
  if (document.querySelector<HTMLElement>(".clio-app")!.dataset.nightMode === "true") await command("toggle_night_mode");
  const appPristine = observed().map.get(1)!;
  const appOriginal = fingerprint(appPristine);
  await openFile("corrupt.pdf");
  await until(() => document.querySelector('[role="alert"]')?.textContent?.match(/valid PDF|Invalid PDF/i), "failed replacement did not report the real PDF error");
  check(observed().pdf === appPdf && viewer().pdfDocument === appPdf, "F failed replacement changed the committed document");
  check(observed().map.get(1) === appPristine && fingerprint(appPristine) === appOriginal, "F failed replacement lost or changed the prior pristine render");
  document.querySelector<HTMLButtonElement>('[role="alert"] button')!.click(); await settle();
  await command("next_page"); await ready(appPdf, 2);
  await command("previous_page"); await ready(appPdf, 1);
  await command("zoom_in"); await ready(appPdf, 1);
  const appPair = pristineAndCanvas(1);
  const appPlain = fingerprint(appPair.pristine);
  await command("toggle_recolor");
  check(document.querySelector<HTMLElement>(".reader-layout")!.dataset.recolorMode === "svg", "J SVG mode was not selected");
  check(getComputedStyle(appPair.canvas).filter.includes("clio-recolor-matrix"), "J SVG filter is not applied to the rendered page canvas");
  check(fingerprint(appPair.canvas) === appPlain, "J SVG mode destructively changed original canvas pixels");
  await command("recolor_toggle_keephue");
  check(document.querySelector<HTMLElement>(".reader-layout")!.dataset.recolorMode === "pixel" && !getComputedStyle(appPair.canvas).filter.includes("clio-recolor-matrix"), "J SVG filter remained active in pixel mode");
  await until(() => getComputedStyle(appPair.canvas).visibility !== "hidden" && fingerprint(appPair.canvas) !== appPlain, "J pixel transition did not complete");
  check(fingerprint(appPair.canvas) !== appPlain, "J pixel transition did not recolor actual canvas pixels");
  await command("recolor_toggle_keephue");
  check(fingerprint(appPair.canvas) === appPlain && getComputedStyle(appPair.canvas).filter.includes("clio-recolor-matrix"), "J pixel-to-SVG transition failed to restore original pixels and filter");
  await command("toggle_recolor");
  check(fingerprint(appPair.canvas) === appPlain && getComputedStyle(appPair.canvas).filter === "none", "J disabling recolor failed to restore unfiltered original output");
  // Preserve stable reporting order while running related assertions together.
  cases.push("J SVG and pixel transitions", "K navigation zoom spread continuous", "same-PDF rerender", "unmount cleanup", "pending initialization replacement and null", "F failed replacement retains reader");
  retained = retainedCanvases(); await command("close_document"); released(retained, "App close");
  root.unmount();
  await Promise.all(tasks.map((task) => task.destroy()));
  return { passed: true, cases, metrics };
}

run().then((result) => window.webkit.messageHandlers.test.postMessage(JSON.stringify(result))).catch((error: unknown) => {
  root.unmount();
  window.webkit.messageHandlers.test.postMessage(JSON.stringify({
    passed: false, cases, metrics,
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  }));
});
