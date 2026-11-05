import { describe, expect, test } from "bun:test";
import { Book } from "epubjs";
import type { NavItem } from "epubjs";
import Packaging from "epubjs/src/packaging.js";
import { parse } from "epubjs/src/utils/core.js";
import { createEpubStatusResolver } from "../src/epub/readingStatus";

const filenames = ["one.xhtml", "two.xhtml", "three.xhtml", "four.xhtml", "five.xhtml", "six.xhtml"];
const neutral = { label: "EPUB", page: null, total: null };
const status = (label: string, page: number | null = null, total: number | null = null) => ({ label, page, total });
const cfi = (index: number) => `epubcfi(/6/${(index + 1) * 2}!/4/2/1:0)`;
const item = (href: string, label: string, subitems: NavItem[] = []): NavItem => ({ id: href, href, label, subitems });

function fixture(toc: readonly NavItem[] = [], nonLinear: readonly number[] = []) {
  const book = new Book();
  const packaging = new Packaging();
  packaging.parse(parse(`<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
    <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Status</dc:title></metadata>
    <manifest>${filenames.map((href, index) => `<item id="section-${index}" href="${href}" media-type="application/xhtml+xml"/>`).join("")}</manifest>
    <spine>${filenames.map((_, index) => `<itemref idref="section-${index}" linear="${nonLinear.includes(index) ? "no" : "yes"}"/>`).join("")}</spine>
  </package>`, "application/oebps-package+xml"));
  book.spine.unpack(packaging, (href: string) => `https://clio.test/${href}`, (href: string) => href);
  const spine = filenames.map((href, index) => ({ index, href, linear: !nonLinear.includes(index) }));
  return { book, spine, resolver: createEpubStatusResolver(book, toc, spine) };
}

function location(index: number, page = 2, total = 9) {
  return { start: { cfi: cfi(index), index, href: filenames[index], displayed: { page, total } } };
}

describe("EPUB status section identity", () => {
  test("missing and malformed locations never retain another section's status", () => {
    const { resolver } = fixture([item("one.xhtml", "Opening")]);
    expect(resolver.read(location(0), [], true)).toEqual(status("Opening", 2, 9));
    for (const value of [undefined, null, false, 2, "one.xhtml", [], {}, { start: null }, { start: [] }, { start: {} }, { start: { displayed: { page: 1, total: 2 } } }]) {
      expect(resolver.read(value, [], true)).toEqual(neutral);
    }
  });

  test("no navigation uses the actual supplied spine ordinal, never Chapter", () => {
    const { book, spine, resolver } = fixture();
    expect(resolver.chapters).toEqual([]);
    expect(resolver.read(location(2), [], true)).toEqual(status("Section 3", 2, 9));
    const selectedSpine = createEpubStatusResolver(book, [], [spine[0], spine[2], spine[5]]);
    expect(selectedSpine.read(location(2), [], false)).toEqual(status("Section 2"));
    expect(selectedSpine.read(location(1), [], true)).toEqual(neutral);
  });

  test("CFI, integer index and resolvable href can each identify a current section", () => {
    const { resolver } = fixture([item("two.xhtml", "Second")]);
    for (const start of [
      { cfi: cfi(1) },
      { index: 1 },
      { href: "two.xhtml#passage" },
      { cfi: "malformed", index: 1 },
      { cfi: cfi(50), href: "two.xhtml" },
      { index: "1", href: "two.xhtml" },
      { index: NaN, href: "two.xhtml" },
      { index: 1.5, href: "two.xhtml" },
      { cfi: "epubcfi(/6/4[removed]!/4/2/1:0)", href: "two.xhtml" },
    ]) {
      expect(resolver.read({ start }, [], true)).toEqual(status("Second"));
    }
  });

  test("contradictory valid identities reject both labels and numbers", () => {
    const { resolver } = fixture([item("one.xhtml", "First"), item("two.xhtml", "Second")]);
    for (const start of [
      { cfi: cfi(0), index: 1 },
      { cfi: cfi(0), href: "two.xhtml" },
      { index: 0, href: "two.xhtml" },
      { cfi: cfi(0), index: 0, href: "two.xhtml" },
    ]) {
      expect(resolver.read({ start: { ...start, displayed: { page: 1, total: 4 } } }, [], true)).toEqual(neutral);
    }
  });

  test("unresolvable and invalid identities cannot lend credibility to page fields", () => {
    const { resolver } = fixture();
    for (const start of [
      { cfi: cfi(90) }, { cfi: "epubcfi()" }, { cfi: "epubcfi(/6/2[foreign]!/4/2/1:0)" },
      { index: -1 }, { index: Infinity }, { index: 0.5 }, { index: "0" },
      { href: "missing.xhtml" }, { href: "https://example.com/one.xhtml" },
    ]) {
      expect(resolver.read({ start: { ...start, displayed: { page: 1, total: 4 } } }, [], true)).toEqual(neutral);
    }
  });
});

