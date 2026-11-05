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
- Current page-view, target canvas and pristine-map identities.
- The page's finished rendering state and source/target dimensions.
- The settings object, abort signal and latest per-page request identity.

A new main-page bitmap invalidates pending work before refreshing its pristine copy. CSS-only and detail-view events reuse the existing pristine main bitmap rather than copying an already recolored output back into it. Existing page/detail event ownership guards remain in place.

## Cached pages and cancellation

Each surface has one active operation and a replaceable map of pending page requests, not a promise per queued page. Stale requests are removed at pruning and refresh boundaries. The current page takes priority; newly available current-page content can preempt background CPU work. Remaining connected pages are prioritized by distance from the current page, before detached cached pages. Cached-page operations are separated by a platform timer task rather than drained in a synchronous loop.

Outdated pending canvases are temporarily hidden without changing layout. Only a completed current result restores their visibility. Supersession transfers visibility ownership; an older completion cannot reveal or delete a newer request. This also prevents navigation into cached, outdated pixels while a settings update is pending.

Settings changes, document cleanup, geometry changes, page rerendering/eviction and unmount invalidate work. Document cleanup cancels before the existing H02B1 helper zeroes Clio-owned pristine canvases and clears the map. It never zeroes live PDF.js output canvases or changes PDF.js cache policy. Failed replacement leaves the committed document and its pristine resources valid.

Completed-render metadata is a weak map keyed by PDF.js output canvases, but its values reference pristine sources. Document cleanup drops the entire metadata map as well: a PDF.js target retained elsewhere must not keep a previous document's pristine source reachable through Clio's completion bookkeeping. Same-document settings/geometry updates retain usable metadata.

`onPageRendered` remains a geometry/restoration signal; it is not a CPU-pixel-completion promise. Text-layer completion already uses that callback independently. Navigation and restoration must not wait for recoloring to finish.

## Regression coverage

- `tests/pdf-recolor-cooperative.test.ts`: exact RGBA equivalence against the accepted synchronous traversal, all setting flags and presets/custom colors, requested rectangle counts, overlapping/nonmatching/full/partial coverage, alpha, dimensions, mid-list suspension, cancellation and transactional/error boundaries.
- `tests/pdf-cooperative-rendering-runtime.test.ts`: real component/PDF.js/WebKit lifecycle, supersession, disable, close/replacement, invalid replacement in the actual App, zoom/viewport resize, navigation, cached pages, unmount/reopen and pristine zeroing. CPU forcing, observation and deterministic task-yield gating exist only in the test bundle.
- Existing pristine-lifecycle and Task 09B palette, feedback and command-state WebKit suites remain applicable, along with the PDF navigation/layout and EPUB unit regressions. Pixel assertions in the pristine lifecycle fixture wait for completed asynchronous publication; the assertions are unchanged.

Run the WebKit suites with process-local `GDK_SCALE=1 GDK_DPI_SCALE=1` on a scaled desktop. Native performance checks are separate from these deterministic regression suites and must record the actual window/canvas dimensions and recoloring path.
