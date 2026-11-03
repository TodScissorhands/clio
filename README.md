# Clio

Clio is a keyboard-first PDF reader built with Tauri, React, and PDF.js.

## Reading

- Open a PDF: `Ctrl+O` or `o`.
- Search: `Ctrl+F` or `/`; matching text is highlighted on the PDF text layer. `Enter` and `Shift+Enter` move between individual matches and wrap at either end. `Esc` closes search. Image-only pages without extractable text are not searchable.
- Navigate: `PageDown` / `PageUp`, `→` / `←`, or `j` / `k`. `Home` and `End` go to the first and last page. `g` opens page jump.
- Zoom: `Shift++` and `-` change manual zoom in 5% relative steps. `=` fits width, `f` fits a page, and `Shift+f` fits a spread.
- `:` opens the command palette. Choose `single_page_view` or `two_page_spread` to switch layouts. Spreads keep the cover alone and fall back to single pages in narrow windows.
- `i` or `toggle_night_mode` switches the application to dark mode and inverts displayed PDF pixels together. It never changes the PDF file.
- Clio saves a debounced page and within-page reading offset for each canonical file path in app data. The PDF stays at its original location; moving or renaming a file gives it a new reading-position identity.

## PDF loading lifecycle

Initial PDF opens are deferred by one microtask so effect replay, unmount, or source replacement can cancel them before PDF.js transfers the source buffer to its worker. React StrictMode and PDF.js workers remain enabled; active loading tasks retain the existing generation checks and teardown.

Run `bun test tests/pdf-open-lifecycle.test.ts` to verify replay and cancellation with real transferable PDF buffers.

## EPUB reading positions

Native EPUBs save a debounced EPUB CFI in the same app-data `reading-positions.json` file used for PDFs, keyed by canonical file path. Different paths have independent positions; moving or renaming a file gives it a new identity.

Reopening restores the saved passage in paged mode. Paged/continuous switches and resizing retain the CFI anchor, although reflow can place it within a page or spread rather than at the top. Missing, malformed, or unresolvable saved CFIs fall back to normal document opening.

Position updates are debounced by 700 ms. Closing a document or replacing it flushes the latest stable location without waiting for that delay. Browser-selected files have no canonical path and do not persist positions, matching the PDF browser behavior. Abrupt application termination can lose updates that have not finished saving.


## Search performance

Search caches normalized text and source-offset mappings per PDF page for the lifetime of the in-memory document. First search still extracts every page; later queries reuse that index. To benchmark a generated 400-page PDF or an existing PDF, run `bun scripts/benchmark-pdf-search.ts [path/to/file.pdf]`.

## Dependency patch

Bun applies `patches/epubjs@0.3.93.patch` through `patchedDependencies` in `package.json`. Keep the Stage orientation-listener cleanup correction in both the source and compiled library files when refreshing the patch.

Run `bun test tests/epub-stage-lifecycle.test.ts` to verify that destroyed stages stop receiving orientation events without affecting live stages or unrelated listeners.
