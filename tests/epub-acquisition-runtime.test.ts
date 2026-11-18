import { expect, test } from "bun:test";
import type { Server, Subprocess } from "bun";
import react from "@vitejs/plugin-react";
import { build } from "vite";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("real Foliate/WebKit acquisition settles and retires every owned resource", async () => {
  const python = Bun.which("python3");
  if (process.platform !== "linux" || !process.env.DISPLAY || !python) {
    throw new Error("EPUB acquisition runtime requires Linux, an X11 DISPLAY (use xvfb-run), and python3");
  }
  const probe = Bun.spawnSync([python, "-c", "import gi; gi.require_version('Gtk', '3.0'); gi.require_version('WebKit2', '4.1'); from gi.repository import Gtk, WebKit2"], { stdout: "pipe", stderr: "pipe" });
  if (probe.exitCode !== 0) throw new Error(`EPUB acquisition runtime requires PyGObject, GTK 3 and WebKit2 4.1:\n${new TextDecoder().decode(probe.stderr)}`);
  const directory = await mkdtemp(join(tmpdir(), "clio-epub-acquisition-"));
  let server: Server<undefined> | undefined;
  let child: Subprocess<"ignore", "pipe", "pipe"> | undefined;
  try {
    const fixture = Bun.spawnSync([python, join(import.meta.dir, "fixtures/create-epub-acquisition-document.py"), directory]);
    if (fixture.exitCode !== 0) throw new Error(new TextDecoder().decode(fixture.stderr));
    const built = await build({
      configFile: false,
      root: join(import.meta.dir, ".."),
      plugins: [{
        name: "foliate-acquisition-observation",
        enforce: "pre" as const,
        transform(source, id) {
          if (id.endsWith("/node_modules/foliate-js/paginator.js")) {
            const anchor = "            const view = this.#createView(index)\n            const compensatePrepend";
            if (source.split(anchor).length !== 2) throw new Error("Acquisition preload observation anchor changed");
            return source.replace(anchor, "            const view = this.#createView(index)\n            await window.__acquisitionPreload?.(this, index)\n            const compensatePrepend");
          }
          if (id.endsWith("/src/App.tsx")) return source.replace("  return (\n    <main",
            "  window.__acquisitionOpen = openReaderSource;\n  return (\n    <main");
          if (id.endsWith("/src/platform/readingPosition.ts")) return source
            .replace("export async function loadEpubReadingPosition(path: string): Promise<EpubReadingPosition | null> {",
              "export async function loadEpubReadingPosition(path: string): Promise<EpubReadingPosition | null> {\n  return window.__acquisitionLoad(path);")
            .replace("export async function saveEpubReadingPosition(path: string, position: EpubReadingPosition): Promise<void> {",
              "export async function saveEpubReadingPosition(path: string, position: EpubReadingPosition): Promise<void> {\n  window.__acquisitionPositions.set(path, position); return;");
        },
      }, react()],
      logLevel: "error",
      build: {
        write: false, outDir: directory, emptyOutDir: false,
        rollupOptions: { input: join(import.meta.dir, "fixtures/epub-acquisition-runtime.html") },
      },
    });
    if (Array.isArray(built) || !("output" in built)) throw new Error("Expected one EPUB acquisition bundle");
    const assets = new Map<string, string | Uint8Array>();
    let html = "";
    for (const output of built.output) {
      const content = output.type === "chunk" ? output.code : output.source;
      assets.set("/" + output.fileName, content);
      if (output.fileName.endsWith(".html")) html = String(content);
    }
    for (const name of ["acquisition-a.epub", "acquisition-b.epub", "invalid.epub"]) {
      assets.set("/__fixtures/" + name, new Uint8Array(await readFile(join(directory, name))));
    }
    server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/") return new Response(html, { headers: { "content-type": "text/html" } });
      const asset = assets.get(path);
      const type = /\.(?:js|mjs)$/.test(path) ? "application/javascript" : path.endsWith(".css") ? "text/css" : "application/octet-stream";
      return asset === undefined ? new Response(null, { status: 404 }) : new Response(asset, { headers: { "content-type": type } });
    } });
    child = Bun.spawn([python, join(import.meta.dir, "fixtures/run-palette-webkit.py"), `http://127.0.0.1:${server.port}/`], {
      env: { ...process.env, GDK_BACKEND: "x11", GDK_SCALE: "1", GDK_DPI_SCALE: "1" }, stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    if (exitCode !== 0) throw new Error(`WebKit EPUB acquisition regression failed:\n${stdout}\n${stderr}`);
    const result = JSON.parse(stdout);
    expect(result.passed).toBe(true);
    expect(result.spine).toBe(3);
    expect(result.cases).toEqual([
      "foliate-single-session", "foliate-invalid-retention", "foliate-stale-success-and-failure",
      "foliate-close-during-acquisition", "foliate-replacement-retires-search-and-listeners",
      "foliate-rapid-position-success-and-failure", "foliate-fresh-reopen",
    ]);
    expect(result.errors).toEqual([]);
    expect(result.created).toBeGreaterThan(0);
    expect(result.revoked).toBe(result.created);
    console.info("WebKit EPUB acquisition results:", JSON.stringify(result));
  } finally {
    child?.kill();
    server?.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);
