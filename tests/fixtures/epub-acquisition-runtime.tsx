import ePub, { type Book } from "epubjs";
import Archive from "epubjs/lib/archive";
import { createRoot } from "react-dom/client";
import App from "../../src/App";
import { openEpubBook } from "../../src/epub/engine";
import "../../src/index.css";

// These gates delay the result of actual JSZip reads, not synthetic Book or
// Archive results. No production transform, diagnostics or clock delays are used.
type Outcome = { status: "fulfilled"; value: unknown } | { status: "rejected"; reason: unknown };
type ZipEntry = { name: string; async(type: string): Promise<unknown> };
type Zip = { loadAsync(...args: unknown[]): Promise<unknown>; file(name: string): ZipEntry | null };
type RuntimeArchive = {
  zip?: Zip; urlCache: Record<string, string>;
  open(input: ArrayBuffer): Promise<unknown>;
  getBlob(path: string, mimeType?: string): Promise<Blob>;
  getText(path: string): Promise<string>;
  getBase64(path: string): Promise<string>;
  request(path: string, type?: string): Promise<unknown>;
  createUrl(path: string, options?: { base64: boolean }): Promise<string>;
  revokeUrl(path: string): void; destroy(): void;
};
type Observation = { book: Book; archive?: RuntimeArchive; promises: { name: string; result: Promise<Outcome> }[] };
type Stage = "archive-open" | "container-text" | "navigation-text" | "asset-blob" | "css-text";
type Gate = { promise: Promise<void>; resolve(): void };
const check: (value: unknown, message: string) => asserts value = (value, message) => {
  if (!value) throw new Error(message);
};
const observe = (promise: PromiseLike<unknown>): Promise<Outcome> => Promise.resolve(promise).then(
  value => ({ status: "fulfilled", value }), reason => ({ status: "rejected", reason }),
);
async function bounded<T>(promise: PromiseLike<T>, label: string): Promise<T> {
  const deadline = Promise.withResolvers<never>();
  const timer = setTimeout(() => deadline.reject(new Error(`Unsettled ${label}`)), 5_000);
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

const books: Observation[] = [];
// epub.js publishes this runtime constructor but omits it from ePub's call type.
const constructors = ePub as typeof ePub & { Book: { prototype: Book } };
const bookPrototype = constructors.Book.prototype;
const archivePrototype = Archive.prototype as RuntimeArchive;
const originalOpen = bookPrototype.open;
const originalArchiveOpen = archivePrototype.open;
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;
const created: string[] = [];
const revoked: string[] = [];
let onCreate: ((url: string, blob: Blob) => void) | undefined;
URL.createObjectURL = blob => {
  const url = originalCreate.call(URL, blob);
  created.push(url);
  onCreate?.(url, blob as Blob);
  return url;
};
URL.revokeObjectURL = url => { revoked.push(url); originalRevoke.call(URL, url); };
bookPrototype.open = function (...args: Parameters<Book["open"]>) {
  const record: Observation = { book: this, promises: [] };
  for (const [name, promise] of Object.entries({ opened: this.opened, ready: this.ready, ...this.loaded })) {
    record.promises.push({ name, result: observe(promise) });
  }
  books.push(record);
  const opening = originalOpen.apply(this, args);
  record.promises.push({ name: "open()", result: observe(opening) });
  return opening;
};

type ReadPlan = {
  stage: Stage; entered: Gate; release: Gate;
  reads: Promise<Outcome>[]; matched: boolean; error?: Error;
};
let nextPlan: ReadPlan | undefined;
function plan(stage: Stage, error?: Error): ReadPlan {
  check(!nextPlan, "an earlier archive read plan was not consumed");
  const value: ReadPlan = { stage, entered: Promise.withResolvers<void>(), release: Promise.withResolvers<void>(), reads: [], matched: false, error };
  nextPlan = value;
  return value;
}
function hold(actual: Promise<unknown>, gate: ReadPlan) {
  const delayed = Promise.all([actual, gate.release.promise]).then(([value]) => {
    if (gate.error) throw gate.error;
    return value;
  });
  gate.reads.push(observe(delayed));
  gate.matched = true;
  gate.entered.resolve();
  return delayed;
}
archivePrototype.open = function (...args: Parameters<RuntimeArchive["open"]>) {
  const record = books.find(candidate => (candidate.book.archive as unknown) === this);
  if (record) record.archive = this;
  if (record) {
    // Observe original owner promises without substituting their results.
    // This catches a retired Archive that rejects Book but leaves reads pending.
    for (const method of ["getBlob", "getText", "getBase64", "request", "createUrl"] as const) {
      const original = this[method];
      const instrument = (...input: unknown[]) => {
        const result = Reflect.apply(original, this, input);
        record.promises.push({ name: `Archive.${method}`, result: observe(result) });
        return result;
      };
      this[method] = instrument;
    }
  }
  const gate = nextPlan;
  nextPlan = undefined;
  if (gate) {
    const zip = this.zip!;
    if (gate.stage === "archive-open") {
      const load = zip.loadAsync;
      zip.loadAsync = function (...input) { return hold(load.apply(this, input), gate); };
    } else {
      const file = zip.file;
      const wrapped = new WeakSet<ZipEntry>();
      zip.file = function (name) {
        const entry = Reflect.apply(file, this, arguments);
        if (arguments.length !== 1) return entry;
        const target = gate.stage === "container-text" ? "META-INF/container.xml"
          : gate.stage === "navigation-text" ? "EPUB/nav.xhtml"
          : gate.stage === "asset-blob" ? "EPUB/pixel.png" : "EPUB/style.css";
        if (entry && name === target && !gate.matched && !wrapped.has(entry)) {
          wrapped.add(entry);
          const read = entry.async;
          entry.async = function (type) {
            // CSS is also read as a Blob during replacements. Only stop its
            // subsequent text read, which builds the rewritten CSS Blob URL.
            if (gate.matched || (gate.stage === "css-text" && type !== "string")) return read.call(this, type);
            entry.async = read;
            return hold(read.call(this, type), gate);
          };
        }
        return entry;
      };
    }
  }
  const opening = originalArchiveOpen.apply(this, args);
  if (record) record.promises.push({ name: "Archive.open", result: observe(opening) });
  return opening;
};

function lastBook() { check(books.length, "real Book.open was not observed"); return books[books.length - 1]!; }
async function settled(record: Observation) {
  return bounded(Promise.all(record.promises.map(async item => ({ name: item.name, ...await item.result }))), "Book open/opened/ready/loaded promises");
}
async function retired(record: Observation) {
  await settled(record);
  const book = record.book;
  check(!book.isOpen && !book.archive && !book.resources && !book.navigation && !book.spine,
    "retired Book resurrected publication state");
  check(!record.archive || Object.keys(record.archive.urlCache).length === 0, "retired archive retained Blob URL cache entries");
}
function assertUrlsRetired(start: number) {
  for (const url of created.slice(start)) {
    check(revoked.filter(value => value === url).length === 1, `Blob URL was not revoked exactly once: ${url}`);
  }
}
async function release(gate: ReadPlan) {
  gate.release.resolve();
  await bounded(Promise.all(gate.reads), "underlying real JSZip reads");
  await checkpoint();
}
async function rejectOpen(opening: Promise<Outcome>, record: Observation) {
  const result = await bounded(opening, "consumer openEpubBook rejection");
  check(result.status === "rejected", "failed/cancelled acquisition unexpectedly published a Book");
  await settled(record);
  return result;
}

async function normal(bytes: Uint8Array) {
  const start = created.length;
  const book = await bounded(openEpubBook(bytes), "normal acquisition");
  const record = lastBook();
  check(book.spine.length === 3 && book.navigation.toc.length === 3, "real three-section Book/navigation did not open");
  const section = book.spine.get(0);
  check(section, "first real section missing");
  await section.load(book.load.bind(book));
  const paragraph = section.document.getElementById("cfi")!;
  const range = section.document.createRange();
  range.selectNodeContents(paragraph.firstChild!);
  const cfi = section.cfiFromRange(range);
  const restored = await book.getRange(cfi);
  check(restored.toString() === "CFI sentence for book A section 1.", `real section CFI range did not round-trip: ${JSON.stringify({ cfi, text: restored.toString(), start: restored.startContainer.textContent, startOffset: restored.startOffset, end: restored.endContainer.textContent, endOffset: restored.endOffset })}`);
  const viewport = document.createElement("div");
  viewport.style.cssText = "width:800px;height:480px";
  document.body.append(viewport);
  try {
    const rendition = book.renderTo(viewport, { width: 800, height: 480, spread: "none", allowScriptedContent: false });
    await bounded(rendition.display(), "real rendition display");
    const embedded = viewport.querySelector("iframe")?.contentDocument;
    check(embedded?.body.textContent?.includes("Acquisition A chapter 1"), "real rendition did not display the acquired Book");
    // Runtime replacement URLs are intentionally not exposed in epub.js types.
    const resources = book.resources as typeof book.resources & { replacementUrls: string[] };
    check(resources.replacementUrls.some(url => url?.startsWith("blob:")), "real archive assets were not replaced with Blob URLs");
    check(created.length - start >= 3, "real CSS rewrite/image Blob paths were not exercised");
  } finally { book.destroy(); viewport.remove(); }
  await retired(record);
  assertUrlsRetired(start);
  cases.push("normal-open-section-cfi-render");
}
async function cancellation(bytes: Uint8Array, stage: Stage) {
  const start = created.length;
  const gate = plan(stage);
  const controller = new AbortController();
  const opening = observe(openEpubBook(bytes, controller.signal));
  await bounded(gate.entered.promise, `${stage} read gate`);
  const record = lastBook();
  controller.abort();
  // Observe rejection and every public deferred before releasing the read. A
  // timeout cannot make this assertion pass and destruction is not postponed.
  await rejectOpen(opening, record);
  await retired(record);
  record.book.destroy(); record.book.destroy();
  await release(gate);
  await retired(record);
  assertUrlsRetired(start);
  cases.push(`cancel-${stage}`);
}
async function failure(bytes: Uint8Array, name: string, stage?: Stage) {
  const start = created.length;
  const injected = new Error(`Actual archive read failure: ${name}`);
  const gate = stage ? plan(stage, injected) : undefined;
  const opening = observe(openEpubBook(bytes));
  if (gate) {
    await bounded(gate.entered.promise, `${name} read gate`);
    gate.release.resolve();
  }
  const record = lastBook();
  const result = await rejectOpen(opening, record);
  if (gate) check(String(result.reason).includes(injected.message), `${name} was swallowed or replaced with an unrelated failure`);
  await retired(record);
  if (gate) await release(gate);
  record.book.destroy(); record.book.destroy();
  await retired(record);
  assertUrlsRetired(start);
  cases.push(name);
}
async function archiveEdges(bytes: Uint8Array) {
  const start = created.length;
  const archive = new Archive() as RuntimeArchive;
  await archive.open(Uint8Array.from(bytes).buffer);
  for (const [name, operation] of [
    ["invalid JSON", () => archive.request("/EPUB/broken.json", "json")],
    ["missing request", () => archive.request("/EPUB/absent.xhtml")],
    ["missing Blob", () => archive.createUrl("/EPUB/absent.png")],
    ["malformed member escape", () => archive.request("/EPUB/%zz.xhtml")],
  ] as const) {
    const result = await bounded(observe(Promise.resolve().then(operation)), name);
    check(result.status === "rejected", `${name} did not reject`);
  }
  cases.push("archive-request-and-url-errors");
  const urls = await Promise.all([archive.createUrl("/EPUB/pixel.png"), archive.createUrl("/EPUB/pixel.png")]);
  check(urls.every(url => url.startsWith("blob:")), "real archive createUrl did not return Blob URLs");
  archive.revokeUrl("/EPUB/pixel.png");
  const replacement = await archive.createUrl("/EPUB/pixel.png");
  check(!revoked.includes(replacement), "archive returned a previously revoked cached Blob URL");
  archive.destroy(); archive.destroy();
  check(Object.keys(archive.urlCache).length === 0, "standalone archive destruction retained cache entries");
  assertUrlsRetired(start);
  cases.push("archive-url-retirement");
}
async function reentrant(bytes: Uint8Array, css: boolean) {
  const start = created.length;
  let cssCount = 0;
  let destroyed = false;
  onCreate = (_url, blob) => {
    if (blob.type === "text/css") cssCount++;
    if (!destroyed && (css ? blob.type === "text/css" && cssCount === 2 : blob.type === "image/png")) {
      destroyed = true;
      lastBook().book.destroy();
      lastBook().book.destroy();
    }
  };
  try {
    const opening = observe(openEpubBook(bytes));
    const record = lastBook();
    await rejectOpen(opening, record);
    check(destroyed, "reentrant URL creation retirement was not exercised");
    await checkpoint();
    await retired(record);
    assertUrlsRetired(start);
  } finally { onCreate = undefined; }
  cases.push(css ? "reentrant-css-url-destroy" : "reentrant-archive-url-destroy");
}
async function replacement(a: Uint8Array, b: Uint8Array) {
  const start = created.length;
  const gate = plan("asset-blob");
  const controller = new AbortController();
  const stale = observe(openEpubBook(a, controller.signal));
  await bounded(gate.entered.promise, "A replacement read gate");
  const old = lastBook();
  controller.abort();
  await rejectOpen(stale, old);
  const current = await bounded(openEpubBook(b), "B replacement acquisition");
  const live = lastBook();
  await release(gate);
  await retired(old);
  const section = current.spine.get(0);
  check(section && current.packaging.metadata.title === "Acquisition B", "A completion replaced B metadata");
  await section.load(current.load.bind(current));
  check(section.document.body.textContent?.includes("Acquisition B chapter 1"), "same member paths resurrected A content");
  current.destroy(); await retired(live);
  assertUrlsRetired(start);
  cases.push("same-members-aborted-replacement");
}

function select(bytes: Uint8Array, name: string) {
  const transfer = new DataTransfer();
  transfer.items.add(new File([Uint8Array.from(bytes).buffer], name));
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  check(input, "App file input is missing");
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}
function appDocument() {
  return document.querySelector<HTMLIFrameElement>('[aria-label="EPUB reading area"] iframe')?.contentDocument;
}
async function app(a: Uint8Array, b: Uint8Array, invalid: Uint8Array) {
  const start = created.length;
  const root = createRoot(document.getElementById("root")!);
  root.render(<App />);
  await until(() => document.querySelector('input[type="file"]'), "App mount");
  select(a, "acquisition-a.epub");
  await until(() => appDocument()?.body.textContent?.includes("Acquisition A chapter 1"), "App initial A render");
  const committed = appDocument();
  const gate = plan("asset-blob");
  select(a, "acquisition-a.epub");
  await bounded(gate.entered.promise, "App pending A read gate");
  const stale = lastBook();
  select(b, "acquisition-b.epub");
  await until(() => appDocument()?.body.textContent?.includes("Acquisition B chapter 1"), "App replacement B render");
  const live = lastBook();
  check(appDocument() !== committed, "App did not replace the A document");
  await retired(stale);
  await release(gate);
  check(appDocument()?.body.textContent?.includes("Acquisition B chapter 1") && !document.querySelector(".error-banner"),
    "stale A cancellation changed committed B or displayed an error");
  const retained = appDocument();
  select(invalid, "invalid.epub");
  await until(() => document.querySelector(".error-banner"), "App invalid replacement error");
  check(appDocument() === retained && appDocument()?.body.textContent?.includes("Acquisition B chapter 1"),
    "invalid replacement discarded the committed B document");
  await retired(lastBook());
  root.unmount();
  await checkpoint();
  await retired(live);
  assertUrlsRetired(start);
  cases.push("app-stale-open-and-invalid-retention");
}
async function bytes(name: string) {
  const response = await fetch(`/__fixtures/${name}`);
  check(response.ok, `missing fixture ${name}`);
  return new Uint8Array(await response.arrayBuffer());
}
async function run() {
  try {
    const [a, b, missing, invalid] = await Promise.all(["acquisition-a.epub", "acquisition-b.epub", "missing-nav.epub", "invalid.epub"].map(bytes));
    await normal(a!);
    const count = books.length;
    const controller = new AbortController(); controller.abort();
    const result = await bounded(observe(openEpubBook(a!, controller.signal)), "already aborted acquisition");
    check(result.status === "rejected" && books.length === count, "already aborted acquisition started Book.open");
    cases.push("abort-before-open");
    for (const stage of ["archive-open", "container-text", "navigation-text", "asset-blob", "css-text"] as const) await cancellation(a!, stage);
    await failure(a!, "asset-read-error", "asset-blob");
    await failure(a!, "css-read-error", "css-text");
    await failure(missing!, "missing-navigation");
    await failure(invalid!, "invalid-zip");
    await archiveEdges(a!);
    await reentrant(a!, false); await reentrant(a!, true);
    await replacement(a!, b!);
    await app(a!, b!, invalid!);
    await checkpoint();
    check(errors.length === 0, `unexpected runtime errors: ${errors.join("; ")}`);
    assertUrlsRetired(0);
    check(revoked.length === created.length, "revocation included foreign/cache-key URLs or duplicate ownership");
    return { passed: true, cases, errors, created: created.length, revoked: revoked.length, spine: 3 };
  } finally {
    bookPrototype.open = originalOpen;
    archivePrototype.open = originalArchiveOpen;
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
}));
