import { expect, test } from "bun:test";
import { join } from "node:path";

test("publication boundary blocks redirects, scripts and external resources in WebKitGTK", async () => {
  if (!process.env.DISPLAY) throw new Error("Native DISPLAY required for Foliate security acceptance");
  const result = await Bun.build({ entrypoints: [join(import.meta.dir, "../src/epub/foliateSecurity.ts")], target: "browser" });
  expect(result.success).toBe(true);
  const script = await result.outputs[0].text();
  const requests: string[] = [];
  const html = `<!doctype html><body><script type="module">
${script.replace(/export\s*\{[^}]*\};?\s*$/, "")}
try {
  window.canary = false;
  const input = '<html xmlns="http://www.w3.org/1999/xhtml"><head><meta http-equiv="refresh" content="0;url=../bootstrap.html" /><base href="https://example.invalid/"/><style>body{color:rgb(10,20,30);background:url(/network-canary)}</style></head><body onload="parent.canary=true"><script>parent.canary=true<\\/script><iframe src="/bootstrap.html"></iframe><object data="/bootstrap.html"></object><a id="internal" href="chapter2.xhtml#passage">Chapter</a><a href="javascript:parent.canary=true">Unsafe</a><p id="text">Ordinary selectable text</p><input value="Editable"/><img src="https://example.invalid/canary"/></body></html>';
  const publication = input.replace('</head>', '<meta name="viewport" content="width=800,height=600"/><meta name="viewport" http-equiv="refresh" content="0;url=../bootstrap.html"/></head>');
  const frame = document.createElement('iframe');
  frame.sandbox = 'allow-same-origin allow-scripts';
  frame.srcdoc = sanitizePublication(publication, 'application/xhtml+xml');
  document.body.append(frame);
  const loaded = Promise.withResolvers();
  frame.onload = loaded.resolve;
  await loaded.promise;
  // Real WebKit declarative navigation has no completion signal when correctly blocked.
  const quiet = Promise.withResolvers();
  setTimeout(quiet.resolve, 500);
  await quiet.promise;
  const doc = frame.contentDocument;
  if (window.canary || !doc.getElementById('text') || doc.querySelector('script,base,iframe,object,meta[http-equiv="refresh"]')) throw Error('Active content or redirect survived');
  if (doc.getElementById('internal').getAttribute('href') !== 'chapter2.xhtml#passage') throw Error('Internal link lost');
  if (doc.querySelector('a[href^="javascript:"]')) throw Error('Executable link survived');
  if (getComputedStyle(doc.body).color !== 'rgb(10, 20, 30)') throw Error('Publisher style lost');
  if (doc.querySelector('meta[name="viewport"]')?.getAttribute('content') !== 'width=800,height=600') throw Error('Fixed-layout viewport lost');
  let rejected = false;
  try { sanitizePublication('<html><broken>', 'application/xhtml+xml'); } catch { rejected = true; }
  if (!rejected) throw Error('Malformed XML accepted');
  const svg = new DOMParser().parseFromString(sanitizePublication('<svg xmlns="http://www.w3.org/2000/svg" xml:base="https://example.invalid/"><g id="geometry" transform="translate(2 3)"><rect width="10" height="20" fill="url(https://example.invalid/paint)"/></g></svg>', 'image/svg+xml'), 'image/svg+xml');
  if (svg.documentElement.hasAttribute('xml:base') || svg.querySelector('rect').hasAttribute('fill')) throw Error('SVG external resource resolution survived');
  if (svg.getElementById('geometry').getAttribute('transform') !== 'translate(2 3)') throw Error('SVG geometry was lost');
  window.webkit.messageHandlers.test.postMessage(JSON.stringify({passed:true, redirectBlocked:true, scriptBlocked:true, publisherStyle:true, internalLink:true}));
} catch(error) { window.webkit.messageHandlers.test.postMessage(JSON.stringify({passed:false,error:String(error)})); }
</script>`;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    const path = new URL(request.url).pathname;
    if (path !== "/") requests.push(path);
    return new Response(path === "/" ? html : "Unexpected resource", { headers: { "content-type": "text/html" } });
  } });
  try {
    const child = Bun.spawn(["python3", join(import.meta.dir, "fixtures/run-palette-webkit.py"), server.url.href], { env: { ...process.env, GDK_BACKEND: "x11" }, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (code !== 0) throw new Error(stdout + stderr);
    expect(JSON.parse(stdout).passed).toBe(true);
    expect(requests).toEqual([]);
    console.info(stdout.trim());
  } finally { server.stop(true); }
}, 100_000);
