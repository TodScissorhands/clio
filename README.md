# Clio

Clio is a keyboard-first PDF reader built with Tauri, React, and PDF.js.

## Reading

- Open a PDF: `Ctrl+O` or `o`.
- Search: `Ctrl+F` or `/`; matching text is highlighted on the PDF text layer. `Enter` and `Shift+Enter` move between individual matches and wrap at either end. `Esc` closes search. Image-only pages without extractable text are not searchable.
- PDF page navigation: `Ctrl+PageDown` / `Ctrl+PageUp` and `J` / `K` explicitly move to the next/previous logical page group, regardless of zoom. Groups are single pages or spreads, including the narrow-window single-page fallback, and clamp at document boundaries.
- `PageDown` / `PageUp` retain viewport paging followed by page navigation at a boundary. Arrows and `h/j/k/l` retain their context-sensitive movement. `Home` / `End` and `Ctrl+Home` / `Ctrl+End` use the existing beginning/end commands. `g` opens page jump. `Shift+PageUp` / `Shift+PageDown` keep their ordinary page-key behavior, not ten-page jumps.
- PDF zoom: bare `+` / `-` or `Ctrl++` / `Ctrl+-` change manual zoom in 5% multiplicative steps, preserving the fit basis, limits, and viewport-center anchor. `Ctrl+=` is also zoom-in, including `Ctrl+Shift+=` when Shift produces `+`; `Ctrl+NumpadAdd` / `Ctrl+NumpadSubtract` are supported. Bare `=` fits width, `w` fits a page, and `F` fits a spread. Reader shortcuts do not take over typing or overlays.
- `:` opens the command palette. Choose “Single page view” or “Two page spread” to switch layouts. Spreads pair pages 1–2, 3–4, and so on, and fall back to single pages in narrow windows.
- `i` or `toggle_night_mode` switches the application to dark mode and inverts displayed PDF pixels together. It never changes the PDF file.
- Clio saves a debounced page and within-page reading offset for each canonical file path in app data. The PDF stays at its original location; moving or renaming a file gives it a new reading-position identity.

## Command palette

The PDF/EPUB palette keeps focus in its filter. Arrow keys select an option and reveal it inside the list; `Enter` executes it. Pointer movement selects a row and clicking executes that row. `Tab` and `Shift+Tab` stay in the palette; `Esc` closes it and returns focus to the reader.

Command searches accept readable phrases such as `zoom in` and `fit to page width`, original identifiers such as `zoom_in`, and shortcut text. Chapter searches use titles and destination paths, not the shared `select_chapter` action ID. Unmatched chapter queries show “No matching chapters.”

State-bearing commands show a checkmark and a short setting description, separate from the highlighted command selected by the keyboard. Descriptions are exposed to assistive technology and do not participate in filtering. Ordinary actions and chapter destinations have no setting marker.

PDF descriptions reflect the effective view, fit versus custom zoom, night mode and recoloring preferences. A narrow-window spread fallback identifies the displayed single page and the still-requested spread separately. Disabled recoloring distinguishes saved options from applied effects; custom colors never mark a stock preset current. EPUB describes its paged or continuous layout. These indicators read existing state without changing execution or persistence.

`bun test` includes a real WebKitGTK palette integration test at three viewport sizes and both appearances. It uses an offscreen GTK view and the installed Python GObject/WebKitGTK 4.1 bindings on Linux with an X display; environments without that tooling report this test as skipped. Native Tauri verification remains separate from this shared-runtime regression test.

## Reader feedback

Errors use opaque theme surfaces in both appearances; application-level errors remain dismissible. Presentation changes leave document-replacement and error-recovery logic unchanged.

The PDF status bar stays 24px high. While a search, page-jump or recolor input is active at widths up to 600 CSS pixels, the optional recolor preset is omitted to prioritize page information, the input and its feedback. Other secondary status text can truncate rather than wrap.

Page jump accepts whole page numbers within the document's inclusive range. Rejected input stays editable and focused with an accessible range explanation; editing or closing the overlay clears stale validation feedback. A valid entry navigates to that exact page.

