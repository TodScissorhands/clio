import { describe, expect, spyOn, test } from "bun:test";
import {
  DEFAULT_RECOLOR_SETTINGS,
  parseHexColor,
  recolorImageDataCpu,
  recolorImageDataCpuCooperative,
  RecolorShaderRenderer,
  RECOLOR_PRESETS,
} from "../src/pdf/recolor";
import type { CpuRecolorOptions, NormalizedRect } from "../src/pdf/recolor";

const dimensions = [[17, 11], [11, 17], [1, 257], [29, 7]] as const;
const colors = [
  ...Object.values(RECOLOR_PRESETS).map(({ id, darkColor, lightColor }) => ({
    name: id, dark: parseHexColor(darkColor), light: parseHexColor(lightColor),
  })),
  { name: "custom-chromatic", dark: parseHexColor("#0A83F5"), light: parseHexColor("#E83127") },
  { name: "custom-equal-endpoints", dark: parseHexColor("#535353"), light: parseHexColor("#535353") },
];
const outside = { minX: 2, minY: 2, maxX: 3, maxY: 3 };
const full = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
const partial = { minX: 0.25, minY: 0.2, maxX: 0.75, maxY: 0.8 };
const regionFixtures: { name: string; make: (width: number, height: number) => NormalizedRect[] }[] = [
  { name: "0-none", make: () => [] },
  { name: "1-nonmatching", make: () => [outside] },
  { name: "1-full", make: () => [full] },
  { name: "1-partial", make: () => [partial] },
  { name: "16-all-nonmatching", make: () => Array.from({ length: 16 }, () => outside) },
  {
    name: "16-overlapping",
    make: () => Array.from({ length: 16 }, (_, i) => ({
      minX: (i % 4) / 8, minY: (i % 3) / 7,
      maxX: 0.5 + (i % 4) / 8, maxY: 0.6 + (i % 3) / 7,
    })),
  },
  { name: "64-all-nonmatching", make: () => Array.from({ length: 64 }, () => outside) },
  {
    name: "64-inclusive-pixel-boundaries",
    make: (width, height) => [
      ...Array.from({ length: 63 }, () => outside),
      {
        minX: (width > 1 ? 1 : 0) / width, minY: 1 / height,
        maxX: Math.floor(width / 2) / width, maxY: Math.floor(height / 2) / height,
      },
    ],
  },
  { name: "128-all-nonmatching", make: () => Array.from({ length: 128 }, () => outside) },
  {
    name: "128-overlapping",
    make: () => Array.from({ length: 128 }, (_, i) => ({
      minX: (i % 16) / 32, minY: (i % 8) / 16,
      maxX: 0.5 + (i % 16) / 32, maxY: 0.5 + (i % 8) / 16,
    })),
  },
  { name: "128-last-region-matches", make: () => [...Array.from({ length: 127 }, () => outside), full] },
];

function pixels(width: number, height: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  const alpha = [0, 1, 17, 127, 254, 255];
  for (let idx = 0; idx < width * height; idx += 1) {
    // Include neutral endpoints, chromatic/antialiased colors, and hidden RGB
    // under zero alpha. The nonperiodic components expose skipped/repeated pixels.
    data[idx * 4] = idx % 13 === 0 ? 0 : (idx * 37 + 19) % 256;
    data[idx * 4 + 1] = idx % 13 === 0 ? 0 : (idx * 73 + 101) % 256;
    data[idx * 4 + 2] = idx % 13 === 0 ? 0 : (idx * 113 + 251) % 256;
    if (idx % 17 === 0) data.fill(255, idx * 4, idx * 4 + 3);
    data[idx * 4 + 3] = alpha[idx % alpha.length];
  }
  return data;
}

function alphaBytes(data: Uint8ClampedArray): Uint8Array {
  return Uint8Array.from({ length: data.length / 4 }, (_, idx) => data[idx * 4 + 3]);
}

