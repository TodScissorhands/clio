# PDF pristine canvas lifecycle

`PdfViewerSurface` owns off-DOM pristine copies of rendered PDF page canvases. PDF.js owns the page views, render tasks and output canvases; Clio must not zero those output canvases or clear PDF.js caches to release its own copies.

## Document boundary

Pristine resources belong to the committed `PDFDocumentProxy` identity, not a path or page number. A layout effect records that identity. Its cleanup first invalidates the identity, then resets every Clio-owned pristine canvas to zero width and height and clears the map. Cleanup is idempotent and also runs on unmount. Same-document rerenders retain valid pristine copies; a failed replacement leaves the active document unchanged and therefore retains its resources.

The existing passive effect still calls `PDFViewer.setDocument()`. Keep document invalidation/release separate from that call: PDF.js creates page views asynchronously. Geometry effects wait for the current document's first page view, and the existing `pagesinit` handler applies the latest requested layout when initialization completes.

## Render-event ownership

A `pagerendered` event can copy/recolor a canvas only while the viewer is undisposed, its document matches the committed document, and its source is the current page view or that view's current detail view. Old events cannot use a reused page number to overwrite new pristine data. Asynchronous viewer initialization reads the latest committed identity, including null after close.

This does not change open-document pristine caching/pruning, PDF.js page-view cache policies, recoloring math, renderer configuration, reader generation protection, or native I/O. Shader singleton resources and CPU fallback scheduling are outside this correction.

## Verification

`bun test tests/pdf-pristine-lifecycle-runtime.test.ts` runs the real component and PDF.js in WebKitGTK using generated documents. It covers close/reopen, zeroed backing dimensions, same-document rerenders, long-to-short and failed replacement, current/stale page and detail events, repeated cycles, unmount, pending initialization, actual pixel/SVG transitions, navigation, zoom, spread and continuous layout. Observation and initialization gating are injected only into the test bundle; production has no diagnostic API or overlay.

The native H02B1 acceptance run reproduced baseline retention and verified an empty pristine map immediately after close and after 15 seconds without forced GC, followed by successful rendering/recoloring and replacement. Process PSS is supplementary: allocator, graphics and garbage-collection behavior may leave it elevated after the strongly reachable pristine resources are released.

The shared offscreen WebKit runner assumes a compatible GTK/CSS viewport scale. On a scale-2 desktop, run the suite with process-local `GDK_SCALE=1 GDK_DPI_SCALE=1`; this does not change desktop settings. Native lifecycle acceptance is separate and records its actual device-pixel ratio and canvas dimensions.