`bun test` also exercises the real App, PDF.js and epub.js in WebKitGTK using disposable generated documents. This feedback integration test uses the same optional native tooling as the palette test and delays the real PDF worker response to inspect loading layout. Visible focus paint is checked separately in native Tauri, since the offscreen runner has no active native window.

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

## EPUB iframe keyboard lifecycle

Embedded keyboard registrations belong to the current rendition's attached iframe Documents, including retained neighboring sections. Content hooks validate iframe and rendition ownership; a scoped child-list observer releases registrations at the removal microtask after trim, clear or reflow. Per-iframe load handlers also release a superseded Document and register its replacement only when the rendition owns it. No periodic polling or epub.js removal event is required.

Close, replacement and effect cleanup synchronously dispose these registrations. Effect replay seeds still-live content without duplicating listeners. This does not change shortcuts, repeat policy, navigation guards, CFI persistence, sandbox permissions or the known native iframe-focus delivery limitation.

Task 09C1 confirmed that WebKitGTK 2.52.6 suppresses embedded JavaScript event listeners under the existing script-disabled sandbox. A deferred host-focus workaround restores shortcuts but breaks copying after selection; it is not shipped. See [EPUB keyboard-focus investigation](docs/epub-keyboard-focus.md) for native evidence, acceptance failures and the bounded native-widget alternative. Content-focused keyboard reliability remains unresolved.

Run `bun test tests/epub-keyboard-lifecycle-runtime.test.ts` for the real patched-epub.js/WebKit lifecycle regression, including historical retention, view removal, reflow, late callbacks, replacement and repeated reopen cycles. As with the other WebKit integration suites, Linux Python GObject/WebKitGTK 4.1 bindings and an X display are required; unsupported environments skip it.

## Native filesystem execution

The PDF/EPUB path, byte-read and reading-position commands are asynchronous Tauri handlers. Canonicalization, synchronous filesystem calls, JSON processing and position-lock acquisition run through `tauri::async_runtime::spawn_blocking`, not on the native application thread or async executor. Document bytes still use raw IPC responses; command names and payloads are unchanged.

Position workers own a clone of one managed `Arc<Mutex<()>>`. The lock covers each complete store read or read/modify/temporary-write/rename transaction; no mutex guard crosses an await. The existing `reading-positions.json` format, canonical-path keys, unknown-record preservation and malformed-CFI handling are unchanged. Filesystem/validation errors retain their string errors; worker join failures reject with `Native I/O worker failed: …`.

Await a save before a dependent load or save when ordering matters. Overlapping workers serialize in mutex-acquisition order, not invocation order; the last serialized write for a path wins. Existing EPUB per-path save/load ordering remains in place. The mutex is process-local, not a cross-process file lock.

`cargo test --manifest-path src-tauri/Cargo.toml` covers path validation, raw bytes, compatible mixed records, overlapping real filesystem transactions, document replacement and worker errors. Native H01 verification additionally exercised the GTK picker, both reader lifecycles, position restoration, invalid replacement recovery and palette/feedback. A bounded delayed-read comparison confirmed native resize/input and independent IPC can proceed while a filesystem worker waits.

This removes one native-thread blocking source, not PDF.js/epub.js or JavaScript rendering stalls. The historical intermittent freeze has not been reproduced or established as fixed. Existing PDF saves remain debounced by 700 ms; closing before a pending save finishes can lose that unsaved position.


## Search performance

Search caches normalized text and source-offset mappings per PDF page for the lifetime of the in-memory document. First search still extracts every page; later queries reuse that index. To benchmark a generated 400-page PDF or an existing PDF, run `bun scripts/benchmark-pdf-search.ts [path/to/file.pdf]`.

## Dependency patch

Bun applies `patches/epubjs@0.3.93.patch` through `patchedDependencies` in `package.json`. Keep the Stage orientation-listener cleanup correction in both the source and compiled library files when refreshing the patch.

Run `bun test tests/epub-stage-lifecycle.test.ts` to verify that destroyed stages stop receiving orientation events without affecting live stages or unrelated listeners.
