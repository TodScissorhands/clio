import { describe, expect, test } from "bun:test";
import {
  buildPageSearchIndex,
  findPageMatchesInIndex,
  getWrappedMatchIndex,
  normalizeSearchQuery,
  searchPageIndexes,
} from "../src/pdf/searchIndex";
import type { PdfPageSearchIndex, PdfSearchTextItem } from "../src/pdf/searchIndex";

function item(
  str: string,
  options: { x?: number; y?: number; width?: number; dir?: string; hasEOL?: boolean } = {},
): PdfSearchTextItem {
  const x = options.x ?? 0;
  const y = options.y ?? 100;
  return {
    str,
    dir: options.dir ?? "ltr",
    transform: [1, 0, 0, 10, x, y],
    width: options.width ?? str.length * 10,
    height: 10,
    fontName: "test-font",
    hasEOL: options.hasEOL ?? false,
  };
}

describe("PDF search index", () => {
  test("normalizes compatibility characters, soft hyphens, and whitespace", () => {
    expect(normalizeSearchQuery("  ＣＬＩＯ\u00ad   Reader\n" )).toBe("clio reader");
    const index = buildPageSearchIndex(1, [item("ﬁsh")]);
    expect(index.text).toBe("fish");
    expect(findPageMatchesInIndex(index, "fi")[0]?.segments).toEqual([
      { itemIndex: 0, start: 0, end: 1 },
    ]);
  });

  test("maps a match across PDF text items without highlighting inserted layout gaps", () => {
    const index = buildPageSearchIndex(3, [
      item("Clio", { width: 40 }),
      item("Reader", { x: 50, width: 60 }),
    ]);
    expect(index.text).toBe("clio reader");
    expect(findPageMatchesInIndex(index, "o r")[0]?.segments).toEqual([
      { itemIndex: 0, start: 3, end: 4 },
      { itemIndex: 1, start: 0, end: 1 },
    ]);
  });

  test("maps source spans over removed soft hyphens and finds overlapping occurrences", () => {
    const softHyphen = buildPageSearchIndex(1, [item("co\u00adoperate")]);
    expect(findPageMatchesInIndex(softHyphen, "cooperate")[0]?.segments).toEqual([
      { itemIndex: 0, start: 0, end: 2 },
      { itemIndex: 0, start: 3, end: 10 },
    ]);
    const overlap = buildPageSearchIndex(1, [item("banana")]);
    expect(findPageMatchesInIndex(overlap, "ana").map((match) => match.segments)).toEqual([
      [{ itemIndex: 0, start: 1, end: 4 }],
      [{ itemIndex: 0, start: 3, end: 6 }],
    ]);
  });

  test("keeps page and occurrence order with out-of-order extraction completion", async () => {
    const indexes = Array.from({ length: 10 }, (_, index) =>
      buildPageSearchIndex(index + 1, [item(`token-${index + 1}`)]),
    );
    const batches: number[][] = [];
    const result = await searchPageIndexes(
      indexes.length,
      async (page) => {
        for (let step = (9 - page) % 4; step > 0; step -= 1) await Promise.resolve();
        return indexes[page - 1]!;
      },
      "token",
      () => false,
      (matches) => batches.push(matches.map((match) => match.page)),
    );
    expect(result.map((match) => match.page)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(batches).toEqual([[1, 2, 3, 4, 5, 6, 7, 8], [9, 10]]);
  });

  test("stops before requesting the next batch when cancelled", async () => {
    const requested: number[] = [];
    const batches: number[][] = [];
    let cancelled = false;
    const emptyIndex = (page: number): PdfPageSearchIndex => buildPageSearchIndex(page, [item("token")]);
    const result = await searchPageIndexes(
      20,
      async (page) => {
        requested.push(page);
        return emptyIndex(page);
      },
      "token",
      () => cancelled,
      (matches) => {
        batches.push(matches.map((match) => match.page));
        cancelled = true;
      },
    );
    expect(requested).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(batches).toEqual([[1, 2, 3, 4, 5, 6, 7, 8]]);
    expect(result.map((match) => match.page)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  test("wraps next and previous match navigation", () => {
    expect(getWrappedMatchIndex(2, 1, 3)).toBe(0);
    expect(getWrappedMatchIndex(0, -1, 3)).toBe(2);
    expect(getWrappedMatchIndex(0, 1, 0)).toBe(-1);
  });
});
