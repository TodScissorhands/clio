import { expect, test } from "bun:test";
import react from "@vitejs/plugin-react";
import { build } from "vite";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const plugin = {
  name: "pdf-progressive-benchmark-observation", enforce: "pre" as const,
  transform(source: string, id: string) {
    if (id.endsWith("/src/App.tsx")) {
      const openAnchor = "  return (\n    <main";
      if (source.split(openAnchor).length !== 2) throw new Error("App benchmark seam changed");
      source = source.replace(openAnchor,
        "  window.__benchOpen = async (count: number, page = 1) => {\n    const path = `/bench/progressive-${count}.pdf`;\n    const bytes = new Uint8Array(await (await fetch(path)).arrayBuffer());\n    if (page > 1) window.__benchRecords.set(path, { page, offset: 0 });\n    window.__bench('open-request', { count, page });\n    await openReaderSource({ kind: 'pdf', bytes, name: `progressive-${count}.pdf`, path });\n  };\n  return (\n    <main");
      const commitAnchor = "  const handlePdfDocumentChange = useCallback((name: string | null) => {";
      if (source.split(commitAnchor).length !== 2) throw new Error("App commit seam changed");
      source = source.replace(commitAnchor, `${commitAnchor}\n    window.__benchCommit += 1;\n    window.__bench('reader-commit', { name, geometryReads: window.__benchGeometryCounts.get(window.__benchCurrentPdf) ?? 0 });`);
    }
    if (id.endsWith("/src/pdf/engine.ts")) {
      const pageAnchor = "    const page = await this.pdf.getPage(pageNumber);";
      if (source.split(pageAnchor).length !== 2) throw new Error("Page geometry benchmark seam changed");
      source = source.replace(pageAnchor, `${pageAnchor}\n    if (window.__benchGeometryGate && pageNumber === window.__benchGeometryGatePage) { window.__benchGeometryGateReached = true; await window.__benchGeometryGate; }\n    window.__benchGeometryReads += 1;\n    window.__benchGeometryCounts.set(this.pdf, (window.__benchGeometryCounts.get(this.pdf) ?? 0) + 1);`);
      const publishAnchor = "      if (!this.cancelled) this.sizes[pageNumber - 1] = size;";
      if (source.split(publishAnchor).length !== 2) throw new Error("Geometry publication benchmark seam changed");
      source = source.replace(publishAnchor, `${publishAnchor}\n      if (!this.cancelled) window.__benchPublished.push({ pdf: this.pdf, pageNumber });`);
    }
    if (id.endsWith("/src/reader/PdfReader.tsx")) {
      const documentAnchor = "      setDocument(pdf);";
      if (source.split(documentAnchor).length !== 2) throw new Error("Reader commit benchmark seam changed");
      source = source.replace(documentAnchor, `      window.__benchCurrentPdf = pdf;\n      window.__benchInitialSizes = [...geometry.sizes];\n${documentAnchor}`);
    }
    if (id.endsWith("/src/platform/readingPosition.ts")) {
      const loadAnchor = "export async function loadReadingPosition(path: string): Promise<ReadingPosition | null> {";
      const saveAnchor = "export async function saveReadingPosition(path: string, position: ReadingPosition): Promise<void> {";
      if (source.split(loadAnchor).length !== 2 || source.split(saveAnchor).length !== 2) throw new Error("Position benchmark seam changed");
      source = source.replace(loadAnchor, `${loadAnchor}\n  return window.__benchRecords.get(path) ?? null;`);
      source = source.replace(saveAnchor, `${saveAnchor}\n  window.__benchRecords.set(path, position);`);
    }
    return source;
  },
};

test("actual-reader progressive PDF opening and restoration in WebKitGTK", async () => {
  const python = Bun.which("python3");
  expect(process.env.DISPLAY, "Native WebKitGTK DISPLAY is required").toBeTruthy();
  expect(python).toBeTruthy();
  const probe = Bun.spawnSync([python!, "-c", "import gi; gi.require_version('WebKit2', '4.1'); from gi.repository import WebKit2"]);
  expect(probe.exitCode).toBe(0);
  const directory = await mkdtemp(join(tmpdir(), "clio-progressive-pdf-"));
  let server: ReturnType<typeof Bun.serve> | undefined;
  let child: ReturnType<typeof Bun.spawn> | undefined;
  try {
    const made = Bun.spawnSync([python!, join(import.meta.dir, "fixtures/create-progressive-pdfs.py"), directory]);
    expect(made.exitCode).toBe(0);
    const built = await build({ configFile: false, root: join(import.meta.dir, ".."), plugins: [plugin, react()], logLevel: "error",
      build: { write: false, rollupOptions: { input: join(import.meta.dir, "fixtures/pdf-progressive-opening-runtime.html") } } });
    if (Array.isArray(built) || !("output" in built)) throw new Error("Expected a single benchmark bundle");
    const assets = new Map<string, string | Uint8Array>();
    let html = "";
    for (const output of built.output) {
      const content = output.type === "chunk" ? output.code : output.source;
      assets.set("/" + output.fileName, content);
      if (output.fileName.endsWith(".html")) html = String(content);
    }
    for (const count of [5, 100, 1000]) assets.set(`/bench/progressive-${count}.pdf`, new Uint8Array(await readFile(join(directory, `progressive-${count}.pdf`))));
    server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
      const path = new URL(request.url).pathname;
      const value = path === "/" ? html : assets.get(path);
      return new Response(value ?? null, { status: value === undefined ? 404 : 200, headers: { "content-type": path === "/" ? "text/html" : /\.(js|mjs)$/.test(path) ? "application/javascript" : path.endsWith(".css") ? "text/css" : "application/octet-stream" } });
    } });
    child = Bun.spawn([python!, join(import.meta.dir, "fixtures/run-progressive-webkit.py"), `http://127.0.0.1:${server.port}/`], {
      env: { ...process.env, GDK_BACKEND: "x11", GDK_SCALE: "1", GDK_DPI_SCALE: "1" }, stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    console.info("PDF progressive WebKit evidence:", stdout);
    if (exit !== 0) throw new Error(`${stdout}\n${stderr}`);
    expect(JSON.parse(stdout).passed).toBe(true);
  } finally {
    child?.kill(); server?.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
}, 300_000);