function firstChunkClock() {
  let reads = 0;
  // The first bounded work batch exhausts the first chunk. Later clock
  // reads are constant, so fixtures cross a known boundary without waiting on
  // machine speed or imposing artificial per-pixel overhead on production.
  return spyOn(performance, "now").mockImplementation(() => Math.min(reads++, 2) * 8);
}

const dark = parseHexColor("#DCD7BA");
const light = parseHexColor("#14161B");

function cooperative(data: Uint8ClampedArray, options: CpuRecolorOptions = {}) {
  return recolorImageDataCpuCooperative(data, data.length / 4, 1, dark, light, true, true, false, [], options);
}

describe("cooperative CPU exact-byte equivalence", () => {
  let caseIndex = 0;
  for (const color of colors) {
    for (let flags = 0; flags < 8; flags += 1) {
      for (const fixture of regionFixtures) {
        const [width, height] = dimensions[caseIndex++ % dimensions.length];
        test(`${color.name}, flags=${flags}, ${fixture.name}, ${width}x${height}`, async () => {
          const original = pixels(width, height);
          const expected = original.slice();
          const actual = original.slice();
          const rects = fixture.make(width, height);
          const keephue = Boolean(flags & 1);
          const adjustLightness = Boolean(flags & 2);
          const reverseVideo = Boolean(flags & 4);
          // The accepted full synchronous traversal remains the independent
          // control-flow reference; only the pixel math/byte store is shared.
          recolorImageDataCpu(expected, width, height, color.dark, color.light,
            keephue, adjustLightness, reverseVideo, rects);
          const clock = firstChunkClock();
          try {
            let settled = false;
            const operation = recolorImageDataCpuCooperative(actual, width, height, color.dark, color.light,
              keephue, adjustLightness, reverseVideo, rects).then((complete) => {
                settled = true;
                return complete;
              });
            await Promise.resolve();
            expect(settled).toBe(false);
            expect(await operation).toBe(true);
            expect(actual).toEqual(expected);
            expect(alphaBytes(actual)).toEqual(alphaBytes(original));
          } finally {
            clock.mockRestore();
          }
        });
      }
    }
  }

  test("resumes repeatedly inside an uncapped rectangle list and resets the cursor for each pixel", async () => {
    const width = 3;
    const original = pixels(width, 1);
    const actual = original.slice();
    const expected = original.slice();
    const rects = [
      ...Array.from({ length: 2048 }, () => outside),
      { minX: 1 / width, maxX: 1 / width, minY: 0, maxY: 0 },
    ];
    recolorImageDataCpu(expected, width, 1, dark, light, true, true, true, rects);
    let reads = 0;
    const clock = spyOn(performance, "now").mockImplementation(() => reads++ * 8);
    try {
      expect(await recolorImageDataCpuCooperative(actual, width, 1, dark, light, true, true, true, rects)).toBe(true);
      expect(actual).toEqual(expected);
      expect(actual.slice(4, 8)).toEqual(original.slice(4, 8));
      expect(actual.slice(0, 4)).not.toEqual(original.slice(0, 4));
      expect(actual.slice(8, 12)).not.toEqual(original.slice(8, 12));
      expect(alphaBytes(actual)).toEqual(alphaBytes(original));
    } finally {
      clock.mockRestore();
    }
  });
});

