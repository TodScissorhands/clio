# Cooperative PDF CPU recoloring

`RecolorShaderRenderer.render()` returns a synchronous boolean for the existing WebGL path and a `Promise<boolean>` for CPU fallback. A true result means the complete, current image was published. False means unavailable contexts, invalid dimensions or a superseded/cancelled request. Actual processing/readback errors propagate to the surface's existing render-error callback.

The SVG color matrix and WebGL shader calculations are unchanged. CPU processing and the synchronous reference share the accepted `recolorPixelZathura` calculation and RGB byte stores; alpha is not changed. Image preservation still checks every supplied rectangle, including inclusive boundaries. The CPU path does not inherit the shader's existing 64-rectangle limit.

## Bounded CPU work

The private `CpuRecolorProcessor` performs a bounded synchronous batch, retaining only pixel and rectangle cursors between batches. A rectangle list can span checkpoints without finishing its current pixel. Finishing a matched or exhausted list may consume one additional pixel operation. No rectangle list is an indivisible unit of work.

The asynchronous controller starts with 128 work units, adapts batches toward roughly 1 ms using measured cost, and bounds batches to 16–65,536 units. Pixels and rectangle comparisons count toward the budget. It targets roughly 7 ms of processing before yielding through an invocation-owned `MessageChannel`. The hot batch loop stays synchronous; timing, cancellation and yielding remain outside it.

The channel is created only when a yield is needed. Abort and normal completion close both ports, remove the message callback and abort listener, and settle any pending yield. This is a real platform task boundary, not a microtask-only `Promise.resolve()` loop.

The target is cooperative responsiveness, not a hard real-time deadline. A checkpoint can overrun its target, and garbage collection, PDF.js work, synchronous canvas readback/upload and WebGL calls can still delay the event loop.

## Transactional publication

CPU fallback reads one isolated `ImageData` from the pristine source. It never transforms the live PDF.js canvas incrementally. After all batches finish, it revalidates currentness immediately before `putImageData()`. Source and target dimensions must still match their captured dimensions. A discarded operation's partly transformed buffer is never published; task-owned image/context references are released in `finally`.

The surface's currentness check also validates:

- The committed H02B1 document identity and the viewer's document.
- Current page-view, main/detail rendering owner, target canvas and pristine-source identities.
- That renderer's finished state and source/target dimensions.
- The settings object, abort signal and latest per-canvas request identity.

A new main-page bitmap refreshes only the main pristine source. A completed detail bitmap gets its own crop-sized pristine copy when pixel recoloring is needed. CSS-only and detail-view events never recapture the recolored main output. Detail copies are released when PDF.js replaces/removes their output canvas, evicts the page, or the document closes. SVG-only detail rendering needs no extra pristine allocation.

PDF.js positions detail canvases using full-page percentages. Image-preservation rectangles are intersected with that crop and normalized to its bitmap before invoking the unchanged shader/CPU processor. Detail resolution and PDF.js canvas ownership are preserved.

## Cached pages and cancellation

Each surface has one active operation and a replaceable map of pending canvas requests, shared by main and detail outputs, not a promise per queued canvas. Stale requests are removed at pruning and refresh boundaries. The current page takes priority; newly available current-page content can preempt background CPU work. Remaining connected pages are prioritized by distance from the current page, before detached cached pages. Operations are separated by a platform timer task rather than drained in a synchronous loop.

The real `pagerender` event hides pixel-mode targets before PDF.js can insert a progressive or completed raw canvas. Appearance changes also hide previous DOM canvases and off-DOM render targets. Only a completed current result restores its canvas's original visibility; cancellation does not reveal raw or old-theme pixels. Visibility ownership survives supersession, so an older completion cannot reveal or delete a newer request. Abandoned previous outputs stay hidden until PDF.js removes them.

Settings changes, document cleanup, geometry changes, page rerendering/eviction and unmount invalidate work. Document cleanup cancels before zeroing Clio-owned main/detail pristine canvases and clearing their maps. It never zeroes live PDF.js output canvases or changes PDF.js cache policy. Failed replacement leaves the committed document and its pristine resources valid.

Completed-render metadata is a weak map keyed by PDF.js output canvases, but its values reference pristine sources. Document cleanup drops the entire metadata map as well: a PDF.js target retained elsewhere must not keep a previous document's pristine source reachable through Clio's completion bookkeeping. Same-document settings/geometry updates retain usable metadata.

`onPageRendered` remains a geometry/restoration signal; it is not a CPU-pixel-completion promise. Text-layer completion already uses that callback independently. Navigation and restoration must not wait for recoloring to finish.

