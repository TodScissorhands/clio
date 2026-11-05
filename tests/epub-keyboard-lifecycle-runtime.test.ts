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

// Observation only: count the production registrar's actual Window add/remove calls,
// excluding the host/framework and without retaining old Documents or callbacks.
// No production telemetry, library patches, promise wrappers or sandbox changes.
function observationPlugin() {
  return {
    name: "epub-keyboard-lifecycle-observation",
    transform(source: string, id: string) {
      if (id.endsWith("/src/reader/interactions.ts")) {
        for (const type of ["keydown", "keyup"]) {
          for (const [method, delta] of [["addEventListener", 1], ["removeEventListener", -1]] as const) {
            const listener = type === "keydown" ? "onKeyDown" : "onKeyUp";
            const anchor = `eventTarget.${method}("${type}", ${listener}, true);`;
            if (source.split(anchor).length !== 2) throw new Error(`Keyboard observation anchor changed: ${anchor}`);
            source = source.replace(anchor, `${anchor}\n    window.__epubKeyboardListener?.(target, "${type}", ${delta}, ${listener});`);
          }
        }
        return source;
      }
      if (id.endsWith("/src/epub/EpubReader.tsx")) {
        const anchor = "rendition = book.renderTo(viewport, renditionOptions);";
        if (source.split(anchor).length !== 2) throw new Error("Rendition observation anchor changed");
        return source.replace(anchor, `${anchor}\n        window.__epubKeyboardRendition?.(rendition);`);
      }
    },
  };
}

test.skipIf(!probe || probe.exitCode !== 0)("real EPUB/WebKit keyboard registrations follow embedded document lifetimes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "clio-epub-keyboard-lifecycle-"));
  let server: Server<undefined> | undefined;
  let child: Subprocess<"ignore", "pipe", "pipe"> | undefined;
  try {
    const fixture = Bun.spawnSync([python!, join(import.meta.dir, "fixtures/create-epub-lifecycle-document.py"), directory]);
    if (fixture.exitCode !== 0) throw new Error(new TextDecoder().decode(fixture.stderr));
    const built = await build({
      configFile: false,
      root: join(import.meta.dir, ".."),
      plugins: [observationPlugin(), react()],
      logLevel: "error",
      build: {
        write: false, outDir: directory, emptyOutDir: false,
        rollupOptions: { input: join(import.meta.dir, "fixtures/epub-keyboard-lifecycle-runtime.html") },
      },
    });
    if (Array.isArray(built) || !("output" in built)) throw new Error("Expected one EPUB lifecycle bundle");
    const assets = new Map<string, string | Uint8Array>();
    let html = "";
    for (const output of built.output) {
      const content = output.type === "chunk" ? output.code : output.source;
      assets.set("/" + output.fileName, content);
      if (output.fileName.endsWith(".html")) html = String(content);
    }
    for (const name of ["lifecycle.epub", "invalid.epub"]) {
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
    if (exitCode !== 0) throw new Error(`WebKit EPUB keyboard lifecycle regression failed:\n${stdout}\n${stderr}`);
    const result = JSON.parse(stdout);
    expect(result.passed).toBe(true);
    expect(result.spine).toBe(64);
    expect(result.baseline.retiredRegistrations).toBeGreaterThan(0);
    expect(result.trim.removed).toBeGreaterThanOrEqual(2);
    expect(result.helper.activeDown).toBe(0);
    expect(result.helper.activeUp).toBe(0);
    expect(result.production.activeDown).toBe(0);
    expect(result.production.activeUp).toBe(0);
    expect(result.errors).toEqual([]);
    expect(result.cases).toEqual([
      "initial-open-forward-back", "continuous-traversal-reversal", "actual-multiple-view-trim",
      "repeated-reflow-both-modes", "chapter-jumps", "same-frame-document-replacement", "same-document-hooks-and-late-removed-hook",
      "dispose-before-observer-and-same-book-replay", "removed-during-render-hook", "removed-during-content-hook",
      "app-open-host-keys-and-reflow", "app-invalid-and-valid-replacement", "app-repeated-close-reopen",
    ]);
    console.info("WebKit EPUB keyboard lifecycle results:", JSON.stringify(result));
  } finally {
    child?.kill(); server?.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);
