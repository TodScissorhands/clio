import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "../../src/App";
import type { ReaderFileSource } from "../../src/platform/tauriReaderFiles";
import type { ReadingPosition } from "../../src/platform/readingPosition";
import "../../src/index.css";

declare global {
  interface Window {
    __positionApp: { open: (source: ReaderFileSource) => Promise<void> };
    __positionCommits: number;
    __positionLoad: (path: string) => Promise<ReadingPosition | null>;
    __positionSave: (path: string, position: ReadingPosition) => Promise<void>;
  }
}
const records = new Map<string, ReadingPosition>();
const calls: { path: string; position: ReadingPosition; release: () => void; reject: (cause: Error) => void }[] = [];
let hold = false;
window.__positionCommits = 0;
window.__positionLoad = async path => records.get(path) ?? null;
window.__positionSave = async (path, position) => {
  const gate = Promise.withResolvers<void>();
  calls.push({ path, position, release: gate.resolve, reject: gate.reject });
  if (hold) await gate.promise;
  records.set(path, position);
};
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function until(predicate: () => unknown, message: string) {
  const end = performance.now() + 10_000;
  while (!predicate()) { check(performance.now() < end, message); await sleep(25); }
  await sleep(50);
}
const status = () => document.querySelector(".status-page")?.textContent ?? "";
async function key(key: string) {
  const target = document.activeElement ?? document.body;
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  target.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }));
  await sleep(30);
}
async function command(query: string) {
  document.querySelector<HTMLElement>(".document-viewport")!.focus();
  await key(":");
  const input = document.querySelector<HTMLInputElement>(".command-filter");
  check(input, "palette missing");
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, query);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await sleep(30);
  check(document.querySelectorAll('[role="option"]').length === 1, `ambiguous command: ${query}`);
  await sleep(30); await key("Enter");
}
async function page(number: number) {
  document.querySelector<HTMLElement>(".document-viewport")!.focus();
  await key("g");
  const input = document.querySelector<HTMLInputElement>('[aria-label="Page number"]');
  check(input, "page editor missing");
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, String(number));
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await sleep(30); await key("Enter");
  await until(() => status().includes(`Page ${number} /`) && document.querySelector(`.page[data-page-number="${number}"] .textLayer`), `page ${number} not painted: ${status()}`);
}
let pdf: Uint8Array;
async function open(path: string) {
  const commits = window.__positionCommits;
  await window.__positionApp.open({ kind: "pdf", bytes: pdf.slice(), name: path.split("/").pop()!, path });
  await until(() => window.__positionCommits > commits && document.title === `${path.split("/").pop()} — Clio` && document.querySelector(".textLayer"), "PDF did not open");
  await sleep(100);
}
const evidence: Record<string, unknown> = {};
async function run() {
  pdf = new Uint8Array(await (await fetch("/status.pdf")).arrayBuffer());
  await open("/canonical/A.pdf");
  await page(2);
  await command("Close document");
  await until(() => document.title === "Clio", "close did not complete");
  const immediate = records.get("/canonical/A.pdf");
  evidence.immediateClose = immediate ?? null;
  await open("/canonical/A.pdf");
  evidence.reopened = status();
  await page(2); await sleep(850);
  calls.length = 0; hold = true;
  await page(1); await until(() => calls.length >= 1, "first save missing");
  await page(3); await sleep(850);
  evidence.concurrentInvocations = calls.map(call => call.position);
  const overlapping = calls.length;
  // Baseline invokes concurrently. Correct implementation queues the newer call.
  if (calls[1]) calls[1].release();
  calls[0]!.release();
  await until(() => calls.length >= 2, "queued second save missing");
  calls[1]!.release(); await sleep(100); hold = false;
  evidence.finalOrderedRecord = records.get("/canonical/A.pdf");
  check(immediate?.page === 2, "immediate close discarded debounced page 2");
  check(String(evidence.reopened).includes("Page 2 /"), "reopen restored stale location");
  check(overlapping === 1, "same-path writes overlap");
  check(records.get("/canonical/A.pdf")?.page === 3, "older completion overwrote newer page");

  // Preparation succeeds before retirement starts; A stays mounted until saved.
  calls.length = 0; hold = true;
  await page(2);
  const replacing = open("/canonical/B.pdf");
  await until(() => calls.length === 1, "replacement did not flush A");
  check(document.title === "A.pdf — Clio", "replacement retired A before persistence");
  check(calls[0]!.path === "/canonical/A.pdf" && calls[0]!.position.page === 2, "A snapshot attributed to B");
  calls[0]!.release(); hold = false; await replacing;
  await page(3); await command("Close document");
  await until(() => document.title === "Clio", "B close missing");
  check(records.get("/canonical/A.pdf")?.page === 2 && records.get("/canonical/B.pdf")?.page === 3, "replacement paths lost independent positions");
  evidence.replacement = Object.fromEntries(records);

  await open("/canonical/A.pdf"); await page(3);
  await open("/canonical/A.pdf");
  check(status().includes("Page 3 /"), "same-path reopen loaded before final save");
  evidence.samePathReopen = status();

  records.set("/canonical/restored.pdf", { page: 2, offset: 0.35 });
  await open("/canonical/restored.pdf");
  calls.length = 0;
  await command("Fit to page width");
  await command("Toggle continuous scrolling");
  // A native resize exercises the real viewer's geometry callbacks.
  host.webkit.messageHandlers.test.postMessage(JSON.stringify({ resize: [900, 650], scale: 1 }));
  await sleep(1000);
  evidence.restorationWrites = calls.map(call => ({ path: call.path, position: call.position }));
  check(calls.length === 0 && records.get("/canonical/restored.pdf")?.offset === 0.35,
    "restoration/reflow generated an automatic position overwrite");
  evidence.restoration = { status: status(), position: records.get("/canonical/restored.pdf") };

  // Genuine scrolling keeps debounce, then final close snapshots a finite offset.
  const viewer = document.querySelector<HTMLElement>(".document-viewport")!;
  const painted = document.querySelector<HTMLElement>('.page[data-page-number="2"]')!;
  viewer.scrollTop += painted.getBoundingClientRect().top - viewer.getBoundingClientRect().top + 0.2 * painted.getBoundingClientRect().height;
  await sleep(100);
  check(calls.length === 0, "ordinary scroll bypassed debounce");
  const offset = Math.max(0, (viewer.getBoundingClientRect().top - painted.getBoundingClientRect().top) / painted.getBoundingClientRect().height);
  await command("Close document");
  await until(() => document.title === "Clio", "scrolled close missing");
  const scrolled = records.get("/canonical/restored.pdf")!;
  check(scrolled.page === 2 && Math.abs(scrolled.offset - offset) < 0.01 && scrolled.offset > 0.1, "close discarded valid scroll offset");
  evidence.scrolledClose = scrolled;
  await open("/canonical/restored.pdf");
  check(status().includes("Page 2 /"), "scrolled reopen lost page");

  // Cross-format acquisition awaits the same final snapshot.
  await page(3); calls.length = 0; hold = true;
  const epubBytes = new Uint8Array(await (await fetch("/status.epub")).arrayBuffer());
  const epubOpening = window.__positionApp.open({ kind: "epub", bytes: epubBytes, name: "status.epub", path: null });
  await until(() => calls.length === 1, "EPUB replacement did not flush");
  check(document.title === "restored.pdf — Clio", "EPUB unmounted PDF before flush");
  hold = false; calls[0]!.release(); await epubOpening;
  await until(() => document.title === "status.epub — Clio" && document.querySelector(".epub-status"), "EPUB did not commit");
  check(records.get("/canonical/restored.pdf")?.page === 3, "EPUB retirement lost PDF location");
  evidence.crossFormat = records.get("/canonical/restored.pdf");

  // A failed final save must keep the document; a later save must still work.
  await open("/canonical/failure.pdf"); await page(2);
  calls.length = 0; hold = true; await command("Close document");
  await until(() => calls.length === 1, "failed close did not save");
  calls[0]!.reject(new Error("injected write failure")); await sleep(100);
  check(document.title === "failure.pdf — Clio" && document.querySelector('[role="alert"]')?.textContent?.includes("injected write failure"), "failed flush retired document or hid error");
  hold = false; await command("Close document"); await until(() => document.title === "Clio", "retry after rejected save failed");
  check(records.get("/canonical/failure.pdf")?.page === 2, "rejected tail blocked later save");

  await open("/canonical/timeout.pdf"); await page(2);
  calls.length = 0; hold = true; await command("Close document");
  await until(() => document.querySelector('[role="alert"]')?.textContent?.includes("timed out"), "close timeout not reported");
  check(document.title === "timeout.pdf — Clio", "timeout retired reader");
  await key("Escape"); await page(3); await sleep(850);
  check(calls.length === 1, "timeout allowed later write to overtake pending IPC");
  calls[0]!.release(); await until(() => calls.length === 2, "timeout queue did not recover");
  hold = false; calls[1]!.release(); await sleep(100);
  await command("Close document"); await until(() => document.title === "Clio", "close after timeout did not finish");
  check(records.get("/canonical/timeout.pdf")?.page === 3, "timeout recovery lost latest position");
  evidence.failureAndTimeout = "retained old reader, ordered retry succeeded";

  // Unexpected unmount does not read detached geometry or update another UI.
  await open("/canonical/unmount.pdf"); await page(2);
  calls.length = 0; hold = true; await until(() => calls.length === 1, "unmount save not pending");
  root.unmount();
  root = createRoot(document.getElementById("root")!);
  root.render(<StrictMode><App /></StrictMode>);
  calls[0]!.reject(new Error("retired reader failure")); hold = false; await sleep(150);
  check(!document.querySelector('[role="alert"]'), "retired reader error reached new UI");
  await open("/canonical/B.pdf");
  check(status().includes("Page 3 /"), "StrictMode remount lost durable restoration");
  evidence.unmount = "stale error suppressed; StrictMode remount restored B";
}
let root = createRoot(document.getElementById("root")!);
root.render(<StrictMode><App /></StrictMode>);
// The WebKit test runner installs this native-only test message boundary.
const host = window as unknown as { webkit: { messageHandlers: { test: { postMessage: (message: string) => void } } } };
const report = (value: object) => host.webkit.messageHandlers.test.postMessage(JSON.stringify(value));
void until(() => window.__positionApp, "App not mounted").then(run).then(() => report({ passed: true, evidence }), error => report({ passed: false, error: String(error), evidence, status: status() }));