describe("EPUB section-local pagination", () => {
  test("only paired valid integer counts in a paged identified section are published", () => {
    const { resolver } = fixture();
    expect(resolver.read(location(0, 1, 1), [], true)).toEqual(status("Section 1", 1, 1));
    expect(resolver.read(location(0, 9, 9), [], true)).toEqual(status("Section 1", 9, 9));
    const invalid = [
      {}, { page: 1 }, { total: 9 }, { page: 0, total: 9 }, { page: -1, total: 9 },
      { page: 10, total: 9 }, { page: 1, total: 0 }, { page: 1.5, total: 9 },
      { page: 1, total: 9.5 }, { page: NaN, total: 9 }, { page: 1, total: NaN },
      { page: Infinity, total: Infinity }, { page: 1, total: Infinity },
      { page: "1", total: 9 }, { page: 1, total: "9" }, { page: true, total: 9 },
      null, [], "1 / 9",
    ];
    for (const displayed of invalid) {
      expect(resolver.read({ start: { index: 0, displayed } }, [], true)).toEqual(status("Section 1"));
    }
  });

  test("continuous slices, percentages, print labels and end pages are not publication pages", () => {
    const { resolver } = fixture();
    expect(resolver.read(location(0), [], false)).toEqual(status("Section 1"));
    expect(resolver.read({
      start: { index: 0, percentage: 0.5, location: 40, page: "xii" },
      end: { index: 0, displayed: { page: 2, total: 9 } },
      displayed: { page: 2, total: 9 },
    }, [], true)).toEqual(status("Section 1"));
  });
});

