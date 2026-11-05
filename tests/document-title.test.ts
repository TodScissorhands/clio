import { describe, expect, test } from "bun:test";
import { createDocumentTitleWriter } from "../src/reader/useDocumentTitle";

function deferred() {
  return Promise.withResolvers<void>();
}

describe("serialized document titles", () => {
  test("an old in-flight write settles before the newest title and queued obsolete titles are skipped", async () => {
    const first = deferred();
    const latest = deferred();
    const started = deferred();
    const calls: string[] = [];
    const completed: string[] = [];
    const errors: unknown[] = [];
    let active = 0;
    let maximumActive = 0;
    const write = createDocumentTitleWriter(async (title) => {
      calls.push(title);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      if (title === "A — Clio") {
        started.resolve();
        await first.promise;
      } else {
        await latest.promise;
      }
      completed.push(title);
      active -= 1;
    }, (cause) => errors.push(cause));

    const a = write("A — Clio");
    await started.promise;
    const b = write("B — Clio");
    const c = write("C — Clio");
    expect(calls).toEqual(["A — Clio"]);
    first.resolve();
    await a;
    await b;
    latest.resolve();
    await c;
    expect(calls).toEqual(["A — Clio", "C — Clio"]);
    expect(completed).toEqual(["A — Clio", "C — Clio"]);
    expect(maximumActive).toBe(1);
    expect(errors).toEqual([]);
  });

  test("only the newest request starts when several titles are still queued", async () => {
    const calls: string[] = [];
    const write = createDocumentTitleWriter(async (title) => { calls.push(title); }, () => {});
    await Promise.all([write("A — Clio"), write("B — Clio"), write("Clio")]);
    expect(calls).toEqual(["Clio"]);
  });

  test("a rejected native write reports the error without poisoning the next title", async () => {
    const failed = deferred();
    const started = deferred();
    const cause = new Error("native title denied");
    const calls: string[] = [];
    const errors: unknown[] = [];
    let currentTitle = "Clio";
    const write = createDocumentTitleWriter(async (title) => {
      calls.push(title);
      if (title === "A — Clio") {
        started.resolve();
        await failed.promise;
      }
      currentTitle = title;
    }, (error) => errors.push(error));
    const a = write("A — Clio");
    await started.promise;
    const b = write("B — Clio");
    failed.reject(cause);
    await Promise.all([a, b]);
    expect(errors).toEqual([cause]);
    expect(calls).toEqual(["A — Clio", "B — Clio"]);
    expect(currentTitle).toBe("B — Clio");
    await write("Clio");
    expect(currentTitle).toBe("Clio");
  });
});
