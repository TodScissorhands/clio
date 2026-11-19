import { expect, test } from "bun:test";
import react from "@vitejs/plugin-react";
import { build } from "vite";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Disposable observation only: the App, PDF.js and reader lifecycle are real.
const plugin = {
  name: "pdf-position-observation", enforce: "pre" as const,
  transform(source: string, id: string) {
    const replace = (anchor: string, value: string) => {
      if (source.split(anchor).length !== 2) throw new Error(`Position seam changed: ${anchor}`);
      source = source.replace(anchor, value);
    };
    if (id.endsWith("/src/App.tsx")) {
      replace("  return (\n    <main", "  window.__positionApp = { open: openReaderSource };\n  return (\n    <main");
      replace("  const handlePdfDocumentChange = useCallback((name: string | null) => {",
        "  const handlePdfDocumentChange = useCallback((name: string | null) => {\n    window.__positionCommits += 1;");
    }
    if (id.endsWith("/src/platform/readingPosition.ts")) {
      replace("export async function loadReadingPosition(path: string): Promise<ReadingPosition | null> {",
        "export async function loadReadingPosition(path: string): Promise<ReadingPosition | null> {\n  return window.__positionLoad(path);");
      replace("export async function saveReadingPosition(path: string, position: ReadingPosition): Promise<void> {",
        "export async function saveReadingPosition(path: string, position: ReadingPosition): Promise<void> {\n  return window.__positionSave(path, position);");
    }
    return source;
  },
};

test("actual App PDF position lifecycle and ordered saves in WebKitGTK", async () => {
  const python = Bun.which("python3");
  expect(process.env.DISPLAY, "Native WebKitGTK DISPLAY is required").toBeTruthy();
  expect(python).toBeTruthy();
  const probe = Bun.spawnSync([python!, "-c", "import gi; gi.require_version('WebKit2', '4.1'); from gi.repository import WebKit2"]);
  expect(probe.exitCode).toBe(0);
  const directory = await mkdtemp(join(tmpdir(), "clio-pdf-position-"));
  let server: ReturnType<typeof Bun.serve> | undefined;
  let child: ReturnType<typeof Bun.spawn> | undefined;
  try {
    const fixture = Bun.spawnSync([python!, join(import.meta.dir, "fixtures/create-reader-status-documents.py"), directory]);
    expect(fixture.exitCode).toBe(0);
    const built = await build({ configFile: false, root: join(import.meta.dir, ".."), plugins: [plugin, react()], logLevel: "error",
      build: { write: false, rollupOptions: { input: join(import.meta.dir, "fixtures/pdf-reading-position-runtime.html") } } });
    if (Array.isArray(built) || !("output" in built)) throw new Error("Expected single bundle");
    const assets = new Map<string, string | Uint8Array>();
    let html = "";
    for (const output of built.output) {
      const content = output.type === "chunk" ? output.code : output.source;
      assets.set("/" + output.fileName, content);
      if (output.fileName.endsWith(".html")) html = String(content);
    }
    for (const name of ["status.pdf", "status.epub"]) assets.set("/" + name, new Uint8Array(await readFile(join(directory, name))));
    server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
      const path = new URL(request.url).pathname;
      const value = path === "/" ? html : assets.get(path);
      return new Response(value ?? null, { status: value === undefined ? 404 : 200, headers: { "content-type": path === "/" ? "text/html" : /\.(js|mjs)$/.test(path) ? "application/javascript" : path.endsWith(".css") ? "text/css" : "application/octet-stream" } });
    } });
    child = Bun.spawn([python!, join(import.meta.dir, "fixtures/run-palette-webkit.py"), `http://127.0.0.1:${server.port}/`], {
      env: { ...process.env, GDK_BACKEND: "x11", GDK_SCALE: "1", GDK_DPI_SCALE: "1" }, stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    console.info("PDF position evidence:", stdout);
    if (exit !== 0) throw new Error(`${stdout}\n${stderr}`);
    expect(JSON.parse(stdout).passed).toBe(true);
  } finally {
    child?.kill(); server?.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);