describe("EPUB navigation labels and conservative fallbacks", () => {
  test("palette retains depth-first navigable destinations and its own fallback numbering", () => {
    const malformed = [null, 42, { href: false, label: false }] as unknown as NavItem[];
    const { resolver } = fixture([
      item("", "Part", [
        item("one.xhtml", "  Opening  "),
        item("missing.xhtml", "Skip", [item("two.xhtml", "  ")]),
        ...malformed,
      ]),
      item("three.xhtml#bad%XX", ""),
      item("four.xhtml", "After"),
    ]);
    expect(resolver.chapters).toEqual([
      { href: "one.xhtml", label: "Opening", depth: 1 },
      { href: "two.xhtml", label: "Chapter 2", depth: 2 },
      { href: "three.xhtml#bad%XX", label: "Chapter 3", depth: 0 },
      { href: "four.xhtml", label: "After", depth: 0 },
    ]);
    expect(resolver.read(location(1), [], true)).toEqual(status("Skip", 2, 9));
    expect(resolver.read(location(2), [], true)).toEqual(status("Section 3", 2, 9));
  });

  test("unusable navigation and blank labels never invent status chapter numbers", () => {
    const { resolver } = fixture([
      item("https://example.com/one.xhtml", "External"),
      item("missing.xhtml", "Gone"),
      item("one.xhtml#bad%XX", "Invalid fragment"),
      item("one.xhtml", "  "),
    ]);
    expect(resolver.read(location(0), [], true)).toEqual(status("Section 1", 2, 9));
    expect(resolver.read(location(1), [], true)).toEqual(status("Section 2", 2, 9));
  });

  test("a fragment destination is not assumed to label the start of its section", () => {
    const { resolver } = fixture([item("one.xhtml#later", "Later passage")]);
    expect(resolver.read({ start: { index: 0 } }, [], true)).toEqual(status("Section 1"));
    expect(resolver.read(location(0), [], true)).toEqual(status("Section 1", 2, 9));
  });

  test("ambiguous sibling fragments have no arbitrary first or last label without a CFI", () => {
    const { resolver } = fixture([item("one.xhtml#alpha", "Alpha"), item("one.xhtml#beta", "Beta")]);
    expect(resolver.read({ start: { index: 0 } }, [], false)).toEqual(status("Section 1"));
  });

  test("a structural common labeled ancestor survives missing navigable parent href", () => {
    const { resolver } = fixture([item("", "Part & <One>", [
      item("one.xhtml#alpha", "Alpha"), item("one.xhtml#beta", "Beta"),
    ])]);
    expect(resolver.read({ start: { href: "one.xhtml" } }, [], false)).toEqual(status("Part & <One>"));
    expect(resolver.read(location(0), [], true)).toEqual(status("Part & <One>", 2, 9));
  });

  test("a unique real fragmentless label is usable without a CFI", () => {
    const { resolver } = fixture([item("one.xhtml", "Whole section", [item("one.xhtml#part", "Part")])]);
    expect(resolver.read({ start: { index: 0 } }, [], false)).toEqual(status("Whole section"));
  });

  test("section-start aliases prefer deeper entries, then the first original entry", () => {
    const deep = fixture([item("one.xhtml", "Parent", [
      item("one.xhtml", "First child"), item("one.xhtml", "Second child"),
    ])]).resolver;
    expect(deep.read(location(0), [], true)).toEqual(status("First child", 2, 9));
    expect(deep.read({ start: { index: 0 } }, [], false)).toEqual(status("Parent"));
    const flat = fixture([item("one.xhtml", "First alias"), item("one.xhtml", "Second alias")]).resolver;
    expect(flat.read(location(0), [], true)).toEqual(status("First alias", 2, 9));
    expect(flat.read({ start: { index: 0 } }, [], false)).toEqual(status("Section 1"));
  });

  test("ordered top-level groups inherit only across linear gaps and preserve direct labels", () => {
    const { resolver } = fixture([
      item("one.xhtml", "Parent", [item("three.xhtml", "Direct child")]),
      item("five.xhtml", "Final group"),
    ], [3]);
    expect(resolver.read(location(0), [], false)).toEqual(status("Parent"));
    expect(resolver.read(location(1), [], true)).toEqual(status("Parent · Section 2", 2, 9));
    expect(resolver.read(location(2), [], false)).toEqual(status("Direct child"));
    expect(resolver.read(location(3), [], false)).toEqual(status("Section 4"));
    expect(resolver.read(location(4), [], false)).toEqual(status("Final group"));
    expect(resolver.read(location(5), [], false)).toEqual(status("Final group · Section 6"));
  });

  test("structural groups can start at their first valid descendant", () => {
    const { resolver } = fixture([
      item("", "Structural part", [item("one.xhtml", "Opening")]),
      item("four.xhtml", "Next"),
    ]);
    expect(resolver.read(location(1), [], false)).toEqual(status("Structural part · Section 2"));
    expect(resolver.read(location(3), [], false)).toEqual(status("Next"));
  });

  test("duplicate, reversed or unresolved group starts disable cross-section guessing", () => {
    for (const toc of [
      [item("one.xhtml", "A"), item("one.xhtml#later", "B")],
      [item("three.xhtml", "A"), item("one.xhtml", "B")],
      [item("one.xhtml", "A"), item("missing.xhtml", "Unresolved")],
      [item("one.xhtml", "A"), item("three.xhtml#bad%XX", "Malformed")],
    ]) {
      const { resolver } = fixture(toc);
      expect(resolver.read(location(1), [], false)).toEqual(status("Section 2"));
      expect(resolver.read(location(5), [], false)).toEqual(status("Section 6"));
    }
  });

  test("blank top-level labels do not become inherited fake chapters", () => {
    const { resolver } = fixture([item("one.xhtml", ""), item("four.xhtml", "Named")]);
    expect(resolver.read(location(1), [], true)).toEqual(status("Section 2", 2, 9));
  });
});
