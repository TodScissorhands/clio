export type Bookmark = { id: string; cfi: string; cfiModel: "foliate-html-v1"; label: string };
export type BookmarkRow = { key: string; label: string; cfi?: string };
export function bookmarkRows(records: unknown[]): BookmarkRow[] {
  return records.map((record, i) => {
    const value = record && typeof record === "object" ? record as Record<string, unknown> : {};
    const usable = value.cfiModel === "foliate-html-v1" && typeof value.cfi === "string" && /^epubcfi\(\/.+\)$/.test(value.cfi);
    return { key: typeof value.id === "string" ? value.id : `unavailable:${i}`, label: typeof value.label === "string" && value.label.trim() ? value.label : `Bookmark ${i + 1}`, cfi: usable ? value.cfi as string : undefined };
  });
}
