# Clio

Clio is a keyboard-first PDF reader built with Tauri, React, and PDF.js.

## Reading

- Open a PDF: `Ctrl+O` or `o`.
- Search: `Ctrl+F` or `/`; matching text is highlighted on the PDF text layer. `Enter` and `Shift+Enter` move between individual matches and wrap at either end. `Esc` closes search. Image-only pages without extractable text are not searchable.
- PDF page navigation: `Ctrl+PageDown` / `Ctrl+PageUp` and `J` / `K` explicitly move to the next/previous logical page group, regardless of zoom. Groups are single pages or spreads, including the narrow-window single-page fallback, and clamp at document boundaries.
- `PageDown` / `PageUp` retain viewport paging followed by page navigation at a boundary. Arrows and `h/j/k/l` retain their context-sensitive movement. `Home` / `End` and `Ctrl+Home` / `Ctrl+End` use the existing beginning/end commands. `g` opens page jump. `Shift+PageUp` / `Shift+PageDown` keep their ordinary page-key behavior, not ten-page jumps.
- PDF zoom: bare `+` / `-` or `Ctrl++` / `Ctrl+-` change manual zoom in 5% multiplicative steps, preserving the fit basis, limits, and viewport-center anchor. `Ctrl+=` is also zoom-in, including `Ctrl+Shift+=` when Shift produces `+`; `Ctrl+NumpadAdd` / `Ctrl+NumpadSubtract` are supported. Bare `=` fits width, `w` fits a page, and `F` fits a spread. Reader shortcuts do not take over typing or overlays.
- `:` opens the command palette. Choose `single_page_view` or `two_page_spread` to switch layouts. Spreads pair pages 1–2, 3–4, and so on, and fall back to single pages in narrow windows.
- `i` or `toggle_night_mode` switches the application to dark mode and inverts displayed PDF pixels together. It never changes the PDF file.
- Clio saves a debounced page and within-page reading offset for each canonical file path in app data. The PDF stays at its original location; moving or renaming a file gives it a new reading-position identity.

## PDF wheel navigation

- Enlarged pages and spreads use native viewport scrolling on both axes. Paged mode contains only the active page group, so scrolling clamps there rather than advancing at its edges. Continuous mode keeps normal scrolling between pages.
- A fully fitted page or spread can turn with unmodified, predominantly vertical wheel input. Movement accumulates to 48 CSS pixels before a turn; line units use 16 CSS pixels and page units use the corresponding reading-viewport dimension. Fractional input does not turn per event, and horizontal-dominant input does not request a page turn.
- One wheel burst can turn at most one logical group, using the same groups as `J`/`K`. Another action is enabled after 250 ms without wheel input, measured from the last event rather than the last turn. Closely spaced mouse notches can therefore count as one burst, just like a sustained smooth-scroll sequence; this is an intentional safety tradeoff, not device detection.
- Ctrl+Wheel zoom is described below. Other modifier-wheel combinations, search/palette exclusions, keyboard controls, and EPUB navigation retain their existing behavior. Explicit `J`/`K` navigation remains available on enlarged PDFs.
- Task 08A's normal-wheel behavior passed all eight physical touchpad acceptance checks, including its 250 ms burst policy.

## PDF Ctrl+Wheel zoom

- Over the PDF reading viewport, `Ctrl+Wheel` up zooms in and down zooms out, in the existing 5% multiplicative steps with the existing fit basis and limits. Handled events do not perform ordinary wheel scrolling or turn pages, and remain consumed at zoom limits instead of falling through to WebKit page zoom. Other modifiers, interactive inputs, and active overlays retain precedence.
- Vertical movement accumulates to 48 CSS pixels per step: pixel units are unchanged, line units use 16 CSS pixels, and page units use the reading-viewport height. A reversal or 200 ms idle gap clears partial accumulation. Each event contributes at most one step, with surplus discarded; each animation frame applies at most one step without queuing a backlog. Continued movement can zoom on subsequent frames; this does not use the 250 ms page-turn latch or identify an input device.
- Wheel zoom anchors the position on the PDF page under the pointer, in single-page, spread, and continuous layouts. Page margins/gaps fall back to the current page-group anchor. Native scroll bounds can limit exact anchoring near document edges or when a page fits. Keyboard zoom keeps its viewport-center anchor.
- Task 08C passed all eight physical Ctrl+touchpad acceptance checks. Synthetic native input separately verifies event handling and geometry; physical acceptance covers the tested gestures, not a claim of universal device compatibility. Pinch-specific integration is not implemented.

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
