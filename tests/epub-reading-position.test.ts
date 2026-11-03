import { describe, expect, test, vi } from "bun:test";
import { Book } from "epubjs";
import Packaging from "epubjs/src/packaging.js";
import { parse } from "epubjs/src/utils/core.js";
import {
  createEpubPositionSession,
  epubLocationCfi,
  isEpubCfi,
  resolveEpubCfi,
  type EpubPositionStore,
} from "../src/epub/readingPosition";

const first = "epubcfi(/6/2!/4/2/1:0)";
const middle = "epubcfi(/6/2!/4/2/1:6)";
const later = "epubcfi(/6/2!/4/2/1:12)";

function memoryStore() {
  const records = new Map<string, { cfi: string }>();
  const writes: { path: string; cfi: string }[] = [];
  const storage: EpubPositionStore = {
    async load(path) { return records.get(path) ?? null; },
    async save(path, position) {
      records.set(path, position);
      writes.push({ path, cfi: position.cfi });
    },
  };
  return { records, writes, storage };
}

function positionBook() {
  const book = new Book();
  const packaging = new Packaging();
  packaging.parse(parse(`<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
    <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Positions</dc:title></metadata>
    <manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/></manifest>
    <spine><itemref idref="one"/></spine></package>`, "application/oebps-package+xml"));
  book.spine.unpack(packaging, (href: string) => `https://clio.test/${href}`, (href: string) => href);
  // Supply a real chapter DOM to epub.js's actual spine, CFI parser, and getRange implementation.
  book.load = async () => parse(`<html xmlns="http://www.w3.org/1999/xhtml"><head><title>One</title></head><body><p>Alpha beta gamma delta.</p></body></html>`, "application/xhtml+xml");
  return book;
}

const fail = (cause: unknown) => { throw cause; };

describe("EPUB CFI validation and restoration", () => {
  test("saves a valid location and resolves it against the reopened book", async () => {
    const { storage, records } = memoryStore();
    const reader = createEpubPositionSession("/books/one.epub", fail, storage);
    reader.start(first);
    reader.update(middle);
    await reader.close();
    expect(records.get("/books/one.epub")).toEqual({ cfi: middle });
    const reopened = createEpubPositionSession("/books/one.epub", fail, storage);
    const restored = await resolveEpubCfi(positionBook(), await reopened.load());
    expect(restored).toBe(middle);
    const range = await positionBook().getRange(restored!);
    expect(range.startContainer.textContent).toBe("Alpha beta gamma delta.");
    expect(range.startOffset).toBe(6);
    // A reflowed spread can start before the restored target; do not replace
    // that target merely because the document is closed without navigating.
    reopened.start(restored, first);
    reopened.update(first);
    await reopened.close();
    expect(records.get("/books/one.epub")).toEqual({ cfi: middle });
  });

  test("missing, malformed, and obsolete CFIs have no restoration target", async () => {
    const { storage, records } = memoryStore();
    const reader = createEpubPositionSession("/books/invalid.epub", fail, storage);
    expect(await reader.load()).toBeNull();
    for (const cfi of ["", "one.xhtml", "epubcfi()", "epubcfi(/6/NaN!/4/2/1:0)", "epubcfi(/6/2!/4/2/1:-1)"]) {
      records.set("/books/invalid.epub", { cfi });
      expect(await reader.load()).toBeNull();
      expect(isEpubCfi(cfi)).toBe(false);
    }
    const book = positionBook();
    for (const cfi of ["epubcfi(/6/200!/4/2/1:0)", "epubcfi(/6/2[removed]!/4/2/1:0)", "epubcfi(/6/2!/4/200/1:0)"]) {
      expect(await resolveEpubCfi(book, cfi)).toBeNull();
    }
    expect(epubLocationCfi(book, { start: { cfi: "epubcfi(/6/200!/4/2/1:0)" } })).toBeNull();
    await reader.close();
  });

  test("different canonical paths keep independent positions", async () => {
    const { storage } = memoryStore();
    const a = createEpubPositionSession("/first/book.epub", fail, storage);
    const b = createEpubPositionSession("/second/book.epub", fail, storage);
    a.start(first);
    b.start(first);
    a.update(middle);
    b.update(later);
    await Promise.all([a.close(), b.close()]);
    expect(await createEpubPositionSession("/first/book.epub", fail, storage).load()).toBe(middle);
    expect(await createEpubPositionSession("/second/book.epub", fail, storage).load()).toBe(later);
  });
});

