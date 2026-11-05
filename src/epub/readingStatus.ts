import { EpubCFI } from "epubjs";
import type { Contents, NavItem } from "epubjs";
import type { EpubBook } from "./engine";
import { epubLocationCfi, isEpubCfi } from "./readingPosition";

export type EpubChapterTarget = { href: string; label: string; depth: number };
export type EpubReadingStatus = { label: string; page: number | null; total: number | null };

type Section = { index: number; ordinal: number; linear: boolean; targets: NavigationNode[] };
type Destination = { section: Section; fragment: string | null };
type NavigationNode = {
  label: string;
  depth: number;
  order: number;
  parent: NavigationNode | null;
  target: Destination | null;
  firstTarget: Destination | null;
};
type Boundary = { cfi: string | null; label: string; depth: number; order: number };
type SectionLabels = { starts: Boundary[]; fallback: string | null };
type GroupRange = { start: number; end: number; label: string };

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function internalHref(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 &&
    !/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value.trim());
}

export function createEpubStatusResolver(
  book: EpubBook,
  toc: readonly NavItem[],
  spine: readonly { index: number; href?: string; linear: boolean }[],
): {
  chapters: EpubChapterTarget[];
  read(location: unknown, contents: readonly Contents[], paged: boolean): EpubReadingStatus;
} {
  const chapters: EpubChapterTarget[] = [];
  const sections = new Map<number, Section>();
  for (let ordinal = 0; ordinal < spine.length; ordinal += 1) {
    const item = spine[ordinal];
    if (Number.isInteger(item.index) && item.index >= 0 && !sections.has(item.index)) {
      sections.set(item.index, { index: item.index, ordinal, linear: item.linear, targets: [] });
    }
  }
  const comparator = new EpubCFI();
  const roots: NavigationNode[] = [];
  let order = 0;

  const sectionFor = (target: string | number): Section | null => {
    try {
      const section = book.spine.get(target);
      return section ? sections.get(section.index) ?? null : null;
    } catch {
      return null;
    }
  };
  const destinationFor = (href: string): Destination | null => {
    if (!internalHref(href)) return null;
    const section = sectionFor(href);
    if (!section) return null;
    const hash = href.indexOf("#");
    if (hash < 0 || hash === href.length - 1) return { section, fragment: null };
    try {
      return { section, fragment: decodeURIComponent(href.slice(hash + 1)) };
    } catch {
      return null;
    }
  };

  // One depth-first traversal preserves the existing palette destinations and numbering.
  // Status metadata deliberately never uses the palette's generated Chapter N labels.
  const visit = (entries: readonly unknown[], parent: NavigationNode | null, depth: number): Destination | null => {
    let firstTarget: Destination | null = null;
    for (const entry of entries) {
      const item = record(entry);
      if (!item) continue;
      const href = typeof item.href === "string" ? item.href.trim() : "";
      const label = typeof item.label === "string" ? item.label.trim() : "";
      if (href) {
        try {
          if (book.spine.get(href)) {
            chapters.push({ href, label: label || `Chapter ${chapters.length + 1}`, depth });
          }
        } catch {
          // A malformed destination must not hide its valid descendants.
        }
      }
      const node: NavigationNode = {
        label, depth, order: order++, parent, target: href ? destinationFor(href) : null, firstTarget: null,
      };
      if (!parent) roots.push(node);
      if (node.target) node.target.section.targets.push(node);
      const descendant = visit(Array.isArray(item.subitems) ? item.subitems : [], node, depth + 1);
      node.firstTarget = node.target ?? descendant;
      firstTarget ??= node.firstTarget;
    }
    return firstTarget;
  };
  visit(Array.isArray(toc) ? toc : [], null, 0);

  // Only an unambiguous, ordered navigation tree may imply coverage of another file.
  const ranges: GroupRange[] = [];
  const orderedGroups = roots.length > 0 && roots.every((root, index) =>
    root.firstTarget !== null && (index === 0 ||
      root.firstTarget.section.ordinal > roots[index - 1].firstTarget!.section.ordinal));
  if (orderedGroups) {
    let lastLinear = -1;
    for (const section of sections.values()) {
      if (section.linear) lastLinear = section.ordinal;
    }
    roots.forEach((root, index) => {
      if (!root.label) return;
      ranges.push({
        start: root.firstTarget!.section.ordinal,
        end: index + 1 < roots.length ? roots[index + 1].firstTarget!.section.ordinal - 1 : lastLinear,
        label: root.label,
      });
    });
  }

  const labels = new Map<number, SectionLabels>();
  for (const section of sections.values()) {
    const starts = section.targets
      .filter((node) => node.label && node.target!.fragment === null)
      .map((node): Boundary => ({ cfi: null, label: node.label, depth: node.depth, order: node.order }));
    starts.sort((a, b) => b.depth - a.depth || a.order - b.order);
    const distinctStarts = new Set(starts.map((boundary) => boundary.label));
    let fallback = distinctStarts.size === 1 ? starts[0].label : null;
    if (!fallback && section.targets.length > 0) {
      // A fragment is not a section start. Only a shared labeled ancestor can
      // supply its pre-boundary/no-CFI identity, never that fragment's own label.
      for (let ancestor: NavigationNode | null = section.targets[0]; ancestor; ancestor = ancestor.parent) {
        if (!ancestor.label) continue;
        const candidate = ancestor;
        const common = section.targets.every((node) => {
          for (let parent: NavigationNode | null = node; parent; parent = parent.parent) {
            if (parent === candidate) return true;
          }
          return false;
        });
        // An ancestor's own fragment still needs a real visible boundary.
        if (common && (!ancestor.target || ancestor.target.fragment === null)) {
          fallback = ancestor.label;
          break;
        }
      }
    }
    labels.set(section.index, { starts: starts.slice(0, 1), fallback });
  }

  // The values contain only strings and display metadata; no content/frame/DOM
  // references survive a read. A discarded publication Document can be collected.
  const boundariesByDocument = new WeakMap<Document, { index: number; boundaries: Boundary[] }>();
  const boundariesFor = (section: Section, content: Contents): Boundary[] => {
    const cached = boundariesByDocument.get(content.document);
    if (cached?.index === section.index) return cached.boundaries;
    const boundaries = [...labels.get(section.index)!.starts];
    for (const node of section.targets) {
      const fragment = node.target!.fragment;
      if (!node.label || fragment === null) continue;
      try {
        const element = content.document.getElementById(fragment);
        if (!element) continue;
        const cfi = content.cfiFromNode(element);
        if (!isEpubCfi(cfi) || sectionFor(cfi) !== section) continue;
        boundaries.push({ cfi, label: node.label, depth: node.depth, order: node.order });
      } catch {
        // Missing/malformed publication anchors do not become start boundaries.
      }
    }
    boundaries.sort((a, b) => {
      const position = a.cfi === null ? (b.cfi === null ? 0 : -1)
        : b.cfi === null ? 1 : comparator.compare(a.cfi, b.cfi);
      return position || b.depth - a.depth || a.order - b.order;
    });
    const unique = boundaries.filter((boundary, index) => index === 0 ||
      (boundary.cfi === null ? boundaries[index - 1].cfi !== null :
        boundaries[index - 1].cfi === null || comparator.compare(boundary.cfi, boundaries[index - 1].cfi!) !== 0));
    boundariesByDocument.set(content.document, { index: section.index, boundaries: unique });
    return unique;
  };

  return {
    chapters,
    read(location, contents, paged) {
      const start = record(record(location)?.start);
      if (!start) return { label: "EPUB", page: null, total: null };
      let cfi: string | null = null;
      let cfiSection: Section | null = null;
      try {
        cfi = epubLocationCfi(book, location);
        if (cfi) {
          const parsed = new EpubCFI(cfi);
          const actual = book.spine.get(cfi);
          if (parsed.base.steps[1].id && parsed.base.steps[1].id !== actual.idref) cfi = null;
          else cfiSection = sectionFor(cfi);
        }
      } catch {
        cfi = null;
      }
      const indexSection = typeof start.index === "number" && Number.isInteger(start.index) && start.index >= 0
        ? sectionFor(start.index) : null;
      const hrefSection = internalHref(start.href) ? sectionFor(start.href.trim()) : null;
      const section = cfiSection ?? indexSection ?? hrefSection;
      if (!section || (cfiSection && cfiSection !== section) ||
        (indexSection && indexSection !== section) || (hrefSection && hrefSection !== section)) {
        return { label: "EPUB", page: null, total: null };
      }
      const metadata = labels.get(section.index)!;
      let label: string | null = null;
      if (cfi && cfiSection) {
        const content = contents.find((item) => item.sectionIndex === section.index && item.document);
        const boundaries = content ? boundariesFor(section, content) : metadata.starts;
        // Upper-bound search chooses the last real boundary at/before first-visible CFI.
        let low = 0;
        let high = boundaries.length;
        while (low < high) {
          const middle = (low + high) >>> 1;
          const boundary = boundaries[middle];
          if (boundary.cfi === null || comparator.compare(boundary.cfi, cfi) <= 0) low = middle + 1;
          else high = middle;
        }
        if (low > 0) label = boundaries[low - 1].label;
      }
      label ??= metadata.fallback;
      const sectionLabel = `Section ${section.ordinal + 1}`;
      if (!label && section.linear) {
        const range = ranges.find((group) => section.ordinal > group.start && section.ordinal <= group.end);
        if (range) label = `${range.label} · ${sectionLabel}`;
      }
      label ??= sectionLabel;
      const displayed = record(start.displayed);
      const page = displayed?.page;
      const total = displayed?.total;
      const validPages = paged && typeof page === "number" && Number.isInteger(page) && page >= 1 &&
        typeof total === "number" && Number.isInteger(total) && total >= page;
      return { label, page: validPages ? page : null, total: validPages ? total : null };
    },
  };
}
