import { expect, test } from "bun:test";
import react from "@vitejs/plugin-react";
import { build } from "vite";
import type { Server, Subprocess } from "bun";
import { join } from "node:path";

// Real text, dense reading context, a two-line phrase and an image XObject.
function pdf(pages: number) {
  const image = "E02010".repeat(16 * 16) + ">";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Count ${pages} /Kids [${Array.from({ length: pages }, (_, i) => `${5 + i * 2} 0 R`).join(" ")}] >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Type /XObject /Subtype /Image /Width 16 /Height 16 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length ${image.length} >>\nstream\n${image}\nendstream`,
  ];
  for (let page = 0; page < pages; page++) {
    const text = (x: number, y: number, value: string) => `BT /F1 16 Tf ${x} ${y} Td (${value}) Tj ET\n`;
    const stream = "1 1 1 rg 0 0 800 1000 re f\nq 72 0 0 72 300 860 cm /Im1 Do Q\n0 0 0 rg\n"
      + "/Span BMC\n" + text(48, 800, "Before needle after") + "EMC\n" + text(680, 500, "needle")
      + text(48, 300, "Before split") + text(48, 270, "phrase after")
      + text(48, 150, "Another needle here")
      + Array.from({ length: 18 }, (_, i) => text(48, 750 - i * 20, `Reading context line ${i + 1} on page ${page + 1}.`)).join("");
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 800 1000] /Resources << /Font << /F1 3 0 R >> /XObject << /Im1 4 0 R >> >> /Contents ${6 + page * 2} 0 R >>`,
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

test("real WebKit PDF search markers, reveal, transitions and document ownership", async () => {
  const python = Bun.which("python3");
  expect(python, "Python is required for native WebKit search acceptance").toBeTruthy();
  expect(process.env.DISPLAY || process.env.WAYLAND_DISPLAY, "A native display is required; search rendering must not skip").toBeTruthy();
  let server: Server<undefined> | undefined;
  let child: Subprocess<"ignore", "pipe", "pipe"> | undefined;
  try {
    const built = await build({
      configFile: false, root: join(import.meta.dir, ".."), logLevel: "error",
      plugins: [{ name: "search-render-observation", enforce: "pre", transform(code, id) {
        if (!id.split("?")[0]!.endsWith("/src/pdf/PdfViewerSurface.tsx")) return;
        const anchor = "  const cancelRecolorRef = useRef<() => void>(() => {});";
        if (code.split(anchor).length !== 2) throw new Error("Search viewer observation anchor changed");
        return { code: code.replace(anchor, `  window.__searchViewer = viewerHandle;\n${anchor}`)
          .replace("viewer = new PDFViewer({", "viewer = new PDFViewer({\n        maxCanvasPixels: 500_000,"), map: null };
      } }, react()],
      build: { write: false, rollupOptions: { input: join(import.meta.dir, "fixtures/pdf-search-rendering-runtime.html") } },
    });
    if (Array.isArray(built) || !("output" in built)) throw new Error("Expected one search runtime bundle");
    const assets = new Map<string, string | Uint8Array>();
    let html = "";
    for (const output of built.output) {
      const content = output.type === "chunk" ? output.code : output.source;
      assets.set("/" + output.fileName, content);
      if (output.fileName.endsWith(".html")) html = String(content);
    }
    assets.set("/__fixtures/search.pdf", pdf(3));
    assets.set("/__fixtures/replacement.pdf", pdf(1));
    assets.set("/__fixtures/invalid.pdf", "not a PDF");
    server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/") return new Response(html, { headers: { "content-type": "text/html" } });
      const asset = assets.get(path);
      return asset === undefined ? new Response(null, { status: 404 }) : new Response(asset, { headers: {
        "content-type": /\.(?:js|mjs)$/.test(path) ? "application/javascript" : path.endsWith(".css") ? "text/css" : "application/octet-stream",
      } });
    } });
    child = Bun.spawn([python!, join(import.meta.dir, "fixtures/run-pdf-detail-webkit.py"), `http://127.0.0.1:${server.port}/`], {
      env: { ...process.env, GDK_BACKEND: process.env.DISPLAY ? "x11" : "wayland", GDK_SCALE: "1", GDK_DPI_SCALE: "1" }, stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (exitCode !== 0) console.info(stdout);
    if (exitCode !== 0) throw new Error(`WebKit search failed:\n${stdout}\n${stderr}`);
    const result = JSON.parse(stdout);
    expect(result.passed).toBe(true);
    expect(result.errors).toEqual([]);
    console.info("WebKit search:", JSON.stringify(result));
  } finally { child?.kill(); server?.stop(true); }
}, 150_000);
