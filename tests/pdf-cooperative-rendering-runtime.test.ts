import { expect, test } from "bun:test";
import type { Server, Subprocess } from "bun";
import react from "@vitejs/plugin-react";
import { build } from "vite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const python = Bun.which("python3");
const probe = process.platform === "linux" && process.env.DISPLAY && python
  ? Bun.spawnSync([python, "-c", "import gi; gi.require_version('WebKit2', '4.1'); from gi.repository import WebKit2"], { stdout: "ignore", stderr: "ignore" })
  : null;

// Bounded vector-only pages keep the pixel reference independent of image-region
// discovery, while still going through the real PDF.js parser and canvas painter.
function pdf(pages: number): Uint8Array {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Count ${pages} /Kids [${Array.from({ length: pages }, (_, index) => `${4 + index * 2} 0 R`).join(" ")}] >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  for (let page = 0; page < pages; page++) {
    const stream = `1 1 1 rg 0 0 512 512 re f\n0.2 0.35 0.6 rg 24 240 464 100 re f\n0.8 0.2 0.1 rg 40 80 140 120 re f\n0 0 0 rg BT /F1 24 Tf 24 460 Td (CPU page ${page + 1} of ${pages}) Tj ET\n`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 512 512] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + page * 2} 0 R >>`,
      `<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
    );
  }
  let source = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(source.length);
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = source.length;
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  source += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(source);
}

function replaceOnce(code: string, anchor: string, replacement: string) {
  if (code.split(anchor).length !== 2) throw new Error(`Cooperative test observation anchor is ambiguous or absent: ${anchor}`);
  return code.replace(anchor, replacement);
}

test.skipIf(!probe || probe.exitCode !== 0)("Clio real WebKit cooperative CPU rendering is transactional, latest-wins and bounded", async () => {
  const directory = await mkdtemp(join(tmpdir(), "clio-cooperative-runtime-test-"));
  let server: Server<undefined> | undefined;
  let child: Subprocess<"ignore", "pipe", "pipe"> | undefined;
  try {
    const built = await build({
      configFile: false,
      root: join(import.meta.dir, ".."),
      plugins: [{
        name: "test-only-cooperative-observation",
        enforce: "pre",
        transform(code, id) {
          const path = id.split("?")[0]!;
          if (path.endsWith("/src/pdf/PdfViewerSurface.tsx")) {
            const mapAnchor = "  const pristineCanvasesRef = useRef<Map<number, HTMLCanvasElement>>(new Map());";
            code = replaceOnce(code, mapAnchor, `${mapAnchor}\n  window.__pdfCooperative = { ...window.__pdfCooperative, map: pristineCanvasesRef.current, viewerHandle, pdf };`);
            const activeAnchor = "let active: PageRecolorRequest | null = null;";
            code = replaceOnce(code, activeAnchor, `${activeAnchor}\n    Object.assign(window.__pdfCooperative, { queue: requests, active: () => active, timer: () => queuedTimer, completedSource: (canvas: HTMLCanvasElement) => completed.get(canvas)?.pristine });`);
            return { code, map: null };
          }
          if (!path.endsWith("/src/pdf/recolor.ts")) return;
          // Only the singleton's constructor sees the WebGL override. PDF.js and
          // the rest of the runtime retain the native getContext implementation.
          const singleton = "RecolorShaderRenderer.instance = new RecolorShaderRenderer();";
          code = replaceOnce(code, singleton, `const originalGetContext = HTMLCanvasElement.prototype.getContext;
            HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
              return kind === "webgl2" ? null : Reflect.apply(originalGetContext, this, [kind, ...args]);
            };
            try { ${singleton} } finally { HTMLCanvasElement.prototype.getContext = originalGetContext; }`);
          const declaration = "export async function recolorImageDataCpuCooperative(";
          code = replaceOnce(code, declaration, "async function recolorImageDataCpuCooperativeObserved(");
          code += `\nexport function recolorImageDataCpuCooperative(...args: Parameters<typeof recolorImageDataCpuCooperativeObserved>): Promise<boolean> {
            return window.__cpuTest.invoke(() => recolorImageDataCpuCooperativeObserved(...args));
          }\n`;
          code = replaceOnce(code, "await yieldToTask()", "await window.__cpuTest.yield(options, yieldToTask)");
          // Holding races must be deterministic even on machines that can finish
          // 512px pages in one budget. This only shortens the test chunk; every
          // pixel, cancellation check, native task yield and commit stays real.
          code = replaceOnce(code, "batchFinished - chunkStarted < 7", "batchFinished - chunkStarted < (window.__cpuTest.hold ? 0 : 7)");
          const readback = "imgData = srcCtx.getImageData(0, 0, width, height);";
          code = replaceOnce(code, readback, `${readback}\n      window.__cpuTest.buffers++;\n      window.__cpuTest.maxBuffers = Math.max(window.__cpuTest.maxBuffers, window.__cpuTest.buffers);`);
          code = replaceOnce(code, "      imgData = null;", "      if (imgData) window.__cpuTest.buffers--;\n      imgData = null;");
          return { code, map: null };
        },
      }, react()],
      logLevel: "error",
      build: {
        write: false, outDir: directory, emptyOutDir: false,
        rollupOptions: { input: join(import.meta.dir, "fixtures/pdf-cooperative-rendering-runtime.html") },
      },
    });
    if (Array.isArray(built) || !("output" in built)) throw new Error("Expected one cooperative runtime bundle");
    const assets = new Map<string, string | Uint8Array>();
    let html = "";
    for (const output of built.output) {
      const content = output.type === "chunk" ? output.code : output.source;
      assets.set("/" + output.fileName, content);
      if (output.fileName.endsWith(".html")) html = String(content);
    }
    assets.set("/__fixtures/long.pdf", pdf(12));
    assets.set("/__fixtures/short.pdf", pdf(1));
    assets.set("/__fixtures/corrupt.pdf", new TextEncoder().encode("Not a PDF: isolated cooperative CPU fixture."));
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
    if (exitCode !== 0) throw new Error(`WebKit cooperative rendering regression failed:\n${stdout}\n${stderr}`);
    const result = JSON.parse(stdout);
    expect(result.passed).toBe(true);
    expect(result.cases).toHaveLength(12);
    expect(result.cpu.started).toBe(result.cpu.settled);
    expect(result.cpu.maxActive).toBe(1);
    expect(result.cpu.maxBuffers).toBe(1);
    expect(result.cpu.buffers).toBe(0);
    expect(result.cpu.pendingGates).toBe(0);
    expect(result.errors).toEqual([]);
    console.info("WebKit cooperative CPU rendering results:", JSON.stringify(result));
  } finally {
    child?.kill(); server?.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);
