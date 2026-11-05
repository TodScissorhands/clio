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

test.skipIf(!probe || probe.exitCode !== 0).each([
  { label: "live PDF and EPUB command settings in real WebKitGTK", appearanceOnly: false },
  { label: "PDF legacy persistence and Original restoration in real WebKitGTK", appearanceOnly: true },
])("$label", async ({ appearanceOnly }) => {
  const directory = await mkdtemp(join(tmpdir(), "clio-command-state-test-"));
  let server: Server<undefined> | undefined;
  let child: Subprocess<"ignore", "pipe", "pipe"> | undefined;
  try {
    const fixture = Bun.spawnSync([python!, join(import.meta.dir, "fixtures/create-feedback-documents.py"), directory]);
    if (fixture.exitCode !== 0) throw new Error(new TextDecoder().decode(fixture.stderr));
    // Bundle the production App, including Vite's PDF worker and the real EPUB engine.
    const built = await build({
      configFile: false,
      root: join(import.meta.dir, ".."),
      plugins: [react()],
      logLevel: "error",
      build: {
        write: false,
        outDir: directory,
        emptyOutDir: false,
        rollupOptions: { input: join(import.meta.dir, "fixtures/reader-command-state-runtime.html") },
      },
    });
    if (Array.isArray(built) || !("output" in built)) throw new Error("Expected one command-state test bundle");
    const assets = new Map<string, string | Uint8Array>();
    let html = "";
    for (const output of built.output) {
      const content = output.type === "chunk" ? output.code : output.source;
      assets.set("/" + output.fileName, content);
      if (output.fileName.endsWith(".html")) html = String(content);
    }
    for (const name of ["feedback.pdf", "feedback.epub"]) {
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
    child = Bun.spawn([python!, join(import.meta.dir, "fixtures/run-palette-webkit.py"), `http://127.0.0.1:${server.port}/${appearanceOnly ? "?appearance=1" : ""}`], {
      env: { ...process.env, GDK_BACKEND: "x11" }, stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    if (exitCode !== 0) throw new Error(`WebKit command-state regression failed:\n${stdout}\n${stderr}`);
    const result = JSON.parse(stdout);
    expect(result.passed).toBe(true);
    if (!appearanceOnly) {
      expect(result.cases.map((entry: { width: number; height: number; dark: boolean }) => [entry.width, entry.height, entry.dark])).toEqual([
        [420, 600, false], [1000, 700, false], [1440, 800, false],
        [420, 600, true], [1000, 700, true], [1440, 800, true],
      ]);
    }
    console.info(`WebKit ${appearanceOnly ? "appearance persistence" : "command-state"} results:`, JSON.stringify(result));
  } finally {
    child?.kill();
    server?.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);
