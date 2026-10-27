export type MatchSegment = { itemIndex: number; start: number; end: number };
export type SearchMatch = { page: number; segments: MatchSegment[] };

export type PdfSearchTextItem = {
  str: string;
  dir: string;
  transform: number[];
  width: number;
  height: number;
  fontName: string;
  hasEOL: boolean;
};

export type PdfPageSearchIndex = {
  page: number;
  text: string;
  itemIndices: Int32Array;
  sourceStarts: Uint32Array;
  sourceEnds: Uint32Array;
};

export function isPdfSearchTextItem(item: unknown): item is PdfSearchTextItem {
  return typeof item === "object" && item !== null && "str" in item &&
    typeof item.str === "string" && "transform" in item && Array.isArray(item.transform);
}

export function normalizeSearchQuery(value: string): string {
  return value.normalize("NFKC").replace(/\u00ad/g, "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

export function buildPageSearchIndex(page: number, items: PdfSearchTextItem[]): PdfPageSearchIndex {
  let text = "";
  const itemIndices: number[] = [];
  const sourceStarts: number[] = [];
  const sourceEnds: number[] = [];
  const append = (value: string, itemIndex: number | null, start: number) => {
    for (let offset = 0; offset < value.length;) {
      const codePoint = value.codePointAt(offset)!;
      const character = String.fromCodePoint(codePoint);
      const end = offset + character.length;
      const normalized = character.normalize("NFKC").replace(/\u00ad/g, "").toLocaleLowerCase();
      for (const normalizedCharacter of normalized) {
        if (/\s/u.test(normalizedCharacter)) {
          if (text && !text.endsWith(" ")) {
            text += " ";
            itemIndices.push(itemIndex ?? -1);
            sourceStarts.push(start + offset);
            sourceEnds.push(start + end);
          }
        } else {
          text += normalizedCharacter;
          for (let index = 0; index < normalizedCharacter.length; index += 1) {
            itemIndices.push(itemIndex ?? -1);
            sourceStarts.push(start + offset);
            sourceEnds.push(start + end);
          }
        }
      }
      offset = end;
    }
  };

  let previous: PdfSearchTextItem | null = null;
  items.forEach((item, itemIndex) => {
    if (previous) {
      const height = Math.max(1, Math.abs(previous.transform[3] ?? previous.height), Math.abs(item.transform[3] ?? item.height));
      const sameLine = Math.abs((previous.transform[5] ?? 0) - (item.transform[5] ?? 0)) <= height * 0.45;
      const gap = item.dir === "rtl"
        ? (previous.transform[4] ?? 0) - ((item.transform[4] ?? 0) + item.width)
        : (item.transform[4] ?? 0) - ((previous.transform[4] ?? 0) + previous.width);
      if (previous.hasEOL || !sameLine || gap > height * 0.18) append(" ", null, 0);
    }
    append(item.str, itemIndex, 0);
    previous = item;
  });
  if (text.endsWith(" ")) {
    text = text.slice(0, -1);
    itemIndices.pop();
    sourceStarts.pop();
    sourceEnds.pop();
  }

  return {
    page,
    text,
    itemIndices: Int32Array.from(itemIndices),
    sourceStarts: Uint32Array.from(sourceStarts),
    sourceEnds: Uint32Array.from(sourceEnds),
  };
}

export function findPageMatchesInIndex(index: PdfPageSearchIndex, query: string): SearchMatch[] {
  if (!query) return [];
  const matches: SearchMatch[] = [];
  for (let from = 0; (from = index.text.indexOf(query, from)) !== -1; from += 1) {
    const segments: MatchSegment[] = [];
    for (let offset = from; offset < from + query.length; offset += 1) {
      const itemIndex = index.itemIndices[offset]!;
      if (itemIndex < 0) continue;
      const start = index.sourceStarts[offset]!;
      const end = index.sourceEnds[offset]!;
      const last = segments[segments.length - 1];
      if (last && last.itemIndex === itemIndex && start <= last.end) {
        last.end = Math.max(last.end, end);
      } else {
        segments.push({ itemIndex, start, end });
      }
    }
    if (segments.length) matches.push({ page: index.page, segments });
  }
  return matches;
}
export async function searchPageIndexes(
  pageCount: number,
  getIndex: (page: number) => Promise<PdfPageSearchIndex>,
  query: string,
  isCancelled: () => boolean,
  onBatch: (matches: SearchMatch[]) => void,
  batchSize = 8,
): Promise<SearchMatch[]> {
  const allMatches: SearchMatch[] = [];
  for (let firstPage = 1; firstPage <= pageCount; firstPage += batchSize) {
    if (isCancelled()) return allMatches;
    const lastPage = Math.min(pageCount, firstPage + batchSize - 1);
    const indexes = await Promise.all(
      Array.from({ length: lastPage - firstPage + 1 }, (_, index) => getIndex(firstPage + index)),
    );
    if (isCancelled()) return allMatches;
    const batchMatches = indexes.flatMap((index) => findPageMatchesInIndex(index, query));
    allMatches.push(...batchMatches);
    if (batchMatches.length) onBatch(batchMatches);
  }
  return allMatches;
}

export function getWrappedMatchIndex(current: number, direction: number, total: number): number {
  return total > 0 ? (current + direction + total) % total : -1;
}