describe("cooperative CPU cancellation and task scheduling", () => {
  test("an already-aborted signal leaves every byte unchanged", async () => {
    const data = pixels(257, 1);
    const original = data.slice();
    const controller = new AbortController();
    controller.abort();
    expect(await cooperative(data, { signal: controller.signal })).toBe(false);
    expect(data).toEqual(original);
  });

  test("a stale request before start leaves every byte unchanged", async () => {
    const data = pixels(257, 1);
    const original = data.slice();
    expect(await cooperative(data, { isCurrent: () => false })).toBe(false);
    expect(data).toEqual(original);
  });

  test("abort during a pending task yield stops mutation and preserves alpha", async () => {
    const data = pixels(257, 1);
    const original = data.slice();
    const originalAlpha = alphaBytes(data);
    const controller = new AbortController();
    const clock = firstChunkClock();
    try {
      const operation = cooperative(data, { signal: controller.signal });
      expect(data.slice(0, 4)).not.toEqual(original.slice(0, 4));
      expect(data.slice(-4)).toEqual(original.slice(-4));
      controller.abort();
      expect(await operation).toBe(false);
      const stopped = data.slice();
      // Exercise a real subsequent platform task, not a duration threshold:
      // cancelled work must not resume from an orphaned queued callback.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(data).toEqual(stopped);
      expect(alphaBytes(data)).toEqual(originalAlpha);
    } finally {
      clock.mockRestore();
    }
  });

  test("isCurrent invalidation during yield discards further CPU work", async () => {
    const data = pixels(257, 1);
    let current = true;
    const clock = firstChunkClock();
    try {
      const operation = cooperative(data, { isCurrent: () => current });
      const stopped = data.slice();
      current = false;
      expect(await operation).toBe(false);
      expect(data).toEqual(stopped);
    } finally {
      clock.mockRestore();
    }
  });

  test("a request guard error rejects instead of reporting completion", async () => {
    const data = pixels(257, 1);
    const error = new Error("request guard failed");
    let checks = 0;
    await expect(cooperative(data, {
      isCurrent: () => {
        if (++checks === 3) throw error;
        return true;
      },
    })).rejects.toBe(error);
  });

  test("abort while suspended inside a rectangle list does not recolor the unfinished pixel", async () => {
    const data = pixels(1, 1);
    const original = data.slice();
    const rects = Array.from({ length: 2049 }, () => outside);
    const controller = new AbortController();
    const clock = firstChunkClock();
    try {
      const operation = recolorImageDataCpuCooperative(data, 1, 1, dark, light,
        true, true, true, rects, { signal: controller.signal });
      expect(data).toEqual(original);
      controller.abort();
      expect(await operation).toBe(false);
      expect(data).toEqual(original);
    } finally {
      clock.mockRestore();
    }
  });
});

function canvasPair() {
  const width = 257;
  const height = 1;
  const original = pixels(width, height);
  const published = new Uint8ClampedArray(original.length).fill(93);
  let reads = 0;
  let commits = 0;
  const sourceContext = {
    getImageData: () => {
      reads += 1;
      return { data: original.slice(), width, height } as ImageData;
    },
  };
  const targetContext = {
    putImageData: (image: ImageData) => {
      commits += 1;
      published.set(image.data);
    },
  };
  const source = { width, height, getContext: () => sourceContext } as unknown as HTMLCanvasElement;
  const target = { width, height, getContext: () => targetContext } as unknown as HTMLCanvasElement;
  return { source, target, sourceContext, original, published, get reads() { return reads; }, get commits() { return commits; } };
}

const settings = {
  ...DEFAULT_RECOLOR_SETTINGS,
  recolor: true,
  recolorKeephue: true,
  recolorAdjustLightness: true,
};

// Reflect creates an independent instance without changing the production
// constructor's private API or sharing singleton state with other test files.
function cpuRenderer(): RecolorShaderRenderer {
  const renderer = Reflect.construct(RecolorShaderRenderer, []) as RecolorShaderRenderer;
  Object.assign(renderer, { gl: null });
  return renderer;
}