describe("EPUB position lifecycle", () => {
  test("close flushes the latest position before the debounce and ignores late events", async () => {
    const { storage, records, writes } = memoryStore();
    const reader = createEpubPositionSession("/books/close.epub", fail, storage);
    reader.update(later); // Initial/restore events must not be persisted.
    await reader.flush();
    expect(records.has("/books/close.epub")).toBe(false);
    reader.start(first);
    reader.update(middle);
    reader.update(later);
    expect(writes).toEqual([]);
    await reader.close();
    reader.update(first);
    await reader.flush();
    expect(records.get("/books/close.epub")).toEqual({ cfi: later });
    expect(writes).toEqual([{ path: "/books/close.epub", cfi: later }]);
  });

  test("reopening waits for an old in-flight save and newer writes cannot be overtaken", async () => {
    const { storage, records, writes } = memoryStore();
    const gate = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const slowStore: EpubPositionStore = {
      ...storage,
      async save(path, position) {
        if (position.cfi === middle) {
          started.resolve();
          await gate.promise;
        }
        await storage.save(path, position);
      },
    };
    const old = createEpubPositionSession("/books/race.epub", fail, slowStore);
    old.start(first);
    old.update(middle);
    const oldSave = old.close();
    await started.promise;
    const next = createEpubPositionSession("/books/race.epub", fail, slowStore);
    let loaded = false;
    const load = next.load().then((value) => { loaded = true; return value; });
    next.start(middle);
    next.update(later);
    const newSave = next.close();
    await Promise.resolve();
    expect(loaded).toBe(false);
    expect(writes).toEqual([]);
    gate.resolve();
    await Promise.all([oldSave, newSave, load]);
    expect(await load).toBe(middle);
    expect(records.get("/books/race.epub")).toEqual({ cfi: later });
    expect(writes).toEqual([
      { path: "/books/race.epub", cfi: middle },
      { path: "/books/race.epub", cfi: later },
    ]);
    old.update(first);
    await old.flush();
    expect(records.get("/books/race.epub")).toEqual({ cfi: later });
  });

  test("mode changes preserve the anchor and reject intermediate reflow locations", async () => {
    const { storage, records, writes } = memoryStore();
    const reader = createEpubPositionSession("/books/reflow.epub", fail, storage);
    reader.start(first);
    reader.update(middle);
    const gate = Promise.withResolvers<string | null>();
    const reflow = reader.preserve(middle, () => gate.promise);
    reader.update(first);
    reader.update("not a CFI");
    await reader.flush();
    expect(records.get("/books/reflow.epub")).toEqual({ cfi: middle });
    gate.resolve(first);
    await reflow;
    expect(reader.capture(first)).toBe(middle);
    await reader.preserve(reader.capture(first), async () => first);
    reader.update(first);
    await reader.close();
    expect(writes).toEqual([{ path: "/books/reflow.epub", cfi: middle }]);
  });

  test("closing during reflow cannot re-enable an old document's delayed saves", async () => {
    const { storage, records } = memoryStore();
    const reader = createEpubPositionSession("/books/reflow-close.epub", fail, storage);
    reader.start(first);
    reader.update(middle);
    const gate = Promise.withResolvers<string | null>();
    const reflow = reader.preserve(middle, () => gate.promise);
    reader.update(first);
    await reader.close();
    gate.resolve(first);
    await reflow;
    reader.update(later);
    await reader.flush();
    expect(records.get("/books/reflow-close.epub")).toEqual({ cfi: middle });
  });

  test("continuous relocation bursts debounce and repeated locations do not rewrite", async () => {
    vi.useFakeTimers();
    const { storage, records, writes } = memoryStore();
    const saved = Promise.withResolvers<void>();
    const reader = createEpubPositionSession("/books/scroll.epub", fail, {
      ...storage,
      async save(path, position) {
        await storage.save(path, position);
        saved.resolve();
      },
    });
    try {
      reader.start(first);
      for (let i = 1; i <= 100; i++) reader.update(`epubcfi(/6/2!/4/2/1:${i})`);
      vi.advanceTimersByTime(699);
      expect(writes).toEqual([]);
      vi.advanceTimersByTime(1);
      await saved.promise;
      expect(records.get("/books/scroll.epub")).toEqual({ cfi: "epubcfi(/6/2!/4/2/1:100)" });
      reader.update("epubcfi(/6/2!/4/2/1:100)");
      await reader.close();
      expect(writes).toEqual([{ path: "/books/scroll.epub", cfi: "epubcfi(/6/2!/4/2/1:100)" }]);
    } finally {
      await reader.close();
      vi.useRealTimers();
    }
  });

  test("a failed write reports the error without poisoning later saves", async () => {
    const { storage, records } = memoryStore();
    const errors: unknown[] = [];
    let failed = false;
    const reader = createEpubPositionSession("/books/error.epub", (cause) => errors.push(cause), {
      ...storage,
      async save(path, position) {
        if (!failed) { failed = true; throw new Error("Disk full"); }
        await storage.save(path, position);
      },
    });
    reader.start(first);
    reader.update(middle);
    await reader.flush();
    reader.update(later);
    await reader.close();
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe("Disk full");
    expect(records.get("/books/error.epub")).toEqual({ cfi: later });
  });
});
