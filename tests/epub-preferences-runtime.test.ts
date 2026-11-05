import { expect, test } from "bun:test";
import type { Server, Subprocess } from "bun";
import react from "@vitejs/plugin-react";
import { build } from "vite";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const python = Bun.which("python3");
const probe = process.platform === "linux" && process.env.DISPLAY && python
  ? Bun.spawnSync([python, "-c", "import gi; gi.require_version('WebKit2', '4.1'); from gi.repository import WebKit2"], { stdout: "ignore", stderr: "ignore" }) : null;

// Observation only: actual App, renderer, sandbox, position session and commands.
function observationPlugin() {
  const replace = (source: string, anchor: string, replacement: string) => {
    if (source.split(anchor).length !== 2) throw new Error(`Preference observation anchor changed: ${anchor}`);
    return source.replace(anchor, replacement);
  };
  return {
    name: "epub-preferences-observation", enforce: "pre" as const,
    transform(source: string, id: string) {
      if (id.endsWith("/src/epub/EpubReader.tsx")) {
        const anchor = "rendition = book.renderTo(viewport, renditionOptions);";
        return replace(source, anchor, `${anchor}\n        window.__preferencesRendition?.(rendition, book);`);
      }
      if (id.endsWith("/src/App.tsx")) {
        return replace(source, "  return (\n    <main", "  window.__preferencesApp?.({ open: openReaderSource, appearance: setNightMode });\n  return (\n    <main");
      }
      if (id.endsWith("/src/platform/readingPosition.ts")) {
        source = replace(source,
          "export async function loadEpubReadingPosition(path: string): Promise<{ cfi: string } | null> {",
          "export async function loadEpubReadingPosition(path: string): Promise<{ cfi: string } | null> {\n  if (window.__preferencesPositions) return window.__preferencesPositions.get(path) ?? null;");
        return replace(source,
          "export async function saveEpubReadingPosition(path: string, position: { cfi: string }): Promise<void> {",
          "export async function saveEpubReadingPosition(path: string, position: { cfi: string }): Promise<void> {\n  if (window.__preferencesPositions) { window.__preferencesPositions.set(path, position); return; }");
      }
    },
  };
}

test.skipIf(!probe || probe.exitCode !== 0)("real App EPUB typography, themes, Publisher reset and lifecycle in WebKitGTK", async () => {
  const directory = await mkdtemp(join(tmpdir(), "clio-epub-preferences-"));
  let server: Server<undefined> | undefined;
  let child: Subprocess<"ignore", "pipe", "pipe"> | undefined;
  try {
    const fixture = Bun.spawnSync([python!, join(import.meta.dir, "fixtures/create-epub-preferences-documents.py"), directory]);
    if (fixture.exitCode !== 0) throw new Error(new TextDecoder().decode(fixture.stderr));
    const built = await build({
      configFile: false, root: join(import.meta.dir, ".."), plugins: [observationPlugin(), react()], logLevel: "error",
      build: { write: false, outDir: directory, emptyOutDir: false, rollupOptions: { input: join(import.meta.dir, "fixtures/epub-preferences-runtime.html") } },
    });
    if (Array.isArray(built) || !("output" in built)) throw new Error("Expected one preference bundle");
    const assets = new Map<string, string | Uint8Array>();
    let html = "";
    for (const output of built.output) {
      const content = output.type === "chunk" ? output.code : output.source;
      assets.set("/" + output.fileName, content);
      if (output.fileName.endsWith(".html")) html = String(content);
    }
    for (const name of ["preferences.epub", "replacement.epub", "fixed.epub", "mixed.epub", "vertical.epub", "invalid.epub"]) {
      assets.set("/__fixtures/" + name, new Uint8Array(await readFile(join(directory, name))));
    }
    server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/") return new Response(html, { headers: { "content-type": "text/html" } });
      const asset = assets.get(path);
      const type = /\.(?:js|mjs)$/.test(path) ? "application/javascript" : path.endsWith(".css") ? "text/css" : "application/octet-stream";
      return new Response(asset ?? null, { status: asset === undefined ? 404 : 200, headers: { "content-type": type } });
    } });
    child = Bun.spawn([python!, join(import.meta.dir, "fixtures/run-palette-webkit.py"), `http://127.0.0.1:${server.port}/`], {
      env: { ...process.env, GDK_BACKEND: "x11", GDK_SCALE: "1", GDK_DPI_SCALE: "1" }, stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (exitCode !== 0) throw new Error(`WebKit preference regression failed:\n${stdout}\n${stderr}`);
    const result = JSON.parse(stdout);
    expect(result.passed).toBe(true);
    expect(result.cycles).toBe(20);
    expect(result.geometries.map((entry: { width: number; height: number; dark: boolean }) => [entry.width, entry.height, entry.dark])).toEqual([
      [420, 600, false], [1000, 700, false], [1440, 800, false], [420, 600, true], [1000, 700, true], [1440, 800, true],
    ]);
    expect(result.coverage).toContain("cfi-reopen-and-preference-persistence");
    expect(result.coverage).toContain("fixed-mixed-and-vertical-retain-publisher");
    console.info("WebKit EPUB preferences results:", JSON.stringify(result));
  } finally {
    child?.kill(); server?.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
}, 180_000);