describe("CPU renderer transactional publication", () => {
  test("reads once into isolated ImageData and publishes once only after completion", async () => {
    const pair = canvasPair();
    const original = pair.original.slice();
    const clock = firstChunkClock();
    try {
      const operation = cpuRenderer().render(pair.source, pair.target, settings);
      expect(operation).toBeInstanceOf(Promise);
      expect(pair.reads).toBe(1);
      expect(pair.commits).toBe(0);
      expect(pair.published.every((byte) => byte === 93)).toBe(true);
      expect(pair.original).toEqual(original);
      expect(await operation).toBe(true);
      const expected = original.slice();
      recolorImageDataCpu(expected, 257, 1, dark, light, true, true, false, []);
      expect(pair.published).toEqual(expected);
      expect(pair.original).toEqual(original);
      expect(pair.commits).toBe(1);
    } finally {
      clock.mockRestore();
    }
  });

  for (const invalidate of ["abort", "current", "source-width", "source-height", "target-width", "target-height"] as const) {
    test(`${invalidate} during yield never writes the target`, async () => {
      const pair = canvasPair();
      const controller = new AbortController();
      let current = true;
      const clock = firstChunkClock();
      try {
        const operation = cpuRenderer().render(pair.source, pair.target, settings, [], {
          signal: controller.signal, isCurrent: () => current,
        });
        if (invalidate === "abort") controller.abort();
        if (invalidate === "current") current = false;
        if (invalidate === "source-width") pair.source.width += 1;
        if (invalidate === "source-height") pair.source.height += 1;
        if (invalidate === "target-width") pair.target.width += 1;
        if (invalidate === "target-height") pair.target.height += 1;
        expect(await operation).toBe(false);
        expect(pair.reads).toBe(1);
        expect(pair.commits).toBe(0);
        expect(pair.published.every((byte) => byte === 93)).toBe(true);
      } finally {
        clock.mockRestore();
      }
    });
  }

  test("mismatched dimensions or cancellation reject before allocating ImageData", async () => {
    const pair = canvasPair();
    pair.target.width += 1;
    expect(cpuRenderer().render(pair.source, pair.target, settings)).toBe(false);
    pair.target.width = pair.source.width;
    const controller = new AbortController();
    controller.abort();
    expect(cpuRenderer().render(pair.source, pair.target, settings, [], { signal: controller.signal })).toBe(false);
    expect(pair.reads).toBe(0);
    expect(pair.commits).toBe(0);
  });

  test("dimension change after completed CPU work still prevents the final commit", async () => {
    const pair = canvasPair();
    const owned = pair.original.slice();
    const expected = pair.original.slice();
    recolorImageDataCpu(expected, 257, 1, dark, light, true, true, false, []);
    const readback = spyOn(pair.sourceContext, "getImageData").mockImplementation(() => ({
      data: owned, width: 257, height: 1,
    } as ImageData));
    // No chunk can expire: CPU work finishes synchronously, but renderCpu's
    // await still gives a superseding request a chance before publication.
    const clock = spyOn(performance, "now").mockReturnValue(0);
    try {
      const operation = cpuRenderer().render(pair.source, pair.target, settings);
      expect(owned).toEqual(expected);
      expect(pair.commits).toBe(0);
      pair.target.width += 1;
      expect(await operation).toBe(false);
      expect(pair.commits).toBe(0);
    } finally {
      clock.mockRestore();
      readback.mockRestore();
    }
  });

  test("readback errors reject rather than publishing or silently losing the algorithm", async () => {
    const pair = canvasPair();
    const error = new Error("readback failed");
    const readback = spyOn(pair.sourceContext, "getImageData").mockImplementation(() => { throw error; });
    try {
      await expect(cpuRenderer().render(pair.source, pair.target, settings)).rejects.toBe(error);
      expect(pair.commits).toBe(0);
    } finally {
      readback.mockRestore();
    }
  });

  test("WebGL failure still completes the exact CPU fallback", async () => {
    const pair = canvasPair();
    const renderer = cpuRenderer();
    Object.assign(renderer, {
      gl: { viewport: () => { throw new Error("lost GPU context"); } },
      program: {}, texture: {}, canvas: { width: 0, height: 0 },
    });
    const warning = spyOn(console, "warn").mockImplementation(() => {});
    const clock = firstChunkClock();
    try {
      expect(await renderer.render(pair.source, pair.target, settings)).toBe(true);
      const expected = pair.original.slice();
      recolorImageDataCpu(expected, 257, 1, dark, light, true, true, false, []);
      expect(pair.published).toEqual(expected);
      expect(pair.reads).toBe(1);
      expect(pair.commits).toBe(1);
    } finally {
      clock.mockRestore();
      warning.mockRestore();
    }
  });
});
