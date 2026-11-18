# Clio

Clio is a keyboard-first PDF and EPUB reader built with Tauri, React, PDF.js and Foliate.

## Reading

- Open a document: `Ctrl/Cmd+O`; close: `Ctrl/Cmd+W`. EPUB also retains `o` to open.
- Search: `Ctrl+F` or `/`; matching text is highlighted on the PDF text layer. `Enter` and `Shift+Enter` move between individual matches and wrap at either end. `Esc` closes search. Image-only pages without extractable text are not searchable.
- PDF page navigation: `Ctrl+PageDown` / `Ctrl+PageUp` and `J` / `K` explicitly move to the next/previous logical page group, regardless of zoom. Groups are single pages or spreads, including the narrow-window single-page fallback, and clamp at document boundaries.
- `PageDown` / `PageUp` retain viewport paging followed by page navigation at a boundary. Arrows and `h/j/k/l` retain their context-sensitive movement. `Home` / `End` and `Ctrl+Home` / `Ctrl+End` use the existing beginning/end commands. `g` opens page jump. `Shift+PageUp` / `Shift+PageDown` keep their ordinary page-key behavior, not ten-page jumps.
- PDF zoom: bare `+` / `-` or `Ctrl++` / `Ctrl+-` change manual zoom in 5% multiplicative steps, preserving the fit basis, limits, and viewport-center anchor. `Ctrl+=` is also zoom-in, including `Ctrl+Shift+=` when Shift produces `+`; `Ctrl+NumpadAdd` / `Ctrl+NumpadSubtract` are supported. Bare `=` fits width, `w` fits a page, and `F` fits a spread. Reader shortcuts do not take over typing or overlays.
- `:` opens the command palette. Choose “Single page view” or “Two page spread” to switch layouts. Spreads pair pages 1–2, 3–4, and so on, and fall back to single pages in narrow windows.
- `i` switches application chrome between Light and Dark; document themes control page appearance independently.
- Clio saves a debounced page and within-page reading offset for each canonical file path in app data. The PDF stays at its original location; moving or renaming a file gives it a new reading-position identity.

## Command palette

The PDF/EPUB palette keeps focus in its filter. Arrow keys select an option and reveal it inside the list; `Enter` executes it. Pointer movement selects a row and clicking executes that row. `Tab` and `Shift+Tab` stay in the palette; `Esc` closes it and returns focus to the reader. The list reserves logical end spacing for overlay scrollbars so shortcut hints stay readable in left-to-right and right-to-left layouts.

The trailing **Commands :** status-bar button opens the same palette in either reader, including the closed reader. It is hidden while another overlay/input is active. This is an explicit command entry point, not automatic recovery of sandboxed EPUB keyboard input.

Command searches accept readable phrases such as `zoom in` and `fit to page width`, original identifiers such as `zoom_in`, and shortcut text. Chapter searches use titles and destination paths, not the shared `select_chapter` action ID. Unmatched chapter queries show “No matching chapters.”

State-bearing commands show a checkmark and a short setting description, separate from the highlighted command selected by the keyboard. Descriptions are exposed to assistive technology and do not participate in filtering. Ordinary actions and chapter destinations have no setting marker.

PDF descriptions reflect the effective view, fit versus custom zoom, application appearance and recoloring preferences. A narrow-window spread fallback identifies the displayed single page and the still-requested spread separately. Disabled recoloring distinguishes saved options from applied effects; custom colors never mark a stock preset current. EPUB describes layout and applied versus requested reading preferences.

`bun test` includes a real WebKitGTK palette integration test at three viewport sizes and both appearances, including shortcut hit-testing in LTR/RTL at 100% and 150% zoom. It uses an offscreen GTK view and the installed Python GObject/WebKitGTK 4.1 bindings on Linux with an X display; environments without that tooling report this test as skipped. Native Tauri verification remains separate from this shared-runtime regression test.

## Reader feedback

Errors use opaque theme surfaces in both appearances; application-level errors remain dismissible. Presentation changes leave document-replacement and error-recovery logic unchanged.

The PDF status bar stays 24px high. While a search, page-jump or recolor input is active at widths up to 600 CSS pixels, the optional recolor preset is omitted to prioritize page information, the input and its feedback. Other secondary status text can truncate rather than wrap.

Page jump accepts whole page numbers within the document's inclusive range. Rejected input stays editable and focused with an accessible range explanation; editing or closing the overlay clears stale validation feedback. A valid entry navigates to that exact page.

`bun test` also exercises the real App, PDF.js and Foliate in WebKitGTK using disposable generated documents. This feedback integration test uses the same optional native tooling as the palette test and delays the real PDF worker response to inspect loading layout. Visible focus paint is checked separately in native Tauri, since the offscreen runner has no active native window.

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

## Document appearance

Both formats offer **Document theme…**: Original, Light, Dark, Sepia, Zathura Dark, Gruvbox Dark, Solarized Dark and Rose Pine Dawn. Each format saves its own choice. Empty-query palettes show the chooser rather than every theme; root searches still find theme names and advanced controls.

