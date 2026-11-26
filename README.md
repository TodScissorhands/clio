# Clio

Clio is a keyboard-first desktop reader for PDF and EPUB, built with Tauri, React, PDF.js and Foliate.

Clio is under active development. PDF and EPUB reading, search, themes, EPUB reading preferences, reading-position persistence and EPUB bookmarks are implemented. Native input and accessibility acceptance are still in progress. See the [roadmap](docs/ROADMAP.md) for planned work and current priorities.

## Features

- PDF rendering with PDF.js and EPUB rendering with Foliate.
- Search across PDF text and EPUB publications. Image-only PDF pages without extractable text are not searchable.
- The floating **Clio Index** opens with `:` or the reader's Commands control. It has a compact contextual command list, command-line aliases, catalog filtering and focused choosers. Drag its header to reposition it; it returns to top-center when reopened.
- PDF page layout, fit and appearance controls; EPUB paged/continuous layout, document themes and typography preferences.
- Per-document reading positions, and EPUB bookmarks saved independently per canonical document path.
- Native EPUB documents run in a separate session-restricted WebView. Publication scripting is disabled and native operations are authorized to the live reader session.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl/Cmd+O` | Open a document (`o` also opens in EPUB) |
| `Ctrl/Cmd+W` | Close the current document |
| `Ctrl/Cmd+F` or `/` | Search the document |
| `:` | Open the Clio Index |
| `m` | Add a bookmark while reading EPUB |
| `n` / `Shift+N` | Next/previous search match in PDF; next/previous chapter in EPUB |
| `Ctrl+PageDown` / `Ctrl+PageUp` | Next/previous PDF page group |
| `j` / `k` | Move or scroll in the reader; in the Index, move through commands |

See [reader controls](docs/reader-controls.md) for Index modes, focus transitions, all reader shortcuts, PDF wheel/zoom behavior and EPUB bookmark management. Shortcuts apply when the reader receives input and no editor owns it.

## Getting started

Install Bun (CI uses 1.3.14), a stable Rust toolchain with Cargo, and the system development libraries needed by Tauri 2. On Linux, native development and WebKitGTK checks require GTK, WebKitGTK 4.1, Python GObject/WebKitGTK introspection bindings, and a graphical display. This repository's native integration checks target Linux; cross-platform behavior is not yet qualified. Ubuntu 24.04 CI installs these build and test prerequisites:

```sh
sudo apt-get install libwebkit2gtk-4.1-dev libayatana-appindicator3-dev \
  libgtk-3-dev librsvg2-dev libssl-dev pkg-config patchelf \
  python3-gi python3-gi-cairo gir1.2-webkit2-4.1 xvfb xauth
```

```sh
git clone https://github.com/TodScissorhands/clio.git
cd clio
bun install --frozen-lockfile
```

Run the complete desktop application, including the native Tauri window and readers:

```sh
bun run tauri dev
```

Tauri starts Vite on port 1420 through its configured development hook; do not start a second Vite process first. Use `Ctrl+O` or the Commands control to open a local PDF or EPUB. `bun run dev` starts only the browser frontend, without native file/session commands or durable canonical-path positions.

## Architecture

Tauri owns native windows, file acquisition and restricted EPUB session capabilities. React coordinates reader state and command routing. PDF.js renders PDFs in the application shell; Foliate renders EPUB in a separate native window with a restricted WebView. The readers retain their own renderer lifecycles. Reading positions use canonical paths and tagged EPUB CFIs; bookmarks use a separate versioned store. Moving or renaming a document gives it a new persistence identity. EPUB publication documents are sanitized with a script-blocking CSP and sandboxed separately from the privileged shell; this is a publication boundary, not a claim of a global application CSP. Foliate is pinned and patched through Bun; epub.js is development-only for historical CFI compatibility tests.

## Known limitations

- Image-only PDF content has no searchable text; OCR is not implemented.
- EPUB content-focused keyboard delivery and publication hyperlink behavior have documented WebKitGTK limitations. Do not assume those interactions work across platforms; see the [EPUB input notes](docs/epub-keyboard-focus.md).
- Physical-keyboard, IME and screen-reader acceptance is not complete, and the project has not completed cross-platform release validation.
- Bookmarks support EPUB only. Persistent highlights and notes are not implemented.

## Development and verification

Useful checks:

```sh
bunx tsc --noEmit
bun run build
GDK_SCALE=1 GDK_DPI_SCALE=1 bun test
cargo test --manifest-path src-tauri/Cargo.toml
git diff --check
```

The full Bun suite includes native WebKitGTK integration and requires its Python bindings and an X11 display. To make missing native prerequisites fail instead of allowing runtime checks to skip, run `bash scripts/test-webkit-required.sh`; for a headless Linux session use `xvfb-run -a bash scripts/test-webkit-required.sh`. Some Foliate CFI compatibility tests additionally need historical EPUB fixtures; see [Foliate integration acceptance](docs/foliate-integration-acceptance.md).

## Documentation

- [Reader controls and Clio Index](docs/reader-controls.md)
- [Interface specification](docs/DESIGN.md)
- [Roadmap](docs/ROADMAP.md)
- [Reading-position and bookmark storage](docs/reading-position-storage.md)
- [Foliate integration acceptance and evidence](docs/foliate-integration-acceptance.md)
- [PDF lifecycle and implementation notes](docs/pdf-reading-position-lifecycle.md)
- [EPUB keyboard and focus limitations](docs/epub-keyboard-focus.md)
- [EPUB wheel-input limitations](docs/epub-wheel-input.md)

For required native checks and historical EPUB fixture provisioning, see [local verification prerequisites](docs/foliate-integration-acceptance.md#local-verification-prerequisites). Dependency attribution is retained in [Foliate notices](public/licenses/foliate-js.txt).
