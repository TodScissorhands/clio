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

## Search performance

Search caches normalized text and source-offset mappings per PDF page for the lifetime of the in-memory document. First search still extracts every page; later queries reuse that index. To benchmark a generated 400-page PDF or an existing PDF, run `bun scripts/benchmark-pdf-search.ts [path/to/file.pdf]`.
