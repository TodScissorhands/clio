import { expect, test } from "bun:test";
import type { Server, Subprocess } from "bun";
import react from "@vitejs/plugin-react";
import { build } from "vite";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const python = Bun.which("python3");
const probe = process.platform === "linux" && process.env.DISPLAY && python
  ? Bun.spawnSync([python, "-c", "import gi; gi.require_version('WebKit2', '4.1'); from gi.repository import WebKit2"], { stdout: "ignore", stderr: "ignore" })
  : null;

// Only this disposable bundle exposes observation/acquisition seams. Engines,
// PDF worker, App, CFI session and publication sandbox remain the real ones.
function observationPlugin() {
  const replace = (source: string, anchor: string, replacement: string) => {
    if (source.split(anchor).length !== 2) throw new Error(`Status observation anchor changed: ${anchor}`);
    return source.replace(anchor, replacement);
  };
  return {
    name: "reader-status-observation",
    enforce: "pre" as const,
    transform(source: string, id: string) {
      if (id.endsWith("/src/epub/EpubReader.tsx")) {
        const anchor = "rendition = book.renderTo(viewport, renditionOptions);";
        return replace(source, anchor, `${anchor}\n        window.__readerStatusRendition?.(rendition, book);`);
      }
      if (id.endsWith("/src/epub/engine.ts")) {
        source = replace(source, "const book = ePub();",
          'window.__readerStatusEngine?.("epub");\n  const book = ePub();');
        return replace(source, "    signal?.throwIfAborted();", '    await window.__readerStatusGate?.("epub", book);\n    signal?.throwIfAborted();');
      }
      if (id.endsWith("/src/pdf/engine.ts")) {
        return replace(source, "const pdf = await task.promise;", 'const pdf = await task.promise;\n  await window.__readerStatusGate?.("pdf", task);');
      }
      if (id.endsWith("/src/App.tsx")) {
        return replace(source, "  return (\n    <main", "  window.__readerStatusApp?.({ open: openReaderSource, appearance: setNightMode });\n  return (\n    <main");
      }
      if (id.endsWith("/src/platform/readingPosition.ts")) {
        source = replace(source,
          "export async function loadEpubReadingPosition(path: string): Promise<{ cfi: string } | null> {",
          "export async function loadEpubReadingPosition(path: string): Promise<{ cfi: string } | null> {\n  if (window.__readerStatusPositions) return window.__readerStatusPositions.get(path) ?? null;");
        return replace(source,
          "export async function saveEpubReadingPosition(path: string, position: { cfi: string }): Promise<void> {",
          "export async function saveEpubReadingPosition(path: string, position: { cfi: string }): Promise<void> {\n  if (window.__readerStatusPositions) { window.__readerStatusPositions.set(path, position); return; }");
      }
    },
  };
}

test.skipIf(!probe || probe.exitCode !== 0)("real App EPUB status, shared document identity and acquisition ownership in WebKitGTK", async () => {
  const directory = await mkdtemp(join(tmpdir(), "clio-reader-status-"));
  let server: Server<undefined> | undefined;
  let child: Subprocess<"ignore", "pipe", "pipe"> | undefined;
  try {
    const fixture = Bun.spawnSync([python!, join(import.meta.dir, "fixtures/create-reader-status-documents.py"), directory]);
    if (fixture.exitCode !== 0) throw new Error(new TextDecoder().decode(fixture.stderr));
    const built = await build({
      configFile: false, root: join(import.meta.dir, ".."),
      plugins: [observationPlugin(), react()], logLevel: "error",
      build: {
        write: false, outDir: directory, emptyOutDir: false,
        rollupOptions: { input: join(import.meta.dir, "fixtures/reader-status-runtime.html") },
      },
    });
    if (Array.isArray(built) || !("output" in built)) throw new Error("Expected one status runtime bundle");
    const assets = new Map<string, string | Uint8Array>();
    let html = "";
    for (const output of built.output) {
      const content = output.type === "chunk" ? output.code : output.source;
      assets.set("/" + output.fileName, content);
      if (output.fileName.endsWith(".html")) html = String(content);
    }
    for (const name of ["status.pdf", "status.epub", "no-toc.epub", "invalid.pdf", "invalid.epub"]) {
      assets.set("/__fixtures/" + name, new Uint8Array(await readFile(join(directory, name))));
    }
    server = Bun.serve({
      hostname: "127.0.0.1", port: 0,
      fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/") return new Response(html, { headers: { "content-type": "text/html" } });
        const asset = assets.get(path);
        const type = /\.(?:js|mjs)$/.test(path) ? "application/javascript" : path.endsWith(".css") ? "text/css" : "application/octet-stream";
        return asset === undefined ? new Response(null, { status: 404 }) : new Response(asset, { headers: { "content-type": type } });
      },
    });
    child = Bun.spawn([python!, join(import.meta.dir, "fixtures/run-palette-webkit.py"), `http://127.0.0.1:${server.port}/`], {
      env: { ...process.env, GDK_BACKEND: "x11", GDK_SCALE: "1", GDK_DPI_SCALE: "1" }, stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    if (exitCode !== 0) throw new Error(`WebKit reader status regression failed:\n${stdout}\n${stderr}`);
    const result = JSON.parse(stdout);
    expect(result.passed).toBe(true);
    expect(result.cases.map((entry: { width: number; height: number; dark: boolean }) => [entry.width, entry.height, entry.dark])).toEqual([
      [420, 600, false], [1000, 700, false], [1440, 800, false],
      [420, 600, true], [1000, 700, true], [1440, 800, true],
    ]);
    expect(result.coverage).toEqual([
      "paged-and-page-turns", "nested-fragments-aliases-and-parent-gap", "continuous-scroll-and-layout-switch",
      "six-geometries-and-appearances", "resize-freshness", "empty-toc-and-malformed-location",
      "cfi-close-reopen", "failed-replacements-both-formats", "pdf-status-navigation-and-close",
      "prepared-pdf-supersession-and-close", "epub-supersession-and-close", "browser-array-buffer-ordering", "literal-filename",
    ]);
    console.info("WebKit reader status results:", JSON.stringify(result));
  } finally {
    child?.kill(); server?.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
}, 180_000);
