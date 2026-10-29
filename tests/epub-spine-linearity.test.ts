import { describe, expect, test } from "bun:test";
import {
  findAdjacentLinearSection,
  normalizeSpineLinear,
  type SpineSection,
} from "../src/epub/EpubReader";
import Packaging from "epubjs/src/packaging.js";
import Spine from "epubjs/src/spine.js";
import Section from "epubjs/src/section.js";
import { parse } from "epubjs/src/utils/core.js";

describe("EPUB spine linearity ingestion normalizer (normalizeSpineLinear)", () => {
  test("preserves boolean linear values", () => {
    expect(normalizeSpineLinear(true)).toBe(true);
    expect(normalizeSpineLinear(false)).toBe(false);
  });

  test("normalizes string linear values from OPF package items", () => {
    expect(normalizeSpineLinear("yes")).toBe(true);
    expect(normalizeSpineLinear("no")).toBe(false);
    expect(normalizeSpineLinear("YES")).toBe(true);
    expect(normalizeSpineLinear("NO")).toBe(false);
    expect(normalizeSpineLinear(" yes ")).toBe(true);
  });

  test("defaults missing or undefined linear attribute to linear (EPUB 3.3 § 3.4.1.2)", () => {
    expect(normalizeSpineLinear(undefined)).toBe(true);
  });

  test("treats malformed string linear attributes as non-linear", () => {
    expect(normalizeSpineLinear("false")).toBe(false);
    expect(normalizeSpineLinear("0")).toBe(false);
    expect(normalizeSpineLinear("")).toBe(false);
  });
});

describe("Sequential navigation reading-order logic (findAdjacentLinearSection)", () => {
  test("skips non-linear spine sections in forward and reverse navigation", () => {
    const spine: SpineSection[] = [
      { index: 0, href: "cover.xhtml", linear: true },
      { index: 1, href: "ch1.xhtml", linear: true },
      { index: 2, href: "appendix.xhtml", linear: false },
      { index: 3, href: "notes.xhtml", linear: false },
      { index: 4, href: "ch2.xhtml", linear: true },
      { index: 5, href: "glossary.xhtml", linear: false },
    ];

    // From Chapter 1 (index 1), forward should skip appendix (2) and notes (3) to Chapter 2 (4)
    const nextFromCh1 = findAdjacentLinearSection(spine, 1, 1);
    expect(nextFromCh1?.index).toBe(4);
    expect(nextFromCh1?.href).toBe("ch2.xhtml");

    // From Chapter 2 (index 4), backward should skip notes (3) and appendix (2) to Chapter 1 (1)
    const prevFromCh2 = findAdjacentLinearSection(spine, 4, -1);
    expect(prevFromCh2?.index).toBe(1);
    expect(prevFromCh2?.href).toBe("ch1.xhtml");
  });

  test("navigates to next linear item when currently on a non-linear item", () => {
    const spine: SpineSection[] = [
      { index: 0, href: "ch1.xhtml", linear: true },
      { index: 1, href: "notes.xhtml", linear: false },
      { index: 2, href: "ch2.xhtml", linear: true },
    ];

    // User followed link/TOC to non-linear notes (index 1).
    // Pressing next should advance to ch2 (index 2).
    const nextFromNotes = findAdjacentLinearSection(spine, 1, 1);
    expect(nextFromNotes?.index).toBe(2);

    // Pressing prev should go to ch1 (index 0).
    const prevFromNotes = findAdjacentLinearSection(spine, 1, -1);
    expect(prevFromNotes?.index).toBe(0);
  });

  test("skips items with empty or whitespace-only hrefs", () => {
    const spine: SpineSection[] = [
      { index: 0, href: "ch1.xhtml", linear: true },
      { index: 1, href: "", linear: true },
      { index: 2, href: "   ", linear: true },
      { index: 3, href: "ch2.xhtml", linear: true },
    ];

    const next = findAdjacentLinearSection(spine, 0, 1);
    expect(next?.index).toBe(3);
    expect(next?.href).toBe("ch2.xhtml");
  });

  test("returns null when no linear sections remain in navigation direction", () => {
    const spine: SpineSection[] = [
      { index: 0, href: "ch1.xhtml", linear: true },
      { index: 1, href: "notes.xhtml", linear: false },
    ];
    expect(findAdjacentLinearSection(spine, 0, 1)).toBeNull();
    expect(findAdjacentLinearSection(spine, 0, -1)).toBeNull();
    expect(findAdjacentLinearSection(spine, 99, 1)).toBeNull();
  });
});