## Regression coverage

- `tests/pdf-recolor-cooperative.test.ts`: exact RGBA equivalence against the accepted synchronous traversal, all setting flags and presets/custom colors, requested rectangle counts, overlapping/nonmatching/full/partial coverage, alpha, dimensions, mid-list suspension, cancellation and transactional/error boundaries.
- `tests/pdf-cooperative-rendering-runtime.test.ts`: real component/PDF.js/WebKit lifecycle, supersession, disable, close/replacement, invalid replacement in the actual App, zoom/viewport resize, navigation, cached pages, unmount/reopen and pristine zeroing. CPU forcing, observation and deterministic task-yield gating exist only in the test bundle.
- `tests/pdf-detail-rendering-runtime.test.ts`: separate native WebKit shader and forced-CPU runs; composited SVG/Original/pixel output, image preservation, real detail creation/replacement, repeated zoom, held CPU supersession/cancellation, cache eviction, layouts, stale events, close/reopen/unmount and actual App PDF/EPUB replacement. The fixture lowers PDF.js's canvas cap to 1,500,000 pixels solely to bound allocations; production limits are unchanged. Its compositor runner uses the installed WebKitGTK/Cairo C APIs through Python's standard-library `ctypes`, without requiring Pycairo.
- Existing pristine-lifecycle and Task 09B palette, feedback and command-state WebKit suites remain applicable, along with the PDF navigation/layout and EPUB unit regressions. Pixel assertions in the pristine lifecycle fixture wait for completed asynchronous publication; the assertions are unchanged.

Run the WebKit suites with process-local `GDK_SCALE=1 GDK_DPI_SCALE=1` on a scaled desktop. Native performance checks are separate from these deterministic regression suites and must record the actual window/canvas dimensions and recoloring path.

## R01 native reproduction

On Arch/niri, WebKitGTK 2.52.6 and the actual Tauri Wayland WebView, a generated three-page 612×792 pt PDF reproduced the failure with a 1000×800 CSS-pixel window and DPR 2. Gruvbox Dark's retained advanced flags selected pixel mode; stock SVG Gruvbox and Dark worked at the same high zoom.

With fit-width basis, factor 1.78 had only a 3502×4532 main canvas. Factor 1.785 produced a 1753×2269 restricted main canvas plus a 3261×2526 detail canvas. These are observed transition bounds, not a universal zoom threshold; the configured 33,554,432-pixel cap was unchanged.

Before correction, high-zoom main background pixels were `[40,40,40]`, while the visible detail pixels and native screenshot were `[255,255,255]`. Hiding only the detail canvas changed the screenshot to `[40,40,40]`; restoring it brought back white. The real detail completion event had `source === pageView.detailView`, `cssTransform: false`, and `isDetailView: true`; Clio previously processed only `pageView.canvas`.

After correction, both native WebGL and forced cooperative CPU output retained full-resolution detail and the selected background. A 3259×2523 WebGL detail rendered `[40,40,40]`; CPU main/detail rendered `[48,48,48]` for a temporary `#303030` background and `[40,40,40]` after returning to Gruvbox. Panning replaced the detail canvas while preserving an embedded image's `[245,210,80]` pixels. Native `+` crossed the threshold from factor 1.75 to 1.8375 correctly; native page navigation, resizing, single/spread/continuous layouts, rapid appearance changes, Ctrl+W close/reopen and PDF→EPUB→PDF replacement also retained correct output.

## S4E context loss and resource ownership

Real WebKitGTK 2.54.2 `WEBGL_lose_context` events exposed two GPU publication defects:

- While lost, WebGL calls did not throw. `render()` returned true and the surface accepted stale `[40,40,40]` background pixels instead of the requested `[16,41,63]`; no CPU operation started.
- After restoration, the old program/VAO/texture handles were invalid. Three draw calls returned through the success path but produced black `[0,0,0]` instead of `[40,40,40]`.

The renderer now checks `isContextLost()` before GPU work and immediately before publication. A lost context takes the existing pristine-source cooperative CPU path. One pair of canvas-owned listeners permits restoration, invalidates lost handles, and rebuilds the existing shader program, VAO/buffer and texture. Initialization publishes handles only as a complete set and releases partial allocations; failed initialization leaves CPU fallback available. No recoloring math, document lifecycle, PDF.js cache policy or renderer API changes.

