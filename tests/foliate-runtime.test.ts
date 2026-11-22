import { expect, test } from "bun:test";
import react from "@vitejs/plugin-react";
import { build } from "vite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test.each(["complete", "positions"] as const)("Foliate %s real EPUB acquisition, navigation, search, CFI and cleanup in WebKitGTK", async mode => {
  if (!process.env.DISPLAY) throw Error("Native DISPLAY required for Foliate acceptance");
  const realDirectory = process.env.CLIO_FOLIATE_REAL_BOOKS;
  if (mode === "positions" && !realDirectory) throw Error("CFI compatibility requires CLIO_FOLIATE_REAL_BOOKS with both real EPUB fixtures");
  const realBooks = ["gutenberg-11.epub", "gutenberg-1342.epub"];
  if (realDirectory) for (const name of realBooks) {
    if (!await Bun.file(join(realDirectory, name)).exists()) throw Error(`Missing real EPUB fixture: ${name}`);
  }
  const moby = !!realDirectory && await Bun.file(join(realDirectory, "standardebooks-moby-dick.epub")).exists();
  if (moby) realBooks.push("standardebooks-moby-dick.epub");
  const directory = await mkdtemp(join(tmpdir(), "clio-foliate-runtime-"));
  const built = await build({
    configFile: false, root: join(import.meta.dir, ".."), plugins: [{
      name: "cfi-position-observation", enforce: "pre" as const,
      transform(source, id) {
        if (mode !== "positions" || !id.endsWith("/src/platform/readingPosition.ts")) return;
        return source
          .replace("export async function loadEpubReadingPosition(path: string): Promise<EpubReadingPosition | null> {",
            "export async function loadEpubReadingPosition(path: string): Promise<EpubReadingPosition | null> {\n  return window.__cfiPositions.get(path) ?? null;")
          .replace("export async function saveEpubReadingPosition(path: string, position: EpubReadingPosition): Promise<void> {",
            "export async function saveEpubReadingPosition(path: string, position: EpubReadingPosition): Promise<void> {\n  window.__cfiWrites.push({ path, position }); window.__cfiPositions.set(path, position); return;");
      },
    }, react()], logLevel: "error",
    build: { write: false, outDir: directory, emptyOutDir: false, rollupOptions: { input: join(import.meta.dir, "fixtures/foliate-runtime.html") } },
  });
  if (Array.isArray(built) || !("output" in built)) throw Error("Expected one runtime bundle");
  const assets = new Map<string, string | Uint8Array>();
  let html = "";
  for (const output of built.output) {
    const content = output.type === "chunk" ? output.code : output.source;
    assets.set("/" + output.fileName, content);
    if (output.fileName.endsWith(".html")) html = String(content);
  }
  let backgroundRequests = 0;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/__publication-background") { backgroundRequests++; return new Response(null, { status: 204 }); }
    if (path.startsWith("/__fixtures/")) {
      const name = path.split("/").pop()!;
      return new Response(Bun.file(join(realDirectory && realBooks.includes(name) ? realDirectory : directory, name)));
    }
    if (path === "/") return new Response(html, { headers: { "content-type": "text/html" } });
    const content = assets.get(path);
    if (content === undefined) return new Response(null, { status: 404 });
    return new Response(content, { headers: { "content-type": path.endsWith(".js") ? "application/javascript" : path.endsWith(".css") ? "text/css" : "application/octet-stream" } });
  } });
  const generated = Bun.spawnSync(["python3", join(import.meta.dir, "fixtures/create-foliate-security-document.py"), directory], { env: { ...process.env, CLIO_SECURITY_ORIGIN: server.url.origin } });
  if (generated.exitCode) { server.stop(true); throw Error(new TextDecoder().decode(generated.stderr)); }
  const query = new URLSearchParams();
  if (mode === "positions") query.set("positions", "1");
  if (realDirectory) query.set("real", "1");
  if (moby) query.set("moby", "1");
  const child = Bun.spawn(["python3", join(import.meta.dir, "fixtures/run-palette-webkit.py"), `${server.url.href}?${query}`], { env: { ...process.env, GDK_BACKEND: "x11" }, stdout: "pipe", stderr: "pipe" });
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (code) throw Error(stdout + stderr);
    const result = JSON.parse(stdout);
    expect(result.passed).toBe(true);
    expect(backgroundRequests).toBe(0);
    console.info("Foliate runtime:", stdout.trim());
  } finally { child.kill(); server.stop(true); await rm(directory, { recursive: true, force: true }); }
}, 120_000);
