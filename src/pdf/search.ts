import { useCallback, useEffect, useRef, useState } from "react";
import { pdfErrorMessage } from "./engine";

import type { PdfDocument } from "./engine";
import { buildPageSearchIndex, getWrappedMatchIndex, isPdfSearchTextItem, normalizeSearchQuery, searchPageIndexes } from "./searchIndex";
import type { PdfPageSearchIndex, SearchMatch } from "./searchIndex";
export { normalizeSearchQuery } from "./searchIndex";
export type { MatchSegment, PdfPageSearchIndex, PdfSearchTextItem, SearchMatch } from "./searchIndex";

const pageSearchIndexes = new WeakMap<PdfDocument, Map<number, Promise<PdfPageSearchIndex>>>();

function getPageSearchIndex(pdf: PdfDocument, pageNumber: number): Promise<PdfPageSearchIndex> {
  let pages = pageSearchIndexes.get(pdf);
  if (!pages) {
    pages = new Map();
    pageSearchIndexes.set(pdf, pages);
  }
  let index = pages.get(pageNumber);
  if (!index) {
    index = (async () => {
      const content = await (await pdf.getPage(pageNumber)).getTextContent();
      const items = content.items.filter(isPdfSearchTextItem);
      return buildPageSearchIndex(pageNumber, items);
    })();
    pages.set(pageNumber, index);
    void index.catch(() => {
      if (pages?.get(pageNumber) === index) pages.delete(pageNumber);
    });
  }
  return index;
}

export function usePdfSearch(
  pdf: PdfDocument | null,
  onSelectMatch: (match: SearchMatch) => void,
  onError: (message: string) => void,
) {
  const [query, setQueryState] = useState("");
  const [searchedQuery, setSearchedQuery] = useState("");
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [activeMatch, setActiveMatch] = useState(0);
  const [searching, setSearching] = useState(false);
  const searchingRef = useRef(false);
  const generationRef = useRef(0);
  const activeMatchRef = useRef(0);

  useEffect(() => () => {
    generationRef.current += 1;
  }, []);
  const setQuery = useCallback((value: string) => {
    generationRef.current += 1;
    setSearchedQuery("");
    searchingRef.current = false;
    setSearching(false);
    setMatches([]);
    activeMatchRef.current = 0;
    setActiveMatch(0);
    setQueryState(value);
  }, []);

  const cancelSearch = useCallback(() => {
    generationRef.current += 1;
    searchingRef.current = false;
    setSearching(false);
  }, []);

  const clear = useCallback(() => {
    generationRef.current += 1;
    setQueryState("");
    setSearchedQuery("");
    searchingRef.current = false;
    setSearching(false);
    setMatches([]);
    activeMatchRef.current = 0;
    setActiveMatch(0);
  }, []);

  const runSearch = useCallback(async () => {
    if (searchingRef.current) return;
    const searchQuery = normalizeSearchQuery(query);
    const generation = ++generationRef.current;
    setMatches([]);
    activeMatchRef.current = 0;
    setActiveMatch(0);
    setSearchedQuery(searchQuery);
    if (!pdf || !searchQuery) {
      searchingRef.current = false;
      setSearching(false);
      return;
    }
    searchingRef.current = true;
    setSearching(true);
    let selectedFirstMatch = false;
    try {
      const found = await searchPageIndexes(
        pdf.numPages,
        (page) => getPageSearchIndex(pdf, page),
        searchQuery,
        () => generation !== generationRef.current,
        (batch) => {
          if (generation !== generationRef.current) return;
          setMatches((current) => current.concat(batch));
          if (!selectedFirstMatch && batch.length) {
            selectedFirstMatch = true;
            activeMatchRef.current = 0;
            setActiveMatch(0);
            onSelectMatch(batch[0]!);
          }
        },
      );
      if (generation !== generationRef.current) return;
      if (!selectedFirstMatch && found.length) {
        activeMatchRef.current = 0;
        setActiveMatch(0);
        onSelectMatch(found[0]!);
      }
    } catch (cause) {
      if (generation === generationRef.current) onError(`Search failed: ${pdfErrorMessage(cause)}`);
    } finally {
      if (generation === generationRef.current) {
        searchingRef.current = false;
        setSearching(false);
      }
    }
  }, [pdf, query, onSelectMatch, onError]);

  const moveMatch = useCallback((direction: number) => {
    if (searchingRef.current || !matches.length) return;
    const next = getWrappedMatchIndex(activeMatchRef.current, direction, matches.length);
    activeMatchRef.current = next;
    setActiveMatch(next);
    onSelectMatch(matches[next]);
  }, [matches, onSelectMatch]);


  return {
    query,
    setQuery,
    searchedQuery,
    matches,
    activeMatch,
    activeMatchRef,
    searching,
    runSearch,
    moveMatch,
    cancelSearch,
    clear,
  };
}
