import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { writeFile, readFile } from "node:fs/promises";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  buildPageSearchIndex,
  findPageMatchesInIndex,
  isPdfSearchTextItem,
  normalizeSearchQuery,
  searchPageIndexes,
} from "../src/pdf/searchIndex";
import type { PdfPageSearchIndex } from "../src/pdf/searchIndex";

function buildSyntheticPdf(pageCount: number): Uint8Array {
  const encoder = new TextEncoder();
  const fontId = 3 + pageCount * 2;
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Count ${pageCount} /Kids [${Array.from({ length: pageCount }, (_, i) => `${3 + i * 2} 0 R`).join(" ")}] >>`,
  ];
  for (let page = 1; page <= pageCount; page += 1) {
    const pageId = 3 + (page - 1) * 2;
    const contentId = pageId + 1;
    const pageTag = String(page).padStart(4, "0");
    const content = `BT /F1 12 Tf 72 720 Td (ClioSearchToken page ${pageTag} ClioSearchToken UniquePage${pageTag}) Tj ET`;
    const stream = encoder.encode(content);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects.push(`<< /Length ${stream.length} >>\nstream\n${content}\nendstream`);
  }
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  const chunks = ["%PDF-1.4\n"];
  const offsets = [0];
  let byteLength = encoder.encode(chunks[0]!).length;
  objects.forEach((body, index) => {
    offsets.push(byteLength);
    const chunk = `${index + 1} 0 obj\n${body}\nendobj\n`;
    chunks.push(chunk);
    byteLength += encoder.encode(chunk).length;
  });
  const xrefOffset = byteLength;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) xref += `${String(offset).padStart(10, "0")} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  chunks.push(xref);
  return encoder.encode(chunks.join(""));
}

type OpenPdf = { pdf: PDFDocumentProxy; close: () => Promise<void> };

async function openPdf(data: Uint8Array): Promise<OpenPdf> {
  const task = pdfjs.getDocument({ data: data.slice(), disableWorker: true });
  const pdf = await task.promise;
  return { pdf, close: () => task.destroy() };
}

type BenchmarkResult = {
  label: string;
  totalMs: number;
  timeToFirstResultMs: number | null;
  matches: number;
  maxBunEventLoopDelayMs: number;
};

async function measure(label: string, run: (onFirst: () => void) => Promise<number>): Promise<BenchmarkResult> {
  const started = performance.now();
  let timeToFirstResult: number | null = null;
  let maxEventLoopDelay = 0;
  let lastTick = started;
  const timer = setInterval(() => {
    const now = performance.now();
    maxEventLoopDelay = Math.max(maxEventLoopDelay, now - lastTick - 16);
    lastTick = now;
  }, 16);
  const count = await run(() => {
    timeToFirstResult ??= performance.now() - started;
  });
  clearInterval(timer);
  return {
    label,
    totalMs: +(performance.now() - started).toFixed(1),
    timeToFirstResultMs: timeToFirstResult === null ? null : +timeToFirstResult.toFixed(1),
    matches: count,
    maxBunEventLoopDelayMs: +Math.max(0, maxEventLoopDelay).toFixed(1),
  };
}

async function searchUncached(pdf: PDFDocumentProxy, query: string, onFirst: () => void) {
  const normalized = normalizeSearchQuery(query);
  let count = 0;
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const index = buildPageSearchIndex(pageNumber, content.items.filter(isPdfSearchTextItem));
    const matches = findPageMatchesInIndex(index, normalized);
    if (!count && matches.length) onFirst();
    count += matches.length;
  }
  return count;
}

async function main() {
  const requestedPath = process.argv[2];
  const pdfPath = requestedPath || resolve(tmpdir(), "clio-search-bench-400.pdf");
  let data: Uint8Array;
  if (requestedPath) {
    data = new Uint8Array(await readFile(requestedPath));
  } else {
    data = buildSyntheticPdf(400);
    await writeFile(pdfPath, data);
  }

  const baselineDocument = await openPdf(data);
  const pageCount = baselineDocument.pdf.numPages;
  const baseline = await measure("Uncached extraction + match: ClioSearchToken", (first) =>
    searchUncached(baselineDocument.pdf, "ClioSearchToken", first),
  );
  await baselineDocument.close();

  const coldBatchRuns: BenchmarkResult[] = [];
  let warmDocument: OpenPdf | null = null;
  let warmGetIndex: ((page: number) => Promise<PdfPageSearchIndex>) | null = null;
  for (const batchSize of [1, 2, 4, 8]) {
    const optimizedDocument = await openPdf(data);
    const cache = new Map<number, Promise<PdfPageSearchIndex>>();
    const getIndex = (pageNumber: number) => {
      let index = cache.get(pageNumber);
      if (!index) {
        index = (async () => {
          const page = await optimizedDocument.pdf.getPage(pageNumber);
          const content = await page.getTextContent();
          return buildPageSearchIndex(pageNumber, content.items.filter(isPdfSearchTextItem));
        })();
        cache.set(pageNumber, index);
        void index.catch(() => cache.delete(pageNumber));
      }
      return index;
    };
    const cold = await measure(`Cached index cold search, batch ${batchSize}`, async (first) => {
      const matches = await searchPageIndexes(
        optimizedDocument.pdf.numPages,
        getIndex,
        normalizeSearchQuery("ClioSearchToken"),
        () => false,
        (batch) => { if (batch.length) first(); },
        batchSize,
      );
      return matches.length;
    });
    coldBatchRuns.push(cold);
    if (batchSize === 8) {
      warmDocument = optimizedDocument;
      warmGetIndex = getIndex;
    } else {
      await optimizedDocument.close();
    }
  }
  if (!warmDocument || !warmGetIndex) throw new Error("Missing warm benchmark document.");
  const optimizedWarm = await measure("Cached index warm search: UniquePage0400", async (first) => {
    const matches = await searchPageIndexes(
      warmDocument.pdf.numPages,
      warmGetIndex,
      normalizeSearchQuery("UniquePage0400"),
      () => false,
      (batch) => { if (batch.length) first(); },
    );
    return matches.length;
  });
  const optimizedNoHit = await measure("Cached index warm search: absent token", async () => {
    const matches = await searchPageIndexes(
      warmDocument.pdf.numPages,
      warmGetIndex,
      normalizeSearchQuery("not-present"),
      () => false,
      () => {},
    );
    return matches.length;
  });
  await warmDocument.close();
  const expectedCommonTermMatches = requestedPath ? null : 800;
  if (!requestedPath && (
    baseline.matches !== expectedCommonTermMatches ||
    coldBatchRuns.some((run) => run.matches !== expectedCommonTermMatches) ||
    optimizedWarm.matches !== 1 ||
    optimizedNoHit.matches !== 0
  )) {
    throw new Error("Benchmark result counts did not match the synthetic PDF's expected contents.");
  }

  console.log(JSON.stringify({
    pdf: pdfPath,
    sha256: createHash("sha256").update(data).digest("hex"),
    pages: pageCount,
    bytes: data.byteLength,
    expectedCommonTermMatches,
    runs: [baseline, ...coldBatchRuns, optimizedWarm, optimizedNoHit],
    eventLoopMetric: "Maximum Bun timer delay; not a browser/Tauri UI responsiveness measurement.",
  }, null, 2));
}

await main();
