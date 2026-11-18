import type { TOCItem, View } from "foliate-js/view.js";
import { compare } from "foliate-js/epubcfi.js";

type Target = { index: number; anchor?: (doc: Document) => Range | Element | number | null | undefined };
type Entry = { label: string; depth: number; href: string; target: Target };
type Point = { entry: Entry; cfi: string };

// Index navigation once per Book. Live-document caches retain only CFI strings,
// never a strong reference to a retired publication Document or its nodes.
export function createFoliateStatusLabeler(view: View): (cfi: string) => string {
  const { book } = view;
  const sections = new Map<number, Entry[]>();
  const roots: { label: string; structural: boolean; first: Entry | undefined }[] = [];
  const points = new WeakMap<Document, Point[]>();
  const visit = (item: TOCItem, depth: number): Entry | undefined => {
    let first: Entry | undefined;
    const hasHref = typeof item.href === "string" && !!item.href;
    if (hasHref) {
      const target = view.resolveNavigation(item.href);
      if (target && Number.isInteger(target.index) && target.index >= 0 && target.index < book.sections.length) {
        const entry = { label: item.label?.trim() ?? "", depth, href: item.href, target };
        const entries = sections.get(target.index);
        if (entries) entries.push(entry);
        else sections.set(target.index, [entry]);
        first = entry;
      }
    }
    for (const child of item.subitems ?? []) {
      const descendant = visit(child, depth + 1);
      if (!hasHref) first ??= descendant;
    }
    return first;
  };
  for (const item of book.toc ?? []) roots.push({
    label: item.label?.trim() ?? "", structural: !item.href, first: visit(item, 0),
  });
  const orderedRoots = roots.every((root, index) => root.first &&
    (index === 0 || root.first.target.index > roots[index - 1]!.first!.target.index));

  const documentPoints = (doc: Document, index: number): Point[] => {
    const cached = points.get(doc);
    if (cached) return cached;
    const result: Point[] = [];
    for (const entry of sections.get(index) ?? []) {
      if (!entry.label) continue;
      try {
        const anchor = entry.target.anchor?.(doc);
        if (anchor == null) continue; // A missing fragment is not section start.
        const range = doc.createRange();
        if (typeof anchor === "number") range.selectNodeContents(doc.body);
        else if ("startContainer" in anchor) {
          range.setStart(anchor.startContainer, anchor.startOffset);
          range.setEnd(anchor.endContainer, anchor.endOffset);
        } else range.selectNodeContents(anchor);
        range.collapse(true);
        result.push({ entry, cfi: view.getCFI(index, range) });
      } catch {
        // Unresolvable publication destinations cannot supply a status label.
      }
    }
    points.set(doc, result);
    return result;
  };

  return cfi => {
    let index: number;
    try { index = view.resolveCFI(cfi).index; }
    catch { return "EPUB"; }
    if (!Number.isInteger(index) || index < 0 || index >= book.sections.length) return "EPUB";
    const fallback = `Section ${index + 1}`;
    const live = view.renderer.getContents();
    const doc = live.find(content => content.index === index)?.doc;
    let selected: Point | undefined;
    if (doc) {
      for (const point of documentPoints(doc, index)) {
        if (compare(point.cfi, cfi) > 0) continue;
        const order = selected ? compare(point.cfi, selected.cfi) : 1;
        // Equal-boundary aliases prefer depth, then the first navigation entry.
        if (order > 0 || (order === 0 && point.entry.depth > selected!.entry.depth)) selected = point;
      }
    }
    if (selected) return selected.entry.label;
    if (!orderedRoots || book.sections[index]!.linear === "no") return fallback;
    // Fragment-based structural starts must actually resolve in their own live
    // document before they can justify a cross-file range.
    for (const root of roots) {
      if (!root.first!.href.includes("#")) continue;
      const startDoc = live.find(content => content.index === root.first!.target.index)?.doc;
      if (!startDoc || !documentPoints(startDoc, root.first!.target.index).some(point => point.entry === root.first)) return fallback;
    }
    for (let i = 0; i < roots.length; i++) {
      const root = roots[i]!;
      const start = root.first!.target.index;
      const end = roots[i + 1]?.first?.target.index ?? book.sections.length;
      if (root.label && index === start && (root.structural || !root.first!.href.includes("#"))) return root.label;
      if (root.label && index > start && index < end) return `${root.label} · ${fallback}`;
    }
    return fallback;
  };
}