For PDF, **Original** disables recoloring without discarding the saved theme, custom colors or advanced flags. `r` restores/toggles those saved colors. The palette distinguishes effective Original from the saved/off appearance. Legacy settings whose preset identity was already replaced by `original` retain their exact colors and flags and are truthfully shown as Custom when enabled; Clio does not guess the lost identity.

**Advanced PDF appearance…** retains hue preservation, image preservation, lightness adjustment, hexadecimal background/foreground colors and the saved-color toggle. Existing PDF settings, custom colors and recoloring algorithms remain supported; the persistent `sepia-warm` ID maps to the shared Sepia label without migration.

## EPUB reading preferences

Open `:` → **Reading preferences…** for Publisher/Serif/Sans, text size (80–200%), line spacing, logical Start/Justify alignment, outer margins and reading-column width. Publisher is the default for every typography/layout field. **Reset typography and layout to Publisher** leaves the independent **Document theme…** choice intact. Root command searches also find individual choices; a chooser stays focused after selection.

Preferences are global to EPUBs, stored in `clio:epub-reading-preferences`, separately from canonical-path CFIs and PDF settings. Foliate applies geometry to its attached session-owned renderer. Typography changes retain the first-visible reading anchor across successive choices until navigation replaces it. Unavailable preference storage does not prevent reading. Fixed/mixed-fixed publications retain Publisher presentation; vertical writing retains Publisher typography/geometry. Saved choices remain available for other books.

Text-size percentages use each section's original body size. An explicit size sets ordinary paragraphs to that reading size, including pixel/em/rem declarations; Publisher restores their original differences. Foliate owns layout and styles; Clio keeps one bounded prose stylesheet and restores the body font properties it owns. Code, tables, media, declared verse and manual-break/preserved-whitespace blocks are excluded from the paragraph rule. The real WebKit preference regression exercises reflow, repeated choices and exact Publisher reset. Arbitrary publisher CSS is not universally normalized.

EPUB Original removes reader color overrides; transparent Original pages use a white backdrop independent of application chrome. Themes do not invert images or enable publication scripts. See [the interface specification](docs/DESIGN.md) for appearance semantics.

## EPUB wheel input

Continuous mode retains native scrolling. A paged wheel prototype was rejected: WebKitGTK retargeted events lose pressed-button state, and synchronous embedded CSS state can lag queued input. The candidate could turn a page during a primary-button hold before text selection existed. No paged wheel policy, Ctrl+Wheel font gesture, focus workaround or sandbox change ships. See [native wheel evidence and limitations](docs/epub-wheel-input.md).

## EPUB reading positions

Native EPUBs save an EPUB CFI in the same app-data `reading-positions.json` file used for PDFs, keyed by canonical file path. Different paths have independent positions; moving or renaming a file gives it a new identity.

New positions carry `cfiModel: "foliate-html-v1"`. Untagged legacy epub.js CFIs restore only when the publication's original and rendered body structures are compatible. Unresolved, malformed and unknown-model records remain intact through opening, reflow and closing; a valid explicit navigation may establish a new tagged position for that same canonical path. No speculative CFI conversion is performed.

Reopening restores the saved passage in paged mode. Typography/layout changes preserve the first-visible reading location rather than merely replaying a prior requested navigation target. Genuine navigation updates are serialized by the reader's save queue; restoration and reflow notifications alone do not migrate or overwrite records. Browser-selected files have no canonical path and do not persist positions. Abrupt application termination can lose unfinished writes.

## EPUB iframe keyboard lifecycle

Embedded keyboard registrations belong to the current Foliate reader's live publication Documents, including retained neighboring sections. Foliate load/relocate notifications register current Documents and retire detached or same-frame-replaced Documents. Close, replacement and effect cleanup remove each registration; effect replay seeds still-live content without duplicate handlers.

The shared command router remains the sole keyboard/repeat owner. Publication scripts are removed and blocked by CSP; publication frames remain separate from the privileged shell's native capability set. The legacy epub.js keyboard/link limitations are documented in the [historical investigation](docs/epub-keyboard-focus.md); they are not current Foliate implementation instructions.

Scoped native Foliate acceptance passed XTEST-driven content-focused shortcuts, pointer and keyboard internal links, copying, editable/search input, focus recovery and one-action navigation after reopening on WebKitGTK 2.54.2. Physical human keyboard/pointer, IME and native Wayland acceptance remain unverified; automated input is not physical-input evidence.

Run `bun test tests/epub-keyboard-lifecycle-runtime.test.ts` for the Foliate/WebKit production registration regression, including replacement, reflow and repeated reopen cleanup. These runtime checks require Linux Python GObject/WebKitGTK 4.1 bindings and an X display. CFI compatibility/preservation has a focused mode: `CLIO_FOLIATE_REAL_BOOKS=/path/to/books bun test tests/foliate-runtime.test.ts -t 'Foliate positions'`, using the existing Gutenberg 11 and 1342 EPUB fixtures.

## Native filesystem execution

