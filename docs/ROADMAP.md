# Clio — roadmap and delivery pipeline

This is the single planning reference for Clio's next milestones. Keep it short and update decisions in place; use GitHub Issues/PRs for individual tasks and evidence. [AGENTS.md](../AGENTS.md) owns engineering/security invariants; [DESIGN.md](DESIGN.md) owns the interface specification.

## Product boundary

Clio is a local-first, document-first PDF/EPUB desktop reader. Prefer a small, responsive, keyboard-friendly reading surface and an on-demand command palette. Preserve existing PDF.js and epub.js work unless a demonstrated requirement justifies replacing a component. No cloud services, library database, elaborate chrome, or platform-specific assumptions for ordinary reading.

## Priority order

| Order | Milestone | Deliverable and acceptance |
| --- | --- | --- |
| 1 — P0, unresolved | **09C: essential EPUB interactions** | Ordinary reading, including after clicking publication text without activating links: Clio shortcuts and keyboard/palette chapter navigation work; text selection and native copy remain intact; untrusted EPUB scripts/URLs cannot gain native privileges; closing/replacing the document retires all events. Check paged and continuous modes, editable targets and held keys with native evidence. In-content hyperlinks are separately deferred in [Issue #5](https://github.com/TodScissorhands/clio/issues/5); 09C is **not fully accepted**. |
| 2 — decision closed | **09C: wheel** | Keep native scrolling in continuous EPUB. Do **not** build paged EPUB wheel-to-turn or Ctrl+Wheel font gestures. Explicit keyboard/palette page navigation remains. |
| 3 — approved | **09D: interface design** | The approved hierarchy, focus/Escape rules, status, PDF search visibility, EPUB preferences, terminology and responsive/accessibility decisions live in [DESIGN.md](DESIGN.md#09d-review-and-09e-boundary). Deferred hyperlinks do not block this design. |
| 4 — implementation | **09E: interface implementation** | **09E-A:** command Back/discovery, keyboard guidance, terminology and six EPUB preference choosers implemented within the existing palette/footer. **09E-B:** amber PDF search markers, persistent match status and full-match reveal implemented; human physical-input acceptance remains open. Preserve selection/copying and keyboard/wheel semantics; verify responsive layout and accessibility. This does not accept unresolved 09C native keyboard/focus behavior. |
| 5 | **Task 10: core reading features** | EPUB publication-wide text search with snippets, stable locations and visible results; then bookmarks. Link-navigation history follows the separately deferred hyperlink work, not a prerequisite for search/bookmarks. Reuse the same search interaction vocabulary in PDF and EPUB. |
| 6 | **Task 10: reading tools** | Persistent highlights/notes, with format-specific location adapters and bounded storage/lifecycle work. |
| Later | **Sessions and polish** | Tabs; multi-window/detach; optional motion, TTS/dictionary and other features only when requirements justify them. |
| Pre-release | **Distribution** | Validate packaged builds, keyboard/IME/accessibility, file handling and behavior on Windows, macOS, and representative Linux distributions. Avoid OS-specific features without an explicit fallback. |

A known, user-visible P0 safety or essential-reading failure blocks acceptance of its feature. Other reproducible defects are prioritized without restarting the whole roadmap. The historical intermittent full-app freeze remains an issue to observe; it is not established as fixed and is not automatically a new audit campaign.

## 09C acceptance and deferred hyperlinks

- Ordinary EPUB keyboard/focus reliability remains an unresolved essential-reading acceptance requirement, not covered by the hyperlink deferral. A working on-screen Commands control is discoverability, not evidence that content-focused shortcuts work. See existing [native evidence](epub-keyboard-focus.md); require native WebKitGTK/Tauri verification before claiming acceptance.
- In-content chapter/fragment/footnote hyperlinks are deferred as a known limitation in [Issue #5](https://github.com/TodScissorhands/clio/issues/5), including the reported blank-reader/focus disruption on activation. They do not block 09D or the current sequential-reading design track, provided ordinary reading and command-driven chapter navigation remain reliable. This is not a claim that link activation is safe or fixed.
- Do not start 09C-A4, another speculative renderer prototype or a migration solely for Issue #5. Revisit after core keyboard/palette functionality, stability, the approved wheel policy and interface priorities are established; first consult established reader implementations and EPUB navigation semantics. Existing research stays evidence, not an instruction to repeat repository-wide architecture work.
- Preserve script-disabled publication sandboxing, native permission boundaries, selection/copy, the single keyboard command router, CFI restoration and reader-generation cleanup. No focus theft or publication scripting as an input workaround.

## 09D approval boundary

The approved unchanged/refine/consolidate/09E/deferred split lives in [DESIGN.md](DESIGN.md#09d-review-and-09e-boundary). 09E-A implements the six-field preference hierarchy and palette refinements; retained PDF search count and active-match visibility/positioning belong to 09E-B. Neither closes 09C. Keep the approved EPUB wheel decision above unchanged.

## Search baseline

- PDF 09E-B: marker overlays, persistent result status and contextual two-axis reveal are implemented within the existing index/reader ownership; interface decisions remain in [DESIGN.md](DESIGN.md#pdf-search). The real WebKitGTK search regression covers detail rendering, recoloring, multiline/tagged geometry and replacement cancellation. Spread transitions give retained search results priority over old page-top offsets while preserving zoom anchors; both directions are checked immediately and across subsequent render frames. Native Tauri smoke with real PDFs includes X11-injected navigation and clipboard copy; human physical-input acceptance remains open.
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