The singleton intentionally retains one offscreen canvas/context, program, VAO-owned vertex buffer and texture for reuse across documents. Its listeners share that lifetime, not a page/component lifetime. Uploaded texture pixels do not retain the source DOM canvas. Context loss retires the context-bound storage; restoration creates a new set. PDF.js still owns main/detail output canvases and tasks; the surface owns only independent pristine copies, recolor requests/controllers and its observer/listener/timer/frame lifecycle. Geometry cancellation prevents new work/publication but does not interrupt an already pending PDF.js `getPage()`; its eventual page is cleaned up.

The detail runtime now runs development StrictMode and production builds in independent GPU/CPU processes. Actual loss produces correct main/detail and compositor `[16,41,63]` output through CPU; actual restoration produces `[40,40,40]` through GPU again, with three draws and no additional fallback. The test observer does not prevent the loss event's default; restoration depends on the production listener. Coverage also checks text/search-highlight range geometry after canvas replacement, rapid high-zoom navigation while CPU work is held, real cache eviction, ten alternating document reopen/close cycles, and balanced surface listeners/observers after replay/unmount. No diagnostic hooks ship in the application.

Bounded observations on Xwayland `:1`, DPR 2.5, the existing 1,500,000-pixel test cap and twelve generated pages:

| Settled boundary | Main pristine entries | Detail entries | Pristine pixels | Requests / CPU buffers |
| --- | ---: | ---: | ---: | ---: |
| Initial pixel mode | 2 | 0 | 1,170,450 | 0 / 0 |
| After twelve-page navigation | 10 | 1 | 4,975,331 | 0 / 0 |
| Close, then five and ten reopen/close cycles | 0 | 0 | 0 | 0 / 0 |

Both forced-CPU runs peaked at one active operation and one `ImageData`; all 92 operations settled, including six discarded operations. Retired sources had zero backing dimensions, and obsolete held targets received no late publication. Development replay left one live surface, five surface listeners and one connected highlight observer; final unmount removed every surface listener and observer and drained requests/timers.

The runner samples `/proc/<pid>/status` RSS and `smaps_rollup` PSS for itself and its WebKit network/web-process descendants only at drained, equivalent workload boundaries, without forced GC:

| Process-tree PSS (KiB) | Close | After five cycles | After ten cycles |
| --- | ---: | ---: | ---: |
| Production GPU | 348,669 | 365,193 | 363,177 |
| Production CPU | 378,081 | 378,357 | 381,443 |
| Development GPU | 407,824 | 421,296 | 436,056 |
| Development CPU | 386,481 | 379,293 | 382,399 |

These process/allocator observations are not a browser-heap or device-memory measurement and do not establish a leak: Clio's measured owned maps, backing stores and pending work were empty at every close. Test probes deliberately retain retired owners for inspection.

Original focused baseline: 989 passed. Before-change failure logs and corrected runtime measurements are retained at `/tmp/clio-s4e-before-focused.log`, `/tmp/clio-s4e-context-before.log`, `/tmp/clio-s4e-restoration-before.log`, `/tmp/clio-s4e-context-after.log` and `/tmp/clio-s4e-resource-range.log`. This establishes recoverable context-loss failures, not the cause of the historical application freeze or recovery from every hardware/driver failure.

Fresh debug/no-bundle Tauri candidate SHA-256: `fe49391f1bbb840bdaa543abb0d230288681410c239a3056861c2f365b53e713`. An isolated scale-1 Sway/pixman/Xwayland `:2` session exercised trusted XTEST theme changes, advanced recoloring, zoom, page/spread/single navigation, selection/copy (`Status P`), close/reopen, PDF→EPUB→PDF and PDF A→B→A. Settled reopening/replacement screenshots require the expected finished text layer plus actual foreground/background pixels, not just the footer or loading background. The actual position JSON retained page 2 offset 0; SQLite retained enabled Gruvbox, hue/image preservation and `#282828` / `#EBDBB2`.

Native controller failures are retained separately: palette choices remain open until Escape; reflow retires AT-SPI objects; spread changes can select the pair's first page; the EPUB footer is painted but not exposed as text; and the covered host footer is not the front EPUB window's footer. Correcting these probes did not change application behavior. Forced context loss/restoration is verified in the disposable real WebKit runtime, not in the Tauri candidate. Native Wayland, physical-human input and other drivers/platforms remain unverified.

Complete gates: 1,277 Bun tests passed across 27 files, zero failures/skips, including both manifest-verified real books, S4C modifiers, EPUB mode-round-trip coverage and the unchanged preference/reflow assertion; TypeScript, frontend build, all 24 Rust tests and whitespace checks passed. The intermittent EPUB reflow failure did not reproduce in this run. Evidence, including original failures, full logs, native screenshots, state and archived disposable controllers: `/home/tod/.cache/clio-s4e-dTgMSg/`. No commit was created.