The PDF/EPUB path, byte-read and reading-position commands are asynchronous Tauri handlers. Canonicalization, synchronous filesystem calls, JSON processing and position-lock acquisition run through `tauri::async_runtime::spawn_blocking`, not on the native application thread or async executor. Document bytes still use raw IPC responses; command names and payloads are unchanged.

Position workers own a clone of one managed `Arc<Mutex<()>>`. The lock covers each complete store read or read/modify/temporary-write/rename transaction; no mutex guard crosses an await. The existing `reading-positions.json` format, canonical-path keys, unknown-record preservation and malformed-CFI handling are unchanged. Filesystem/validation errors retain their string errors; worker join failures reject with `Native I/O worker failed: …`.

Await a save before a dependent load or save when ordering matters. Overlapping workers serialize in mutex-acquisition order, not invocation order; the last serialized write for a path wins. EPUB save queues and live-session authorization prevent retired sessions from writing another reader's position. The mutex is process-local, not a cross-process file lock.

`cargo test --manifest-path src-tauri/Cargo.toml` covers path validation, raw bytes, compatible mixed records, overlapping real filesystem transactions, document replacement and worker errors. Native H01 verification additionally exercised the GTK picker, both reader lifecycles, position restoration, invalid replacement recovery and palette/feedback. A bounded delayed-read comparison confirmed native resize/input and independent IPC can proceed while a filesystem worker waits.

This removes one native-thread blocking source, not PDF.js/Foliate or JavaScript rendering stalls. The historical intermittent freeze has not been reproduced or established as fixed. Existing PDF saves remain debounced by 700 ms; closing before a pending save finishes can lose that unsaved position.


## Search performance

Search caches normalized text and source-offset mappings per PDF page for the lifetime of the in-memory document. First search still extracts every page; later queries reuse that index. To benchmark a generated 400-page PDF or an existing PDF, run `bun scripts/benchmark-pdf-search.ts [path/to/file.pdf]`.

PDF matches use a high-contrast black/white boundary chosen from the effective document background. The active match has a thicker solid outline; other matches use a thinner dashed outline, with restrained translucent fills. This does not change search geometry, navigation or recoloring pixels. Stock/uniform backgrounds are checked; scanned/image-heavy pages and arbitrary custom palettes remain content-dependent.

## Foliate dependency

Foliate is pinned to `readest/foliate-js` revision `22a49acaa120877ede21f713679ab8ba4d1ef663`. Bun applies `patches/foliate-js-clio.patch` through `patchedDependencies`; a frozen isolated install must reproduce the accepted source without manual `node_modules` edits. The patch covers EPUB-only dispatch, resize teardown, first-visible reflow/continuous locations, navigation completion, malformed navigation URI recovery and retired archive-resource ownership. Attribution and bundled ZIP/polyfill licenses are in `public/licenses/foliate-js.txt`. The current integration contract and consolidated evidence are in [Foliate integration acceptance](docs/foliate-integration-acceptance.md).

`epubjs@0.3.93` is retained only as an unpatched development dependency to generate genuine historical CFI records in compatibility regressions. No Clio application source or production bundle uses the old engine. Its superseded Clio adapter and patch are removed.

## Verification

Use `bun install --frozen-lockfile` to install the committed frontend dependency versions. The full verification gates are `bunx tsc --noEmit`, `bun run build`, `bun test`, and `cargo test --manifest-path src-tauri/Cargo.toml`.

The complete Bun suite requires real WebKitGTK 4.1, Python GObject bindings and an X11 display. Some runtime runners skip when prerequisites are unavailable; Foliate acceptance runners fail instead. On a configured Linux desktop, run `bash scripts/test-webkit-required.sh` to require that environment and execute the complete Bun suite. For headless Linux use `xvfb-run -a bash scripts/test-webkit-required.sh`. A missing native prerequisite is an error, not a passing-but-skipped run.

Historical CFI compatibility also requires `CLIO_FOLIATE_REAL_BOOKS` containing `gutenberg-11.epub` and `gutenberg-1342.epub`. CI provisions checksum-pinned historical releases into runner-temporary storage; no publication archives enter the application bundle. See [fixture provenance and rights](tests/fixtures/foliate-real-books.md), including the Pride edition's noncommercial cover restriction. To use the same corpus locally:

```sh
export CLIO_FOLIATE_REAL_BOOKS="$(mktemp -d)"
bash scripts/provision-foliate-real-books.sh "$CLIO_FOLIATE_REAL_BOOKS"
xvfb-run -a bash scripts/test-webkit-required.sh
```

Native geometry checks follow renderer semantics: PDF resize coverage crosses the active fit constraint; EPUB typography coverage preserves the pre-reflow visible-start CFI, not every passage on the old page. EPUB checks await visible text fragments and tolerate temporarily absent views during reflow without extending deadlines.

GitHub Actions runs these checks on Ubuntu with WebKitGTK and Xvfb, plus locked Rust tests. This covers automated native WebKit integration; it does not replace physical input, Tauri window, or assistive-technology acceptance.
