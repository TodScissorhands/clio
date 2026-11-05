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

// A bounded, self-contained PDF with real page streams, text and colored artwork.
function pdf(pages: number): Uint8Array {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Count ${pages} /Kids [${Array.from({ length: pages }, (_, index) => `${4 + index * 2} 0 R`).join(" ")}] >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  for (let page = 0; page < pages; page++) {
    const stream = `1 1 1 rg 0 0 420 540 re f\n0.2 0.35 0.6 rg 30 350 360 90 re f\n0 0 0 rg BT /F1 24 Tf 30 490 Td (Lifecycle page ${page + 1} of ${pages}) Tj ET\n`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 540] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + page * 2} 0 R >>`,
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

test.skipIf(!probe || probe.exitCode !== 0)("Clio pristine canvases follow real PDF/WebKit component lifetimes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "clio-pristine-lifecycle-test-"));
  let server: Server<undefined> | undefined;
  let child: Subprocess<"ignore", "pipe", "pipe"> | undefined;
  try {
    const built = await build({
      configFile: false,
      root: join(import.meta.dir, ".."),
      plugins: [{
        name: "test-only-pristine-observation",
        enforce: "pre",
        transform(code, id) {
          if (!id.split("?")[0]!.endsWith("/src/pdf/PdfViewerSurface.tsx")) return;
          const mapAnchor = "  const pristineCanvasesRef = useRef<Map<number, HTMLCanvasElement>>(new Map());";
          const loadAnchor = "void loadPdfJsViewer().then(";
          for (const anchor of [mapAnchor, loadAnchor]) {
            if (code.split(anchor).length !== 2) throw new Error(`Lifecycle observation anchor is ambiguous or absent: ${anchor}`);
          }
          code = code.replace(mapAnchor, `${mapAnchor}\n  window.__pdfLifecycle = { map: pristineCanvasesRef.current, viewerHandle, pdf };`);
          code = code.replace(loadAnchor, "void (window.__pdfViewerGate ? window.__pdfViewerGate.then(() => loadPdfJsViewer()) : loadPdfJsViewer()).then(");
          return { code, map: null };
        },
      }, react()],
      logLevel: "error",
      build: {
        write: false, outDir: directory, emptyOutDir: false,
        rollupOptions: { input: join(import.meta.dir, "fixtures/pdf-pristine-lifecycle-runtime.html") },
      },
    });
    if (Array.isArray(built) || !("output" in built)) throw new Error("Expected one lifecycle test bundle");
    const assets = new Map<string, string | Uint8Array>();
    let html = "";
    for (const output of built.output) {
      const content = output.type === "chunk" ? output.code : output.source;
      assets.set("/" + output.fileName, content);
      if (output.fileName.endsWith(".html")) html = String(content);
    }
    assets.set("/__fixtures/long.pdf", pdf(12));
    assets.set("/__fixtures/short.pdf", pdf(1));
    assets.set("/__fixtures/corrupt.pdf", new TextEncoder().encode("Not a PDF: isolated lifecycle fixture."));
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
      env: { ...process.env, GDK_BACKEND: "x11" }, stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    if (exitCode !== 0) throw new Error(`WebKit pristine lifecycle regression failed:\n${stdout}\n${stderr}`);
    const result = JSON.parse(stdout);
    expect(result.passed).toBe(true);
    console.info("WebKit pristine lifecycle results:", JSON.stringify(result));
  } finally {
    child?.kill();
    server?.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);