describe("Fallback chapter generation logic", () => {
  test("filters out non-linear entries and generates clean chapter list", () => {
    const rawSpine = [
      { index: 0, href: "ch1.xhtml", linear: true },
      { index: 1, href: "ad.xhtml", linear: false },
      { index: 2, href: "notes.xhtml", linear: "no" },
      { index: 3, href: "ch2.xhtml", linear: "yes" },
      { index: 4, href: "ch3.xhtml", linear: undefined },
      { index: 5, href: "   ", linear: true }, // invalid href
    ];

    // Simulate ingestion boundary normalization
    const spine: SpineSection[] = rawSpine.map((item) => ({
      index: item.index,
      href: item.href,
      linear: normalizeSpineLinear(item.linear),
    }));

    const fallbackChapters = spine
      .filter((section) => section.linear && typeof section.href === "string" && section.href.trim())
      .map((section) => ({ href: section.href.trim(), label: `Section ${section.index + 1}`, depth: 0 }));

    expect(fallbackChapters).toEqual([
      { href: "ch1.xhtml", label: "Section 1", depth: 0 },
      { href: "ch2.xhtml", label: "Section 4", depth: 0 },
      { href: "ch3.xhtml", label: "Section 5", depth: 0 },
    ]);
  });
});

describe("Upstream epubjs linearity handling audit", () => {
  test("Packaging parses OPF linear attribute as 'yes' | 'no' strings", () => {
    const opfXml = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Test</dc:title></metadata>
  <manifest>
    <item id="s1" href="s1.xhtml" media-type="application/xhtml+xml"/>
    <item id="s2" href="s2.xhtml" media-type="application/xhtml+xml"/>
    <item id="s3" href="s3.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="s1" linear="yes"/>
    <itemref idref="s2" linear="no"/>
    <itemref idref="s3"/>
  </spine>
</package>`;

    const pkg = new Packaging();
    pkg.parse(parse(opfXml, "application/oebps-package+xml"));

    expect(pkg.spine[0].linear).toBe("yes");
    expect(pkg.spine[1].linear).toBe("no");
    expect(pkg.spine[2].linear).toBe("yes"); // Omitted defaults to "yes"
  });

  test("Section constructor converts linear attribute 'yes' to boolean true and 'no' to false", () => {
    const secLinear = new Section({ idref: "s1", linear: "yes" } as unknown as Parameters<typeof Section>[0], undefined);
    const secNonLinear = new Section({ idref: "s2", linear: "no" } as unknown as Parameters<typeof Section>[0], undefined);
    const secOmitted = new Section({ idref: "s3" } as unknown as Parameters<typeof Section>[0], undefined);

    expect(secLinear.linear).toBe(true);
    expect(typeof secLinear.linear).toBe("boolean");

    expect(secNonLinear.linear).toBe(false);
    expect(typeof secNonLinear.linear).toBe("boolean");

    expect(secOmitted.linear).toBe(false); // undefined === "yes" is false
  });

  test("Spine unpack creates Section instances where linear is boolean", () => {
    const opfXml = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Test</dc:title></metadata>
  <manifest>
    <item id="s1" href="s1.xhtml" media-type="application/xhtml+xml"/>
    <item id="s2" href="s2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="s1" linear="yes"/>
    <itemref idref="s2" linear="no"/>
  </spine>
</package>`;

    const pkg = new Packaging();
    pkg.parse(parse(opfXml, "application/oebps-package+xml"));
    const spine = new Spine();
    spine.unpack(pkg, (href: string) => href, (href: string) => href);

    const items: Array<{ href: string; linear: boolean }> = [];
    spine.each((section: { href: string; linear: boolean }) => {
      items.push({ href: section.href, linear: section.linear });
    });
    expect(items).toEqual([
      { href: "s1.xhtml", linear: true },
      { href: "s2.xhtml", linear: false },
    ]);
  });
});
