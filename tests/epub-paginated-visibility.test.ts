import { expect, test } from "bun:test";
import SourceManager from "epubjs/src/managers/default/index.js";
import CompiledManager from "epubjs/lib/managers/default/index.js";

for (const [name, Manager] of [["source", SourceManager], ["compiled", CompiledManager]] as const) {
  test(`${name} paginated reading position excludes a previous chapter's fractional edge`, () => {
    // Observed in native WebKitGTK at scrollLeft=761: the previous chapter's
    // right edge is 0.200012 CSS px, despite the next chapter filling the page.
    const container = { left: 0, right: 761, top: 0, bottom: 805 };
    const manager = Object.assign(Object.create(Manager.prototype), {
      settings: { axis: "horizontal" }, isPaginated: true,
    });
    const previous = { position: () => ({ left: -760.7999877929688, right: 0.20001220703125, top: 0, bottom: 805 }) };
    const current = { position: () => ({ left: 0.20000000298023224, right: 761.2000000029802, top: 0, bottom: 805 }) };
    const next = { position: () => ({ left: 761.2000122070312, right: 1522.2000122070312, top: 0, bottom: 805 }) };
    expect([previous, current, next].filter(view => manager.isVisible(view, 0, 0, container))).toEqual([current]);
    // Genuine CSS-pixel overlap remains visible on either edge (LTR or RTL).
    expect(manager.isVisible({ position: () => ({ left: -760, right: 1 }) }, 0, 0, container)).toBe(true);
    expect(manager.isVisible({ position: () => ({ left: 760, right: 1521 }) }, 0, 0, container)).toBe(true);
    expect(manager.isVisible({ position: () => ({ left: 761, right: 1522 }) }, 0, 0, container)).toBe(false);
    expect(manager.isVisible({ position: () => ({ left: -761, right: 0 }) }, 0, 0, container)).toBe(false);
  });

  test(`${name} reading-position edge normalization leaves scrolling and prefetch unchanged`, () => {
    const container = { left: 0, right: 761, top: 0, bottom: 805 };
    const manager = Object.assign(Object.create(Manager.prototype), {
      settings: { axis: "horizontal" }, isPaginated: true,
    });
    const partial = { position: () => ({ left: -760.8, right: 0.2, top: -804.8, bottom: 0.2 }) };
    expect(manager.isVisible(partial, 1, 1, container)).toBe(true);
    manager.isPaginated = false;
    expect(manager.isVisible(partial, 0, 0, container)).toBe(true);
    manager.isPaginated = true;
    manager.settings.axis = "vertical";
    expect(manager.isVisible(partial, 0, 0, container)).toBe(true);
  });
}
