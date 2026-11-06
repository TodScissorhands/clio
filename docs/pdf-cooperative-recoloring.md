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
