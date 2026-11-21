import { expect, test } from "bun:test";
import type { Server, Subprocess } from "bun";
import react from "@vitejs/plugin-react";
import { build } from "vite";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Observation-only build seams. State, storage, PDF.js and reader effects are real.
const observation = {
  name: "pdf-state-purity-observation", enforce: "pre" as const,
  transform(source: string, id: string) {
    const replace = (anchor: string, replacement: string) => {
      if (source.split(anchor).length !== 2) throw new Error(`Purity observation seam changed: ${anchor}`);
      source = source.replace(anchor, replacement);
    };
    if (id.endsWith("/src/App.tsx")) {
      replace("  return (\n    <main", "  useEffect(() => { window.__pdfPurity.open = openReaderSource; }, [openReaderSource]);\n  return (\n    <main");
    }
    if (id.endsWith("/src/reader/PdfReader.tsx")) {
      for (const name of ["RecolorSettings", "ViewerSize"]) {
        replace(`, set${name}] = useState`, `, dispatch${name}] = useState`);
        const anchor = name === "RecolorSettings"
          ? "  const [customColorTarget, setCustomColorTarget]"
          : "  const [pageSizes, setPageSizes]";
        replace(anchor, `  const set${name}: typeof dispatch${name} = (action) => dispatch${name}(typeof action !== "function" ? action : current => {\n    window.__pdfPurity.updaters.push("${name}");\n    window.__pdfPurity.calculating += 1;\n    try { return action(current); } finally { window.__pdfPurity.calculating -= 1; }\n  });\n${anchor}`);
      }
      replace("  const executePaletteCommand = useCallback", `  useLayoutEffect(() => {
    window.__pdfPurity.reader = { command: runReaderCommand, settings: recolorSettings, page: pageNumber, path: documentPath, size: viewerSize };
    window.__pdfPurity.commits.push({ settings: recolorSettings, path: documentPath, geometry: window.__pdfPurity.measure(pageNumber) });
    return () => { window.__pdfPurity.reader = null; };
  });
  const executePaletteCommand = useCallback`);
      replace("  const captureScrollAnchor = useCallback(() => {", "  const captureScrollAnchor = useCallback(() => {\n    window.__pdfPurity.captures.push({ calculating: window.__pdfPurity.calculating, geometry: window.__pdfPurity.measure(pageNumberRef.current) });");
      replace("    viewer.scrollTop += top - anchor.top;", "    viewer.scrollTop += top - anchor.top;\n    window.__pdfPurity.applies.push({ anchor, geometry: window.__pdfPurity.measure(anchor.page) });");
      replace("    const observer = new ResizeObserver(updateSize);", "    const observer = new ResizeObserver(() => { updateSize(); window.__pdfPurity.resizeQueued?.(); });");
    }
    if (id.endsWith("/src/pdf/PdfViewerSurface.tsx")) {
      replace("    let disposed = false;", "    window.__pdfPurity.surfaceSetups += 1;\n    let disposed = false;");
      replace("      scrollModeRef.current = ScrollMode;", "      window.__pdfPurity.viewersCreated += 1;\n      window.__pdfPurity.listeners += 5;\n      scrollModeRef.current = ScrollMode;");
      replace("      disposed = true;", "      window.__pdfPurity.surfaceCleanups += 1;\n      if (viewer) { window.__pdfPurity.viewersDisposed += 1; window.__pdfPurity.listeners -= listeners.length; }\n      disposed = true;");
    }
    if (id.endsWith("/src/platform/readingPosition.ts")) {
      replace("export async function loadReadingPosition(path: string): Promise<ReadingPosition | null> {", "export async function loadReadingPosition(path: string): Promise<ReadingPosition | null> {\n  return window.__pdfPurity.records.get(path) ?? null;");
      replace("export async function saveReadingPosition(path: string, position: ReadingPosition): Promise<void> {", "export async function saveReadingPosition(path: string, position: ReadingPosition): Promise<void> {\n  window.__pdfPurity.positionWrites.push({ path, position }); window.__pdfPurity.records.set(path, position); return;");
    }
    return source;
  },
};

for (const runtime of ["development", "production"]) {
  test(`actual-reader committed appearance and resize purity in ${runtime} WebKitGTK`, async () => {
    const python = Bun.which("python3");
    expect(process.env.DISPLAY, "Native WebKitGTK DISPLAY is required").toBeTruthy();
    expect(python).toBeTruthy();
    const probe = Bun.spawnSync([python!, "-c", "import gi; gi.require_version('WebKit2', '4.1'); from gi.repository import WebKit2"]);
    expect(probe.exitCode).toBe(0);
    const directory = await mkdtemp(join(tmpdir(), "clio-pdf-purity-"));
    let server: Server<undefined> | undefined;
    let child: Subprocess<"ignore", "pipe", "pipe"> | undefined;
    try {
      const made = Bun.spawnSync([python!, join(import.meta.dir, "fixtures/create-reader-status-documents.py"), directory]);
      expect(made.exitCode).toBe(0);
      const built = await build({ configFile: false, root: join(import.meta.dir, ".."), plugins: [observation, react()], logLevel: "error",
        define: { "process.env.NODE_ENV": JSON.stringify(runtime) },
        oxc: { jsx: { development: runtime === "development" } },
        build: { write: false, rollupOptions: { input: join(import.meta.dir, "fixtures/pdf-state-purity-runtime.html") } } });
      if (Array.isArray(built) || !("output" in built)) throw new Error("Expected one purity bundle");
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
      child = Bun.spawn([python!, join(import.meta.dir, "fixtures/run-palette-webkit.py"), `http://127.0.0.1:${server.port}/`, "120"], {
        env: { ...process.env, GDK_BACKEND: "x11", GDK_SCALE: "1", GDK_DPI_SCALE: "1" }, stdout: "pipe", stderr: "pipe",
      });
      const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      if (process.env.CLIO_PDF_PURITY_EVIDENCE) await Bun.write(join(process.env.CLIO_PDF_PURITY_EVIDENCE, `${runtime}.json`), stdout);
      console.info(`PDF purity ${runtime}:`, stdout);
      if (exit !== 0) throw new Error(`${stdout}\n${stderr}`);
      expect(JSON.parse(stdout).passed).toBe(true);
    } finally {
      child?.kill(); server?.stop(true);
      await rm(directory, { recursive: true, force: true });
    }
  }, 180_000);
}
