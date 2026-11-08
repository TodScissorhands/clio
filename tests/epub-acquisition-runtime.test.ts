import { expect, test } from "bun:test";
import type { Server, Subprocess } from "bun";
import react from "@vitejs/plugin-react";
import { build } from "vite";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cases = [
  "normal-open-section-cfi-render", "abort-before-open",
  "cancel-archive-open", "cancel-container-text", "cancel-navigation-text",
  "cancel-asset-blob", "cancel-css-text", "asset-read-error", "css-read-error",
  "missing-navigation", "invalid-zip", "archive-request-and-url-errors",
  "archive-url-retirement", "reentrant-archive-url-destroy", "reentrant-css-url-destroy",
  "same-members-aborted-replacement", "app-stale-open-and-invalid-retention",
];

test.each(["lib", "src"] as const)("real EPUB/WebKit %s acquisition settles and retires every owned resource", async entrypoint => {
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
        name: "epub-compiled-entrypoints",
        resolveId: id => id.startsWith("virtual:epub-compiled-") ? "\0" + id : undefined,
        load(id) {
          if (!id.startsWith("\0virtual:epub-compiled-")) return;
          const member = id.endsWith("archive") ? "archive.js" : "index.js";
          const path = JSON.stringify(join(import.meta.dir, "../node_modules/epubjs/lib", member));
          // Vite uses default-only CJS namespaces differently from mixed exports.
          // Unwrap only that packaging boundary; execute the real compiled classes.
          return `import compiled from ${path}; export default typeof compiled === "function" ? compiled : compiled.default; ${member === "index.js" ? `export { EpubCFI } from ${path};` : ""}`;
        },
      }, react()],
      resolve: { alias: [
        { find: /^epubjs$/, replacement: entrypoint === "lib" ? "virtual:epub-compiled-factory" : join(import.meta.dir, "../node_modules/epubjs/src/index.js") },
        { find: "epubjs/lib/archive", replacement: entrypoint === "lib" ? "virtual:epub-compiled-archive" : join(import.meta.dir, "../node_modules/epubjs/src/archive.js") },
      ] },
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
    for (const name of ["acquisition-a.epub", "acquisition-b.epub", "missing-nav.epub", "invalid.epub"]) {
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
    expect(result.cases).toEqual(cases);
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
