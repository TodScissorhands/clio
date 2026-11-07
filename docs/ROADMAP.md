# Clio — roadmap and delivery pipeline

This is the single planning reference for Clio's next milestones. Keep it short and update decisions in place; use GitHub Issues/PRs for individual tasks and evidence. [AGENTS.md](../AGENTS.md) owns engineering/security invariants; [DESIGN.md](DESIGN.md) owns the interface specification.

## Product boundary

Clio is a local-first, document-first PDF/EPUB desktop reader. Prefer a small, responsive, keyboard-friendly reading surface and an on-demand command palette. Preserve existing PDF.js and epub.js work unless a demonstrated requirement justifies replacing a component. No cloud services, library database, elaborate chrome, or platform-specific assumptions for ordinary reading.

## Priority order

| Order | Milestone | Deliverable and acceptance |
| --- | --- | --- |
| 1 — P0 | **09C: essential EPUB interactions** | After clicking publication text: Clio shortcuts work; text selection and native copy remain intact; internal chapter/fragment hyperlinks navigate correctly; untrusted EPUB scripts/URLs cannot gain native privileges; closing/replacing the document retires all events. Check paged and continuous modes, editable targets, held keys, and navigation history. |
| 2 — decision closed | **09C: wheel** | Keep native scrolling in continuous EPUB. Do **not** build paged EPUB wheel-to-turn or Ctrl+Wheel font gestures. Explicit keyboard/palette page navigation remains. |
| 3 | **09D: interface design** | Prototype the lean command hierarchy, status feedback, focus/escape behavior, and PDF search visibility; approve one coherent design before implementing broader chrome. |
| 4 | **09E: interface implementation** | Implement approved palette refinements and a clearly visible active PDF search match with reliable scroll/zoom positioning. Preserve selection/copying and a compact footer. |
| 5 | **Task 10: core reading features** | EPUB publication-wide text search with snippets, stable locations and visible results; then bookmarks and link-navigation history. Reuse the same search interaction vocabulary in PDF and EPUB. |
| 6 | **Task 10: reading tools** | Persistent highlights/notes, with format-specific location adapters and bounded storage/lifecycle work. |
| Later | **Sessions and polish** | Tabs; multi-window/detach; optional motion, TTS/dictionary and other features only when requirements justify them. |
| Pre-release | **Distribution** | Validate packaged builds, keyboard/IME/accessibility, file handling and behavior on Windows, macOS, and representative Linux distributions. Avoid OS-specific features without an explicit fallback. |

A known, user-visible P0 safety or essential-reading failure blocks acceptance of its feature. Other reproducible defects are prioritized without restarting the whole roadmap. The historical intermittent full-app freeze remains an issue to observe; it is not established as fixed and is not automatically a new audit campaign.

## 09C architecture decision still open

- Current epub.js iframe uses script-disabled sandboxing; WebKitGTK suppresses its DOM event listeners, affecting Clio keyboard routing and internal links. Text selection/copying still works. See [native evidence](epub-keyboard-focus.md).
- Never enable publication scripts, remove the sandbox, expose native APIs to EPUB documents, or steal focus from text selection as a shortcut.
- Compare a **trusted, low-privilege isolated rendering surface** (portable interaction protocol; no publication native capabilities) against minimal native event integration. A separate iframe alone is not a security boundary if host permissions leak into it. Foliate/Readium are reference implementations, not an authorized migration.
- Use one **bounded implementation-oriented prototype** with five concrete acceptance scenarios above. If the renderer boundary cannot be established safely without a large rewrite, stop, report the blocker and choose between a renderer migration and a documented limitation. No endless speculative probes.
- Preserve the single existing keyboard command router and EPUB CFI/reader-generation ownership; do not create a second shortcut interpreter.

## Search baseline

- PDF: keep text indexing and navigation. Make the **active** result visually unmistakable (contrast and outline), position it with context in the viewport, differentiate other matches, and retain correctness across zoom, themes, detail canvases and rerenders.
- EPUB: search publication text, not just chapter names. Report result count and excerpt, jump via stable CFI/range, and show a clear transient active highlight. Index incrementally or on demand; cancel work for closed/replaced documents.
- Both: share palette controls and next/previous semantics. Search highlights are temporary; saved annotations are separate data. Image-only PDFs remain unsearchable until an explicitly scoped OCR feature.

## Hardening and stabilization delivery pipeline

1. **Scope** — One issue/task with user impact, severity, acceptance criteria, and owned files. Reuse the existing roadmap/design and avoid new task-specific reports unless they capture a lasting decision.
2. **Implement** — Small feature branch/PR. Preserve unrelated local modifications, dependencies and `report.txt`. Prefer existing engine APIs and lifecycle boundaries. Never silently expand into refactoring.
3. **Verify locally** — Fast relevant unit/focused checks first. For native input, actual WebKitGTK/Tauri/physical smoke is required; synthetic event dispatch is not sufficient. Do not repeat complete suites during every edit.
4. **CI gate** — Run the complete checks required by [AGENTS.md](../AGENTS.md) for a candidate PR: frozen dependencies, Bun/native suites, TypeScript, frontend build, Rust and diff checks. Fix a demonstrated production issue or a proven invalid test assumption; no weakening solely for green checks.
5. **Review and merge** — Review the exact diff, security boundaries, lifecycle cleanup and manual user-facing behavior. Merge after required CI and acceptance; record limitations concisely.
6. **Continue** — New findings become prioritized GitHub Issues. Reopen architecture only for a demonstrated boundary failure, recurring real-world regression, or an explicitly approved feature requirement.

### Triage and time budget

- **P0:** exploitable security issue, data loss, reproducible full-app lockup, or essential reading blocked. Address before accepting affected work.
- **P1:** significant usability/rendering issue (e.g. poor search visibility, wrong navigation) with product impact. Schedule in the current track.
- **P2:** polish, rare edge case, speculative risk, or test-only fluctuation without product evidence. Backlog.
- Investigate to the first reproducible violating transition. If not reproduced within a bounded attempt, retain a concise issue and stop; no arbitrary sleeps, repeated full-suite loops or growing fixture matrices.
- At each milestone boundary, review open P0/P1 items and dependency/security updates once; defer broad cross-platform release qualification until feature completeness, while keeping portability in architectural decisions.

**Definition of done:** consumer-visible acceptance achieved; focused tests pass; required CI passes; native manual evidence for native interaction changes; no broken security/copy/links or stale ownership; documentation changed only where behavior or decisions changed.
