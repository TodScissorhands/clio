import { createRoot } from "react-dom/client";
import App from "../../src/App";
import type { ReadingPosition } from "../../src/platform/readingPosition";
import "../../src/index.css";

declare global {
  interface Window {
    __benchOpen: (count: number, page?: number) => Promise<void>;
    __benchCommit: number;
    __benchGeometryReads: number;
    __benchGeometryCounts: WeakMap<object, number>;
    __benchCurrentPdf: object | null;
    __benchInitialSizes: ({ width: number; height: number } | undefined)[];
    __benchGeometryGate: Promise<void> | null;
    __benchGeometryGatePage: number;
    __benchGeometryGateReached: boolean;
    __benchGeometryRelease: (() => void) | null;
    __benchPublished: { pdf: object; pageNumber: number }[];
    __benchRecords: Map<string, ReadingPosition>;
    __benchMetrics: { phase: string; at: number; details?: unknown }[];
    __bench: (phase: string, details?: unknown) => void;
  }
}
window.__benchMetrics = [];
window.__bench = (phase, details) => window.__benchMetrics.push({ phase, at: performance.now(), details });
window.__benchCommit = 0;
window.__benchGeometryReads = 0;
window.__benchGeometryCounts = new WeakMap();
window.__benchCurrentPdf = null;
window.__benchGeometryGate = null;
window.__benchGeometryGatePage = 2;
window.__benchGeometryGateReached = false;
window.__benchGeometryRelease = null;
window.__benchPublished = [];
const native = window as unknown as { webkit: { messageHandlers: { test: { postMessage: (message: string) => void } } } };
const report = (value: object) => native.webkit.messageHandlers.test.postMessage(JSON.stringify(value));
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate: () => unknown, label: string) {
  const end = performance.now() + 60_000;
  while (!predicate()) {
    if (performance.now() > end) throw new Error(`Timeout: ${label}`);
    await sleep(20);
  }
}
void (async () => {
  await until(() => window.__benchOpen, "App benchmark API");
  const results = [];
  for (const count of [5, 100, 1000]) {
    const start = performance.now();
    const commitBefore = window.__benchCommit;
    await window.__benchOpen(count);
    await until(() => window.__benchCommit > commitBefore, `commit ${count}`);
    await until(() => {
      const page = document.querySelector<HTMLElement>('.page[data-page-number="1"]');
      return page?.querySelector("canvas")?.width && page.querySelector(".textLayer")?.textContent?.includes("Benchmark page 1");
    }, `paint ${count}`);
    const commit = window.__benchMetrics.findLast(item => item.phase === "reader-commit")?.details as { geometryReads: number };
    const initialSize = window.__benchInitialSizes[0];
    if (commit.geometryReads !== 1 || initialSize?.width !== 440 || initialSize.height !== 680) {
      throw new Error(`Page 1 geometry before commit was ${JSON.stringify(initialSize)} after ${commit.geometryReads} reads`);
    }
    const readableMs = performance.now() - start;
    const readableAt = performance.now();
    await until(() => window.__benchGeometryCounts.get(window.__benchCurrentPdf!) === count, `background geometry ${count}`);
    results.push({ count, readableMs, backgroundMs: performance.now() - readableAt, commit, text: document.querySelector(`.page[data-page-number="1"] .textLayer`)?.textContent });
  }
  const lateStart = performance.now();
  window.__benchRecords.set("/bench/progressive-1000.pdf", { page: 995, offset: 0.25 });
  const lateCommit = window.__benchCommit;
  await window.__benchOpen(1000, 995);
  await until(() => window.__benchCommit > lateCommit, "late page commit");
  await until(() => {
    const page = document.querySelector<HTMLElement>('.page[data-page-number="995"]');
    return page?.querySelector("canvas")?.width && page.querySelector(".textLayer")?.textContent?.includes("Benchmark page 995");
  }, "late page 995 paint");
  const restoredCommit = window.__benchMetrics.findLast(item => item.phase === "reader-commit")?.details as { geometryReads: number };
  const lateSize = window.__benchInitialSizes[994];
  if (restoredCommit.geometryReads !== 1 || lateSize?.width !== 440 || lateSize.height !== 650) {
    throw new Error(`Late restoration geometry was ${JSON.stringify(lateSize)} after ${restoredCommit.geometryReads} reads`);
  }
  results.push({ count: 1000, restoredPage: 995, readableMs: performance.now() - lateStart, commit: restoredCommit, text: document.querySelector(`.page[data-page-number="995"] .textLayer`)?.textContent });
  window.__benchRecords.delete("/bench/progressive-1000.pdf");
  let releaseGeometry!: () => void;
  window.__benchGeometryGate = new Promise<void>(resolve => { releaseGeometry = resolve; });
  window.__benchGeometryRelease = releaseGeometry;
  window.__benchGeometryGateReached = false;
  const scanCommit = window.__benchCommit;
  await window.__benchOpen(1000);
  await until(() => window.__benchCommit > scanCommit, "pending-scan page commit");
  await until(() => document.querySelector('.page[data-page-number="1"] .textLayer')?.textContent?.includes("Benchmark page 1"), "pending-scan page paint");
  const retiredPdf = window.__benchCurrentPdf!;
  await until(() => window.__benchGeometryGateReached, "background scan pending page 2");
  const replacementCommit = window.__benchCommit;
  await window.__benchOpen(5);
  await until(() => window.__benchCommit > replacementCommit, "replacement during background geometry");
  await until(() => document.querySelector('.page[data-page-number="1"] .textLayer')?.textContent?.includes("Benchmark page 1"), "replacement reader paint");
  const currentPdf = window.__benchCurrentPdf!;
  releaseGeometry();
  window.__benchGeometryGate = null;
  await until(() => window.__benchGeometryCounts.get(retiredPdf) === 2, "retired in-flight geometry cleanup");
  if (window.__benchCurrentPdf !== currentPdf || window.__benchPublished.some(entry => entry.pdf === retiredPdf && entry.pageNumber === 2)) {
    throw new Error("Retired geometry published into or replaced the active reader");
  }
  results.push({ retiredGeometry: "in-flight page cleaned without publishing after replacement" });
  report({ passed: true, results, metrics: window.__benchMetrics });
})().catch(error => report({ passed: false, error: String(error), metrics: window.__benchMetrics }));
window.__benchRecords = new Map();
const root = createRoot(document.getElementById("root")!);
root.render(<App />);
