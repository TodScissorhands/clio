import { expect, test } from "bun:test";
import type { Server, Subprocess } from "bun";
import react from "@vitejs/plugin-react";
import { build } from "vite";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const python = Bun.which("python3");
const display = process.env.DISPLAY || process.env.WAYLAND_DISPLAY;
const probe = process.platform === "linux" && display && python
  ? Bun.spawnSync([python, "-c", "import gi; gi.require_version('WebKit2', '4.1'); from gi.repository import WebKit2"], { stdout: "ignore", stderr: "ignore" })
  : null;

// ASCII-only PDF: each page contains white, black, vector blue, and an actual
// image XObject. The red image must survive reverse-video in both cropped and
// full-page output; the adjacent vector color must not be mistaken for an image.
function pdf(pages: number) {
  const image = "E02010".repeat(16 * 16) + ">";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Count ${pages} /Kids [${Array.from({ length: pages }, (_, i) => `${5 + i * 2} 0 R`).join(" ")}] >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Type /XObject /Subtype /Image /Width 16 /Height 16 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length ${image.length} >>\nstream\n${image}\nendstream`,
  ];
  for (let page = 0; page < pages; page++) {
    const stream = `1 1 1 rg 0 0 512 512 re f\n0.2 0.35 0.6 rg 128 352 32 96 re f\nq 48 0 0 96 64 352 cm /Im1 Do Q\n0 0 0 rg BT /F1 18 Tf 24 480 Td (Detail page ${page + 1}) Tj ET\n`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 512 512] /Resources << /Font << /F1 3 0 R >> /XObject << /Im1 4 0 R >> >> /Contents ${6 + page * 2} 0 R >>`,
      `<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
    );
  }
  let source = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, i) => { offsets.push(source.length); source += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = source.length;
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  source += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  return new TextEncoder().encode(source + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
}
function replaceOnce(code: string, anchor: string, replacement: string) {
  if (code.split(anchor).length !== 2) throw new Error(`Detail observation anchor absent or ambiguous: ${anchor}`);
  return code.replace(anchor, replacement);
}

test.skipIf(!probe || probe.exitCode !== 0)("real WebKit main/detail pixels, compositor filters, CPU cancellation and ownership", async () => {
  const directory = await mkdtemp(join(tmpdir(), "clio-detail-runtime-"));
  let server: Server<undefined> | undefined;
  let child: Subprocess<"ignore", "pipe", "pipe"> | undefined;
  try {
    const built = await build({
      configFile: false, root: join(import.meta.dir, ".."), logLevel: "error",
      plugins: [{
        name: "test-only-detail-observation", enforce: "pre",
        transform(code, id) {
          const path = id.split("?")[0]!;
          if (path.endsWith("/src/pdf/PdfViewerSurface.tsx")) {
            const anchor = "  const cancelRecolorRef = useRef<() => void>(() => {});";
            code = replaceOnce(code, anchor, `  window.__pdfDetail = { ...window.__pdfDetail, map: pristineCanvasesRef.current, details: detailPristineCanvasesRef.current, viewerHandle, pdf };\n${anchor}`);
            const active = "let active: PageRecolorRequest | null = null;";
            code = replaceOnce(code, active, `${active}\n    Object.assign(window.__pdfDetail, { queue: requests, active: () => active, timer: () => queuedTimer });`);
            // Test only: normal scale .6 stays below the cap; scale 2 crosses
            // it. Actual DPR and crop dimensions are reported, not assumed.
            code = replaceOnce(code, "viewer = new PDFViewer({", "viewer = new PDFViewer({\n        maxCanvasPixels: 1_500_000,");
            return { code, map: null };
          }
          if (!path.endsWith("/src/pdf/recolor.ts")) return;
          const singleton = "RecolorShaderRenderer.instance = new RecolorShaderRenderer();";
          code = replaceOnce(code, singleton, `const originalGetContext = HTMLCanvasElement.prototype.getContext;
            if (new URLSearchParams(location.search).get("backend") === "cpu") {
              HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
                return kind === "webgl2" ? null : Reflect.apply(originalGetContext, this, [kind, ...args]);
              };
            }
            try { ${singleton} } finally { HTMLCanvasElement.prototype.getContext = originalGetContext; }
            window.__detailCpu.gpuReady = !!(RecolorShaderRenderer.instance.gl && RecolorShaderRenderer.instance.program);`);
          code = replaceOnce(code, "gl.drawArrays(gl.TRIANGLES, 0, 6);", "gl.drawArrays(gl.TRIANGLES, 0, 6); window.__detailCpu.gpuDraws++;");
          code = replaceOnce(code, "export async function recolorImageDataCpuCooperative(", "async function recolorImageDataCpuCooperativeObserved(");
          code += `\nexport function recolorImageDataCpuCooperative(...args: Parameters<typeof recolorImageDataCpuCooperativeObserved>): Promise<boolean> {
            return window.__detailCpu.invoke(() => recolorImageDataCpuCooperativeObserved(...args));
          }\n`;
          code = replaceOnce(code, "await yieldToTask()", "await window.__detailCpu.yield(options, yieldToTask)");
          code = replaceOnce(code, "batchFinished - chunkStarted < 7", "batchFinished - chunkStarted < (window.__detailCpu.hold ? 0 : 7)");
          code = replaceOnce(code, "imgData = srcCtx.getImageData(0, 0, width, height);", "imgData = srcCtx.getImageData(0, 0, width, height); window.__detailCpu.buffers++; window.__detailCpu.maxBuffers = Math.max(window.__detailCpu.maxBuffers, window.__detailCpu.buffers);");
          code = replaceOnce(code, "      imgData = null;", "      if (imgData) window.__detailCpu.buffers--;\n      imgData = null;");
          return { code, map: null };
        },
      }, react()],
      build: { write: false, outDir: directory, emptyOutDir: false, rollupOptions: { input: join(import.meta.dir, "fixtures/pdf-detail-rendering-runtime.html") } },
    });
    if (Array.isArray(built) || !("output" in built)) throw new Error("Expected one detail runtime bundle");
    const assets = new Map<string, string | Uint8Array>();
    let html = "";
    for (const output of built.output) {
      const content = output.type === "chunk" ? output.code : output.source;
      assets.set("/" + output.fileName, content);
      if (output.fileName.endsWith(".html")) html = String(content);
    }
    assets.set("/__fixtures/long.pdf", pdf(12));
    assets.set("/__fixtures/short.pdf", pdf(1));
    const epub = Bun.spawnSync([python!, join(import.meta.dir, "fixtures/create-epub-lifecycle-document.py"), directory], { stdout: "pipe", stderr: "pipe" });
    if (epub.exitCode !== 0) throw new Error(new TextDecoder().decode(epub.stderr));
    assets.set("/__fixtures/lifecycle.epub", new Uint8Array(await readFile(join(directory, "lifecycle.epub"))));
    server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/") return new Response(html, { headers: { "content-type": "text/html" } });
      const asset = assets.get(path);
      return asset === undefined ? new Response(null, { status: 404 }) : new Response(asset, { headers: {
        "content-type": /\.(?:js|mjs)$/.test(path) ? "application/javascript" : path.endsWith(".css") ? "text/css" : "application/octet-stream",
      } });
    } });
    // Separate processes ensure the native shader and forced cooperative fallback
    // cannot accidentally share a singleton or inherit each other's observations.
    for (const backend of ["gpu", "cpu"]) {
      child = Bun.spawn([python!, join(import.meta.dir, "fixtures/run-pdf-detail-webkit.py"), `http://127.0.0.1:${server.port}/?backend=${backend}`], {
        env: { ...process.env, GDK_BACKEND: process.env.DISPLAY ? "x11" : "wayland", GDK_SCALE: "2", GDK_DPI_SCALE: "1" }, stdout: "pipe", stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      if (exitCode !== 0) throw new Error(`WebKit detail ${backend} failed:\n${stdout}\n${stderr}`);
      const result = JSON.parse(stdout);
      expect(result.passed).toBe(true);
      expect(result.errors).toEqual([]);
      if (backend === "gpu") {
        expect(result.cpu.gpuReady).toBe(true);
        expect(result.cpu.gpuDraws).toBeGreaterThan(0);
        expect(result.cpu.started).toBe(0);
      } else {
        expect(result.cpu.gpuReady).toBe(false);
        expect(result.cpu.maxActive).toBe(1);
        expect(result.cpu.maxBuffers).toBe(1);
        expect(result.cpu.started).toBe(result.cpu.settled);
        expect(result.cpu.discarded).toBeGreaterThan(0);
        expect(result.cpu.yields).toBeGreaterThan(0);
      }
      expect(result.cpu.buffers).toBe(0);
      console.info(`WebKit detail ${backend}:`, JSON.stringify(result));
    }
  } finally {
    child?.kill(); server?.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
}, 240_000);
