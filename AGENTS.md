# Clio engineering rules

Clio is a document-first Tauri reader with separate PDF.js and epub.js engines. Interface rules live in [docs/DESIGN.md](docs/DESIGN.md); do not duplicate them here. Delivery priorities and quality gates are tracked in [docs/ROADMAP.md](docs/ROADMAP.md).

## Ownership and security

- `App.tsx` owns document acquisition generations and committed identity. Invalid replacement retains the current document. Prepared PDF ownership transfers exactly once; stale candidates are retired.
- Each reader owns its renderer lifecycle. Preserve PDF task/pristine-canvas cleanup and cooperative recoloring. EPUB uses one Book-scoped rendition and live-Document registrar, including same-frame replacement and effect replay.
- `reader/interactions.ts` is the single keyboard-command router and repeat owner. Preserve Task 08 PDF navigation, zoom, spread and wheel semantics.
- Canonical-path CFI persistence stores position only. Reader preferences must not create a second position store or remount documents.
- EPUB publications are untrusted. Keep `allowScriptedContent: false`, the existing sandbox and Tauri permission boundaries. Never inject publication scripts, add unrestricted messaging or hide input defects with focus theft.
- Content-focused EPUB keyboard delivery and internal hyperlinks have documented WebKitGTK limitations; do not claim them fixed without native evidence.

## Implementation and verification

Prefer small feature-owned modules, existing lifecycle boundaries and supported renderer APIs. Do not introduce a CSS normalization engine, new dependencies or wholesale refactoring without a demonstrated requirement.

Validate persisted data as unknown, retain backward compatibility and handle unavailable storage. Distinguish requested, applied and effective settings. Cancel deferred work on close/replacement; stale callbacks cannot affect another document.

Test consumer-visible behavior and boundary transitions. Run focused tests, actual WebKitGTK/Tauri smoke scenarios, and these complete gates:

```
GDK_SCALE=1 GDK_DPI_SCALE=1 bun test
bunx tsc --noEmit
bun run build
cargo test --manifest-path src-tauri/Cargo.toml
git diff --check
```

Native suites must run, not silently skip. Synthetic callbacks and screenshots alone do not establish native input delivery. Report physical-input/accessibility limits honestly.

## Preservation

Never modify, delete, stage or commit user-owned `report.txt`. Preserve unrelated work. Stage explicit owned files only; review staged changes and run `git diff --cached --check`. Do not reset/rebase or push without explicit authorization. Stop only task-owned processes and remove temporary instrumentation.
