import { expect, test } from "bun:test";
import type { Server, Subprocess } from "bun";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Uses installed native tooling, without adding a browser/DOM dependency. Other
// platforms or headless environments report this integration test as skipped.
const python = Bun.which("python3");
const probe = process.platform === "linux" && process.env.DISPLAY && python
  ? Bun.spawnSync([python, "-c", "import gi; gi.require_version('WebKit2', '4.1'); from gi.repository import WebKit2"], { stdout: "ignore", stderr: "ignore" })
  : null;

test.skipIf(!probe || probe.exitCode !== 0)("shared palette and keyboard integration in real WebKitGTK", async () => {
  const directory = await mkdtemp(join(tmpdir(), "clio-palette-test-"));
  let server: Server<undefined> | undefined;
  let child: Subprocess<"ignore", "pipe", "pipe"> | undefined;
  try {
    const build = await Bun.build({
      entrypoints: [join(import.meta.dir, "fixtures/reader-command-palette-runtime.tsx")],
      outdir: directory,
      target: "browser",
      naming: "[name].[ext]",
    });
    expect(build.success).toBe(true);
    const script = build.outputs.find((output) => output.path.endsWith(".js"))!;
    const styles = ["index.css", "App.css", "reader/Reader.css"];
    const assets = new Map<string, { bytes: Uint8Array; type: string }>();
    for (const output of build.outputs) {
      assets.set("/" + output.path.split("/").pop(), {
        bytes: new Uint8Array(await readFile(output.path)), type: output.type,
      });
    }
    for (const path of styles) {
      assets.set("/" + path, {
        bytes: new Uint8Array(await readFile(join(import.meta.dir, "../src", path))), type: "text/css",
      });
    }
    const html = `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1">${styles.map((path) =>
      `<link rel="stylesheet" href="/${path}">`).join("")}</head>
      <body><div id="root"></div><script type="module" src="/${script.path.split("/").pop()}"></script></body></html>`;
    server = Bun.serve({
      hostname: "127.0.0.1", port: 0,
      fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/") return new Response(html, { headers: { "content-type": "text/html" } });
        const asset = assets.get(path);
        return asset ? new Response(asset.bytes, { headers: { "content-type": asset.type } }) : new Response(null, { status: 404 });
      },
    });
    child = Bun.spawn(["python3", join(import.meta.dir, "fixtures/run-palette-webkit.py"), `http://127.0.0.1:${server.port}/`], {
      env: { ...process.env, GDK_BACKEND: "x11" }, stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    if (exitCode !== 0) throw new Error(`WebKit palette regression failed:\n${stdout}\n${stderr}`);
    const result = JSON.parse(stdout);
    expect(result.passed).toBe(true);
    expect(result.results.map((entry: { width: number; dark: boolean }) => [entry.width, entry.dark])).toEqual([
      [1000, false], [1000, true], [420, false], [420, true], [1440, false], [1440, true],
    ]);
    console.info("WebKit palette contrast/viewport results:", JSON.stringify(result.results));
  } finally {
    child?.kill();
    server?.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
}, 90_000);
