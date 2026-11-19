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
  sourceGroupIndices: Int32Array;
  sourceGroupOffsets: Uint32Array;
  sourceItemIndices: Int32Array;
  sourceStarts: Uint32Array;
  sourceEnds: Uint32Array;
};

export function isPdfSearchTextItem(item: unknown): item is PdfSearchTextItem {
  return typeof item === "object" && item !== null && "str" in item &&
    typeof item.str === "string" && "transform" in item && Array.isArray(item.transform);
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function normalizeCompatibility(value: string): string {
  return value.normalize("NFKC").replace(/\u00ad/g, "");
}

export function normalizeSearchQuery(value: string): string {
  return normalizeCompatibility(value).replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

export function buildPageSearchIndex(page: number, items: PdfSearchTextItem[]): PdfPageSearchIndex {
  const chunks: string[] = [];
  const sources: {
    start: number; end: number; itemIndex: number;
    sourceStart: number; sourceEnd: number; group?: number;
  }[] = [];
  let sourceLength = 0;
  const append = (value: string, itemIndex: number) => {
    let offset = 0;
    for (const character of value) {
      // Compatibility decomposition can join formerly separate graphemes
      // (e.g. ㄱㅏ → 가 → 가). Segment only after this decomposition.
      const decomposed = character.normalize("NFKD");
      chunks.push(decomposed);
      sources.push({ start: sourceLength, end: sourceLength + decomposed.length,
        itemIndex, sourceStart: offset, sourceEnd: offset + character.length });
      sourceLength += decomposed.length;
      offset += character.length;
    }
  };

  let previous: PdfSearchTextItem | null = null;
  // PDF.js creates no DOM span for empty EOL items. Segment indices address
  // the nonempty text spans, not those invisible extraction records.
  let renderedItemIndex = 0;
  items.forEach((item) => {
    if (previous) {
      const height = Math.max(1, Math.abs(previous.transform[3] ?? previous.height), Math.abs(item.transform[3] ?? item.height));
      const sameLine = Math.abs((previous.transform[5] ?? 0) - (item.transform[5] ?? 0)) <= height * 0.45;
      const gap = item.dir === "rtl"
        ? (previous.transform[4] ?? 0) - ((item.transform[4] ?? 0) + item.width)
        : (item.transform[4] ?? 0) - ((previous.transform[4] ?? 0) + previous.width);
      if (previous.hasEOL || !sameLine || gap > height * 0.18) append(" ", -1);
    }
    append(item.str, renderedItemIndex);
    if (item.str.length) renderedItemIndex += 1;
    previous = item;
  });

  const source = chunks.join("");
  let text = "";
  let groupIndices: number[] = [];
  const groupOffsets = [0];
  const itemIndices: number[] = [];
  const sourceStarts: number[] = [];
  const sourceEnds: number[] = [];
  let sourceCursor = 0;
  const addRange = (itemIndex: number, start: number, end: number, groupStart: number) => {
    const last = itemIndices.length - 1;
    if (last >= groupStart && itemIndices[last] === itemIndex && start <= sourceEnds[last]!) {
      sourceEnds[last] = Math.max(sourceEnds[last]!, end);
    } else {
      itemIndices.push(itemIndex);
      sourceStarts.push(start);
      sourceEnds.push(end);
    }
  };
  const sourceGroup = (start: number, end: number) => {
    while (sources[sourceCursor] && sources[sourceCursor]!.end <= start) sourceCursor++;
    // A compatibility expansion (ﬁ → fi) retains one original range, shared
    // by all its normalized units rather than copied for every output letter.
    const single = sources[sourceCursor]!;
    const contained = end <= single.end;
    if (contained && single.group !== undefined) return single.group;
    const groupStart = itemIndices.length;
    for (let cursor = sourceCursor; sources[cursor] && sources[cursor]!.start < end; cursor++) {
      const range = sources[cursor]!;
      if (range.itemIndex >= 0) addRange(range.itemIndex, range.sourceStart, range.sourceEnd, groupStart);
    }
    if (itemIndices.length === groupStart) return -1;
    const group = groupOffsets.length - 1;
    groupOffsets.push(itemIndices.length);
    if (contained) single.group = group;
    return group;
  };
  const appendNormalized = (value: string, start: number, end: number) => {
    let group: number | undefined;
    for (const character of value) {
      const whitespace = /\s/u.test(character);
      if (whitespace && (!text || text.endsWith(" "))) continue;
      group ??= sourceGroup(start, end);
      text += whitespace ? " " : character;
      for (let unit = 0; unit < (whitespace ? 1 : character.length); unit++) groupIndices.push(group);
    }
  };
  // After compatibility decomposition, canonical composition is local to an
  // extended grapheme. Keep unchanged code points precise (e.g. emoji/ZWJ);
  // composed graphemes share all contributing original source ranges.
  for (const { segment, index } of graphemes.segment(source)) {
    const normalized = normalizeCompatibility(segment);
    if (normalized === segment) {
      let offset = index;
      for (const character of segment) {
        appendNormalized(character, offset, offset + character.length);
        offset += character.length;
      }
    } else {
      appendNormalized(normalized, index, index + segment.length);
    }
  }
  if (text.endsWith(" ")) {
    text = text.slice(0, -1);
    groupIndices.pop();
  }

  // Lowercase the complete string: Greek final sigma is context-sensitive.
  // Casing preserves grapheme boundaries, but can expand a grapheme (İ → i̇).
  // Transfer provenance by grapheme, retaining precise unit offsets when its
  // length is unchanged and sharing one source group for an expansion.
  const lowered = text.toLocaleLowerCase();
  if (lowered !== text) {
    const before = graphemes.segment(text)[Symbol.iterator]();
    const after = graphemes.segment(lowered)[Symbol.iterator]();
    const loweredGroups: number[] = [];
    while (true) {
      const original = before.next(), result = after.next();
      if (original.done && result.done) break;
      if (original.done || result.done) throw new Error("Unicode casing changed search grapheme boundaries");
      const { index, segment } = original.value;
      if (segment.length === result.value.segment.length) {
        for (let unit = index; unit < index + segment.length; unit++) loweredGroups.push(groupIndices[unit]!);
      } else {
        const groupStart = itemIndices.length;
        let previousGroup = -1;
        for (let unit = index; unit < index + segment.length; unit++) {
          const group = groupIndices[unit]!;
          if (group < 0 || group === previousGroup) continue;
          previousGroup = group;
          for (let range = groupOffsets[group]!; range < groupOffsets[group + 1]!; range++) {
            addRange(itemIndices[range]!, sourceStarts[range]!, sourceEnds[range]!, groupStart);
          }
        }
        const group = itemIndices.length === groupStart ? -1 : groupOffsets.length - 1;
        if (group >= 0) groupOffsets.push(itemIndices.length);
        for (let unit = 0; unit < result.value.segment.length; unit++) loweredGroups.push(group);
      }
    }
    groupIndices = loweredGroups;
  }

  return {
    page,
    text: lowered,
    sourceGroupIndices: Int32Array.from(groupIndices),
    sourceGroupOffsets: Uint32Array.from(groupOffsets),
    sourceItemIndices: Int32Array.from(itemIndices),
    sourceStarts: Uint32Array.from(sourceStarts),
    sourceEnds: Uint32Array.from(sourceEnds),
  };
}

export function findPageMatchesInIndex(index: PdfPageSearchIndex, query: string): SearchMatch[] {
  if (!query) return [];
  const matches: SearchMatch[] = [];
  for (let from = 0; (from = index.text.indexOf(query, from)) !== -1; from += 1) {
    const segments: MatchSegment[] = [];
    let previousGroup = -1;
    for (let offset = from; offset < from + query.length; offset += 1) {
      const group = index.sourceGroupIndices[offset]!;
      if (group < 0 || group === previousGroup) continue;
      previousGroup = group;
      for (let range = index.sourceGroupOffsets[group]!; range < index.sourceGroupOffsets[group + 1]!; range++) {
        const itemIndex = index.sourceItemIndices[range]!;
        const start = index.sourceStarts[range]!;
        const end = index.sourceEnds[range]!;
        const last = segments[segments.length - 1];
        if (last && last.itemIndex === itemIndex && start <= last.end) {
          last.end = Math.max(last.end, end);
        } else {
          segments.push({ itemIndex, start, end });
        }
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
