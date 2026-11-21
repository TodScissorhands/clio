# Foliate integration stabilization and acceptance

## Integration contract (established before corrective changes)

Target: `/home/tod/.omp/wt/clio-foliate-rebuild`, branch `task/foliate-epub-rebuild`, baseline `44ac4fd101271c49131a54be8b04d4066d914f14`. Initial state: 37 tracked changed paths and 20 untracked entries. `report.txt` is absent in this worktree and must not be created or modified. Initial evidence snapshot: `/tmp/clio-final-acceptance-7GXfud`.

1. Navigation resolves manifest-relative destinations to a spine section and optional same-document fragment. Renderer primary selection is a rendering/navigation concern, not an independent reading-position oracle.
2. Continuous relocation identifies the first visible publication passage, not viewport-centre content. One existing relocation pipeline supplies its range, section and CFI; no polling or duplicate location tracker. Upstream centre preference is intentional, but does not satisfy Clio's first-visible footer contract.
3. Status resolves the same CFI to applicable same-file TOC fragments. Inherited fragments must never bind against another section's identically named IDs. Ordered unambiguous structural gaps use `Parent label · Section N`; otherwise `Section N`. Continuous mode has no fabricated page counts. Paged renderer counters remain section-local and reflow-derived.
4. Status and durable position consume the same `lastLocation.cfi`. Canonical-path persistence stores position only, with the existing Foliate model tag; untagged historical epub.js CFIs retain structural compatibility validation. Invalid/future records are not silently migrated.
5. Paged/continuous and typography transitions retain the addressed reading passage, measured as painted non-whitespace text in the same CFI node on both axes, not identical page-start bytes or collapsed-caret rectangles.
6. Genuine forward/backward continuous movement must reach the existing asynchronous relocation pipeline, including movement following reflow anchoring. Native scroll geometry and relocation completion establish movement; a page-turn promise alone does not.
7. App owns acquisition generation and committed identity. Invalid replacements retain the current document; stale preparation/position/search work cannot commit or affect a replacement. Session/resource ownership transfers and retires once; deferred work/listeners are cancelled at retirement.
8. Publications remain untrusted, sanitized and script-disabled in their dedicated renderer boundary. Native capabilities/session authorization, safe links and CSP remain enforced. No publication-script injection or focus theft is an input workaround. Synthetic runtime checks are distinct from native input proof.

## Confirmed causes and localized corrections

| Finding | Classification and resolution |
| --- | --- |
| Continuous first-visible section 0 but relocation/CFI section 1 | Intentional upstream Readest centre-preference, incompatible with Clio's first-visible requirement. `patches/foliate-js-clio.patch` now returns the first accepted visible range in sorted reading order in continuous mode. Existing image-only collapsed fallback is retained. Paginated range selection and primary-view detection are unchanged. |
| Inherited NAV fragment IDs resolve in another file | Confirmed upstream status-policy incompatibility; the initial worktree already contains the correction in `src/epub/foliateStatus.ts`. Retained and verified its per-section destination index, live-document weak caches, alias ordering and structural fallback. No duplicate labeler or production rewrite added. |
| Preference fixture reports table width 614px instead of 240px | Obsolete geometry assumption. The paginated table's union box spans column fragments/gaps (614 × 440); image remains 120 × 60. `tests/fixtures/epub-preferences-runtime.tsx` checks the table's actual computed CSS width, retaining the explicit 240px requirement and image dimensions. Typography, protected content and passage assertions remain. |
| Historical restoration fixture reuses a heavily reflowed layout-probe session | Fixture lifecycle differs from App's fresh preparation. `tests/fixtures/foliate-runtime.tsx` retires the compatibility probe and prepares a fresh candidate for the actual saved-position restoration. Restoration/reopening awaits painted same-node text, not one frame or primary-index equality; whitespace-only suffixes cannot satisfy visibility. The same historical CFIs and layout-compatibility checks remain. |

### Reading-location proof

Both complete shared EPUB/PDF status and EPUB-only runtime modes exercised a real scroll-container boundary. Forward scrolling reached section 1 at 4760px: visible text, reported section, renderer relocation, CFI and completed saved position agree; independent footer expectation is `Chapter One · Section 2`.

Backward regression uses section 0's actual final painted-character geometry, establishing section 0 at viewport start while section 1 occupies the centre. Observed movement: **4997 → 4416px**, delta −581px, one native scroll operation; fresh relocation reason `scroll`, reported/relocation/CFI section **0**, independent footer **Unicode passage**, completed persisted CFI section **0**. The historical 4997 → 4402px case is the reference diagnosis, not falsely reported as this run's exact pixel measurement. No polling or second location tracker was added.

### Audited test migration

The initial working tree already contained most audit corrections. Inspection retained manifest-resolved `EPUB/...` destinations, actual continuous scrolling, observable relocation waits, same-node painted non-whitespace/two-axis probes, independent TOC/structural label expectations, a re-established later-section backward precondition, post-fast-B preparation baselines, two-axis saved-passage reopening, clipping through actual iframe ancestors and resize freshness without requiring different totals.

This execution changed:

- `tests/fixtures/reader-status-runtime.tsx`: deterministic centre-versus-start boundary setup; independent status, relocation/CFI and completed persistence checks in both directions. Primary index remains diagnostic, not the location oracle.
- `tests/fixtures/epub-preferences-runtime.tsx`: fragmentation-aware table-width assertion; retains all typography, media, reflow, selection/focus and reset coverage.
- `tests/fixtures/epub-acquisition-runtime.tsx`: await completed queued position writes before capturing A/B persistence baselines; use a genuinely resolved `EPUB/chapter-3.xhtml` retired-link target rather than a wrong-root inert destination.
- `tests/fixtures/foliate-runtime.tsx`: fresh restoration candidates, asynchronous painted-passage completion and correct whitespace-only visibility rejection; no neighboring text substitution.
- `patches/foliate-js-clio.patch`: continuous visible-range policy only, plus the adjacent explanatory comment.
- `AGENTS.md`, `docs/DESIGN.md`, `README.md`, `public/licenses/foliate-js.txt`: current engine/lifecycle/security terminology, patch scope and evidence link. The upstream polyfill copyright's literal `Williamsgit st` typo is retained verbatim, not silently rewritten.

### Integrity review

Reviewed the accumulated core diff against baseline and the new Foliate/session/security/status/native files. Old epub.js production reader, adapters and patch are removed in the initial migration diff. `epubjs@0.3.93` remains development-only and is exercised as a historical CFI oracle, not a production fallback. No application/PDF rendering source was changed by this stabilization.

Preserved: malformed NAV/NCX per-entry recovery; real movement after reflow anchoring; first-visible typography anchors; exact-once preparation/Blob URL retirement; cancellation/replacement; native session authorization/CSP/sanitization; internal navigation; single keyboard router and live-document registration. No polling, global paginator rewrite, broad refactor, new dependency or production diagnostic hook.

## Dependency and patch reproducibility

- Pin remains **`22a49acaa120877ede21f713679ab8ba4d1ef663`** in `package.json` and `bun.lock`; Bun's resolved entry abbreviates the commit.
- Downloaded that exact GitHub revision archive; pristine files match the Bun pristine cache byte-for-byte, excluding only Bun's `.bun-tag*` bookkeeping.
- Applied the declared sparse patch independently using `git apply --unidiff-zero` to a disposable pristine copy. All patched source files match the worktree installation byte-for-byte.
- Fresh `BUN_INSTALL_CACHE_DIR` plus `bun install --frozen-lockfile` in an isolated temporary project installed **68 packages**, exit 0. Its patched Foliate source matches the worktree installation byte-for-byte, excluding only `.bun-tag*`.
- Isolated-install security smoke: **1 passed, 0 failed, 0 skipped**, 3 expectations; real WebKitGTK.
- Foliate MIT and polyfill MIT license texts are included verbatim in `public/licenses/foliate-js.txt`, together with the ZIP BSD-3-Clause attribution. Upstream archive SHA-256: `c79a12bb3c756049c868aab1db6d56a68825fbf15d26d3b4f8bd3477659080f7`.
- GNU `patch --fuzz=0` rejected sparse context-only insertion hunks from the pre-existing patch format. This is a patch-tool compatibility result, not accepted as a reproducibility pass: the actual Bun installer and independent `git apply --unidiff-zero` both reproduced identical installed source.

Patched source SHA-256:

| File | SHA-256 |
| --- | --- |
| `paginator.js` | `18e735524664456bd32c246623bc3a7aa3ae39d9d9c561375ab2c28d227628f4` |
| `epub.js` | `b7f76063841b33349bd0786febc9486454f95e2ceef6b1229012e599a9c17229` |
| `view.js` | `0ce9f681f432a7b30432034c8e438555f0ecc149c0a4a76b5e1fd1a764c45778` |
| `fixed-layout.js` | `97322c9d924c1cbf2ac7d3a7338972ccd255dac2eef27cd3413587e341e0703e` |

## Fresh native acceptance

Final candidate: `/home/tod/.cache/clio-final-native-7GXfud/target/debug/tauri-app`, freshly compiled with `bunx tauri build --debug --no-bundle` against the final production frontend (including updated license-description asset) in a task-owned Cargo target. Existing dependency compilation was seeded, but application compilation was observed. File and running `/proc/602215/exe` SHA-256 both:

`6138bf233bc2590b9a141b9ee8c3943588687c1bae0869e1a877a2997f80aa7d`

The complete native campaign below ran again on this final candidate with fresh `final-data`, `final-config` and `final-cache` profiles. The preliminary source-identical behavioral candidate was `8fc57ae5ca6b22c51e8e66d0ee3dd32d59b5e3f4b31b78957511f47cf8b02263`; it is not substituted for final-candidate proof. Neither is the historical accepted `e7f136a9…` executable.

Environment: Arch Linux x86_64, kernel `7.3.4-arch1-1`; GTK **3.24.52**, WebKitGTK **2.54.2**, Bun **1.3.14**. Task-owned Cage headless/pixman compositor and Xwayland `DISPLAY=:2`; application `GDK_BACKEND=x11`, `GDK_SCALE=1`, `GDK_DPI_SCALE=1`; native windows **1280 × 720**. CSS DPR was not independently queried in the uninstrumented application. XDG data/config/cache are isolated below `/home/tod/.cache/clio-final-native-7GXfud`.

Input used real X11/XTEST keyboard, pointer and wheel delivery through `xdotool`. AT-SPI observed text/focus/coordinates; GTK editable access supplied file paths only in the native acquisition chooser. No publication scripts, synthetic JS keyboard events or application-state instrumentation were used.

| Native scenario | Observed evidence |
| --- | --- |
| EPUB open/close, title and paint | Real GTK picker, `status.epub — Clio`; closed native window title `Clio`; readable publication and external 24px footer. |
| Content-focused keyboard/palette | Clicked ordinary publication paragraph; colon opened Reader commands, Escape returned to host reader; PageDown moved the spread, PageUp restored it. Initial colon sent while the shell rather than the EPUB window had focus did not open its palette; not counted as content-focused input. |
| Chapter link and command | Native pointer activation of Internal chapter destination reached section 4, footer Chapter Two; palette Opening passage returned to section 1. |
| Continuous forward/backward | Native wheel input moved within section 1 in both directions; subsequent input crossed into section 2 (footer `Chapter One · Section 2`) and back into section 1 (footer `Nested deep passage`). |
| Mode-switch preservation | Same section-1 paragraph 23 remains visible on both axes in paged and continuous states; native AT-SPI bounds recorded. |
| Saved passage reopening | Actual `reading-positions.json` contains tagged CFI `/56[text-22]/1:91`; reopening paged mode displays paragraph 23 at native bounds `(674,464,537,72)`. |
| Selection and clipboard | Triple-clicked paragraph 1, Ctrl+C; actual GTK X11 clipboard contains the complete expected publication sentence. |
| Search and editor focus | Native typing `Reliable` into focused Search query, Enter: visible active highlight and **1/288** results. |
| PDF navigation/palette/close | Real PDF open; Ctrl+PageDown rendered `Status PDF page 2` / `Page 2 / 3`, Ctrl+PageUp returned to page 1; colon/Escape palette and Ctrl+W close. Plain `j` was only a pan attempt, not counted as page navigation. |
| Stability | No blanking, crash or freeze observed during the listed interactions. This is bounded smoke evidence, not universal freeze certification. |

**Explicitly unverified:** human physical keyboard/pointer, IME composition, native Wayland backend, screen-reader certification and other platforms/device layouts. XTEST is not physical-human evidence.

Final-candidate screenshots, AT-SPI snapshots, real clipboard/position JSON and file/running hash proof are preserved outside version control at `/home/tod/.cache/clio-final-native-7GXfud/evidence/final-candidate/`. Preliminary/native runtime and boundary evidence remain in its parent `evidence/`. Both task-owned native applications were intentionally terminated after closed-state captures (SIGTERM/143, not an observed application crash); their Cage sessions exited. Consolidated command logs and initial source/status snapshot are at `/tmp/clio-final-acceptance-7GXfud/`, with a persistent copy under the evidence directory. No user process was stopped.

## Consolidated automated results

Full-suite invocation:

```sh
CLIO_FOLIATE_REAL_BOOKS=/tmp/clio-foliate-books GDK_SCALE=1 GDK_DPI_SCALE=1 bun test
```

| Gate | Pass | Fail | Skip/ignore | Result |
| --- | ---: | ---: | ---: | --- |
| Complete Bun suite | 1,258 | 0 | 0 | 8,527 expectations, 24 files, 300.93s |
| Rust unit tests | 13 | 0 | 0 | Main binary and doc-test targets additionally ran 0 tests |
| Frozen-install real-WebKit security smoke | 1 | 0 | 0 | 3 expectations |
| TypeScript `bunx tsc --noEmit` | — | — | — | Exit 0 |
| Production frontend `bun run build` | — | — | — | Exit 0, including final rebuild after license-description update; 73 modules |
| Frozen isolated Bun install | — | — | — | Exit 0; 68 packages |
| Upstream/patched/frozen source equivalence | — | — | — | Byte-for-byte, excluding Bun bookkeeping markers only |
| `git diff --check` | — | — | — | Exit 0 |
| Fresh Tauri debug/no-bundle build | — | — | — | Exit 0; final file/running hash above |
| Supplemental malformed NCX runtime probe | 1 scenario | 0 | 0 | Real WebKitGTK: sibling order, inert malformed URI, Unicode and nesting all checked |

The full gate executed the complete shared EPUB/PDF status suite (both complete and EPUB-only modes), acquisition/cancellation/replacement, keyboard registrations/focus routing, typography/reflow/reopen, full-publication search/TOC/navigation, security, both real Gutenberg compatibility books, PDF layout/open lifecycle, pristine-cache lifecycle, CPU cooperative rendering, GPU **and** CPU detail rendering, PDF search/reveal, appearance persistence and shared command/feedback surfaces. Native-dependent tests ran; none were silently skipped.

Observed full-run EPUB resource retirement: **72 created / 72 revoked** Blob URLs. Keyboard registration lifecycle: **30 keydown and 30 keyup registrations added and removed**, zero active, zero recorded runtime errors. Preferences include **20 close/reflow/replacement cycles**. Both Gutenberg 11 and 1342 section-5 historical CFIs resolved through paged/continuous/paged layouts and restored as legacy and tagged records; invalid/future records remained intact until valid explicit navigation.

### Failure collection and classification

Independent suites continued despite ordinary assertion failures; no gate was converted from unexecuted to passed.

| Campaign stage | Pass | Fail | Filtered | Classification / disposition |
| --- | ---: | ---: | ---: | --- |
| Initial focused five-file / seven-case campaign | 5 | 2 | 0 | Table union geometry and reused historical-layout probe; corrected test assumptions, not production workarounds |
| Focused diagnostic after observable restoration waits | 0 | 2 | 1 | Geometry remained wrong oracle; historical probe reuse still failed. Captured exact metrics/CFI/frame geometry |
| Fragmentation-aware preference correction plus restoration diagnostics | 1 | 1 | 1 | Preference gate passed; probe was retired before preparing the real restoration candidate |
| Final complete Bun campaign | 1,258 | 0 | 0 | All affected tests and independent regressions passed |

The temporary NCX host probe initially omitted UTF-8 HTML encoding, so its expected literal Unicode string was decoded incorrectly even though the actual parsed destination was correct. Classified **test-harness failure**; adding explicit UTF-8 to the disposable host produced the passing result above. No production URI or Unicode semantics changed.

GNU sparse-patch rejection is also a **tool compatibility limitation**, resolved for verification by the actual supported Bun installer and independent Git sparse-patch application. Tauri reports the existing default `productName` warning; Node PDF.js emits its existing legacy-build warning. Neither failed a gate. No unresolved unrelated regression was observed; both GPU/CPU detail suites passed in this environment.

## Git and migration review

Verified target at entry: `/home/tod/.omp/wt/clio-foliate-rebuild`, branch `task/foliate-epub-rebuild`, HEAD `44ac4fd101271c49131a54be8b04d4066d914f14`. The active OMP shell initially belonged to another worktree; all implementation, gates and native builds used the named target explicitly.

| State | Tracked changed paths | Untracked status entries | Staged paths |
| --- | ---: | ---: | ---: |
| Entry | 37 | 20 | 0 |
| Final | 39 | 21 | 0 |

Final tracked diff against baseline: **39 files, 1,056 insertions, 6,218 deletions**, excluding untracked files. Final tracked statuses: **26 modified / 13 deleted**. There are **38 individual untracked files** beneath the 21 status entries; the permissions directory accounts for the expansion. Those pre-existing generated Tauri command-permission manifests implement the actual capability boundary, not temporary diagnostic artifacts.

All entry changes/untracked files are retained. Stabilization adds only `AGENTS.md` and `docs/DESIGN.md` to tracked status, plus this new report to untracked status; localized updates are layered onto the existing integration files listed above, including the roadmap and license summary. `report.txt` was absent at entry and remains absent; it was never created, modified, deleted or staged.

Complete final short status (entry status is the same list without `AGENTS.md`, `docs/DESIGN.md` and this report; exact entry snapshot is preserved as `initial-status.txt`):

```text
## task/foliate-epub-rebuild
 M AGENTS.md
 M README.md
 M bun.lock
 M docs/DESIGN.md
 M docs/ROADMAP.md
 M package.json
 D patches/epubjs@0.3.93.patch
 M src-tauri/build.rs
 M src-tauri/capabilities/default.json
 M src-tauri/src/lib.rs
 M src/App.tsx
 D src/epub/EpubReader.css
 D src/epub/EpubReader.tsx
 D src/epub/engine.ts
 D src/epub/iframeKeyboard.ts
 D src/epub/readingPosition.ts
 D src/epub/readingStatus.ts
 D src/epub/styles.ts
 M src/platform/readingPosition.ts
 M src/platform/tauriReaderFiles.ts
 M src/reader/interactions.ts
 M tests/epub-acquisition-runtime.test.ts
 M tests/epub-keyboard-lifecycle-runtime.test.ts
 D tests/epub-paginated-visibility.test.ts
 M tests/epub-preferences-runtime.test.ts
 D tests/epub-reading-position.test.ts
 D tests/epub-reading-status.test.ts
 D tests/epub-spine-linearity.test.ts
 D tests/epub-stage-lifecycle.test.ts
 M tests/fixtures/create-epub-acquisition-document.py
 M tests/fixtures/epub-acquisition-runtime.tsx
 M tests/fixtures/epub-keyboard-lifecycle-runtime.tsx
 M tests/fixtures/epub-preferences-runtime.tsx
 M tests/fixtures/pdf-detail-rendering-runtime.tsx
 M tests/fixtures/reader-command-state-runtime.tsx
 M tests/fixtures/reader-feedback-runtime.tsx
 M tests/fixtures/reader-status-runtime.tsx
 M tests/reader-status-runtime.test.ts
 M vite.config.ts
?? docs/foliate-integration-acceptance.md
?? epub-reader.html
?? patches/foliate-js-clio.patch
?? public/
?? src-tauri/capabilities/epub-reader.json
?? src-tauri/permissions/
?? src-tauri/src/epub_session.rs
?? src/epub/FoliateReader.css
?? src/epub/FoliateReader.tsx
?? src/epub/foliate.d.ts
?? src/epub/foliateSecurity.ts
?? src/epub/foliateSession.ts
?? src/epub/foliateStatus.ts
?? src/epub/main.tsx
?? src/epub/preferenceCss.ts
?? tests/fixtures/create-foliate-security-document.py
?? tests/fixtures/foliate-runtime.html
?? tests/fixtures/foliate-runtime.tsx
?? tests/fixtures/foliate-test-reader.ts
?? tests/foliate-runtime.test.ts
?? tests/foliate-security.test.ts
```

Baseline migration deletions remove the old production engine and its implementation-specific harnesses; retained tests use the real Foliate/App paths, and historical CFI compatibility remains explicitly justified. The tiny Foliate fixture reader helper selects the current renderer/document, not an epub.js compatibility shim. No temporary publication/runtime instrumentation or generated native binaries/screenshots were added to repository source/version-control status. Full frontend asset code hashes remained unchanged across the final attribution-only rebuild; only the descriptive license asset required re-embedding.

## Remaining requirements and verdict

**No unresolved blocker for this scoped integration acceptance.** All required automated gates passed; focused native Tauri/WebKitGTK/XTEST acceptance passed on the final fresh candidate.

Unverified release qualifications, not silently accepted:

1. Physical-human keyboard/pointer and IME input; XTEST does not prove these.
2. Native Wayland backend, other platforms/device layouts and assistive-technology certification.
3. Universal absence of the historical intermittent freeze; only the listed bounded interactions were observed stable.

**Final verdict: PASS — scoped Foliate integration and required automated acceptance.** The explicit physical/platform limits above remain unverified, not failures converted to passes. No reset, clean, rebase, discard, stage, commit, push, merge or PR operation was performed. Await authorization for the integration commit.

## EPUB-S1: continuous navigation and location integrity

Execution baseline: `master` at `1548ed3`; clean short status and one existing worktree at `/home/tod/Projects/clio`. No commit, merge, push, reset, dependency/pin, capability, PDF, security-policy or Shift+N change. `report.txt` was not touched.

### Reproduction matrix

| Scenario | Before | After | Evidence boundary |
| --- | --- | --- | --- |
| Reported original Chapter 48 publication | UNVERIFIED | UNVERIFIED | Original book unavailable; no claim that its defect is fixed |
| Controlled 50-spine TOC, publication links and fragment links; Chapters 48→49→48→47→1→50, both layouts | PASS | PASS | 36 settled cases per complete/EPUB-only WebKitGTK run; native TOC/link chapter-48 activation also passed |
| Forward/reverse continuous scroll across sections | PASS | PASS | Real WebKitGTK relocation/paint/footer/save checks and native XTEST wheel crossings |
| Scrollbar-thumb drag and large jumps | PASS | PASS | Native thumb drags changed painted section and durable CFI in both directions; deterministic jumps recorded scroll geometry and loaded sections |
| Resize first-visible CFI versus completed save, after navigation | FAIL | PASS | Real WebKitGTK viewport resize, 800×536→1000×676 |
| Layout-reflow first-visible CFI versus completed save, after navigation | FAIL | PASS | Native mode switching plus deterministic layout sequence |
| Addressed passage remains visible through paged→continuous→scroll→paged→continuous→close/reopen | PASS | PASS | Same-CFI painted-text geometry in WebKitGTK; native AT-SPI, screenshots and real position JSON |
| Native Tauri viewport resize | UNVERIFIED | UNVERIFIED | Cage fullscreen rejected XRandR resize (`BadMatch`); XTEST window-size request timed out |
| Keyboard/palette, selection/copy, lifecycle, historical CFI and publication security | PASS | PASS | Focused runtime coverage; native content-focused colon/Escape, PageDown and actual clipboard; complete gates below |

The fixture is an equivalent controlled navigation probe, not a reconstruction of the missing publication's CSS/DOM. Chapter numbering is one-based: Chapter 48 resolves to spine index 47. Tests record requested href/fragment, resolved index, primary index, first painted text/CFI, `lastLocation.cfi`, footer, saved CFI, frame/viewport bounds and scroll coordinates. The footer is never relabeled to match a requested destination.

### Confirmed cause and correction

`FoliateReader.tsx:updateLocation()` updated the footer for every relocation but queued persistence only for navigation-class reasons. Foliate's resize/layout `anchor` relocations were excluded even after genuine navigation had enabled saving.

Deterministic before/after: at the continuous end of Chapter 50, the 800×536 viewport first paints passage 32 and saves a CFI starting `/76[p32]/1:92`. Resizing to 1000×676 clamps scrollTop from 8017 to 7877; first painted text and `lastLocation.cfi` now start at `/72[p30]/1:92`. Before the correction, completed storage remains at passage 32 for the entire observation deadline. Afterward, storage equals the passage-30 `lastLocation.cfi`; footer remains correctly `Chapter 50` throughout.

Correction: navigation still controls `permitSave`; subsequent renderer relocations, including reflow/resize, queue that same `lastLocation.cfi` through the existing serialized write queue. Initial restoration and incompatible/untagged historical records remain protected until intentional navigation. No second location tracker, position store, polling, footer override, new ordering abstraction or CSS compensation.

**Not established:** incorrect spine resolution, lost chapter-48 paint, stale asynchronous navigation completion, or a mode-only anchor defect. `applyFoliatePreferences()` still captures a separate anchor only for typography changes. Foliate already renders flow changes using its navigation/scroll anchor; the addressed painted passage remained visible in the exercised transitions. No speculative mode-anchor or navigation-generation change was made.

Paged layout can start before the addressed passage. Reopening preserves the saved passage, not byte-identical page-start CFIs: the deterministic reopen saves passage 37 and displays a paged range beginning at passage 28 that still contains the saved passage. Restoration does not rewrite that record merely because page boundaries differ.

### Native evidence

Task-owned debug/no-bundle Tauri builds used isolated Cargo and XDG paths, Cage headless/pixman, Xwayland `:2`, `GDK_BACKEND=x11`, scale/DPI scale 1, 1280×720 windows. Input was trusted X11/XTEST via `xdotool`; AT-SPI and screenshots observed the surface. No publication script or production diagnostic hook was installed.

- Before correction, native continuous→paged reflow displayed `Chapter 48 opening` while real storage still began at `/26[p7]/1:91`.
- After correction, native scrolling addressed Chapter 48 passage 7; paged reflow retained that passage and saved the actual first-visible passage-4 suffix (`/20[p4]/1:70`). Switching continuous again saved its current passage-7 start. Close/reopen kept the saved passage visible.
- Final-candidate wheel input crossed Chapter 48→49 (saved `/6/98!`, passage 2) and back to Chapter 48 (saved `/6/96!`, passage 24). Native thumb drags reached Chapter 50 passage 18, then Chapter 45 passage 11. Painted text/footer and real tagged JSON agreed.
- Final-candidate triple-click/Ctrl+C copied the complete expected Chapter 45 passage-12 sentence. Content-focused colon opened the real palette; Escape and PageDown worked.

Native internals (`primaryIndex`, live CFI and scrollTop) were observed in deterministic real-WebKitGTK fixtures, not extracted from the uninstrumented Tauri process. Native evidence supplies actual painted geometry, footer, input delivery and durable JSON; do not mistake those for a native internal-state trace. Native resize, physical-human input, IME, Wayland and accessibility certification remain unverified.

Persistent evidence directory: `/home/tod/.cache/clio-s1-native/evidence/`. Includes before/after executable hashes, screenshots, AT-SPI/position JSON, deterministic navigation/resize/layout records and gate logs. Task-owned native applications/compositors were terminated intentionally; temporary control tooling was removed.

### Files and proposed commit scope

- `src/epub/FoliateReader.tsx`: save eligible reflow/resize relocations after intentional navigation.
- `tests/fixtures/create-reader-status-documents.py`: separate 50-section EPUB; existing six-section fixtures unchanged.
- `tests/fixtures/reader-status-runtime.tsx`: destination, movement, resize, mode-switch and reopen regressions using the real App and painted-text oracle.
- `tests/reader-status-runtime.test.ts`: serve the additional EPUB.
- `docs/foliate-integration-acceptance.md`: this scoped evidence and limitations.

Proposed subject: `fix(epub): persist first-visible location after reflow`. No commit authorized or created.

### Gate results

Focused final command (with `CLIO_FOLIATE_REAL_BOOKS=/tmp/clio-foliate-books`): status, preferences and Foliate runtime — **5 passed, 0 failed**, real WebKitGTK. The first invocation omitted that required real-book environment variable and failed its compatibility precondition; this was not counted as a pass.

| Final gate | Result |
| --- | --- |
| Complete Bun suite, real-book environment supplied | 1,258 passed, 0 failed, no skipped tests; 8,527 expectations, 24 files, 334.52s |
| `bunx tsc --noEmit` | Exit 0 |
| `bun run build` | Exit 0 |
| `cargo test --manifest-path src-tauri/Cargo.toml`, isolated Cargo target | 13 passed, 0 failed/ignored; binary/doc targets also completed |
| Fresh native Tauri debug/no-bundle build | Exit 0, before and after |

The complete suite ran the real-WebKitGTK security, historical-CFI, acquisition, keyboard/lifecycle and both status modes; none were silently skipped. Final whitespace-check output is retained as `diff-check.log` beside the gate logs.

Native executable SHA-256: before `ff04201b47d2dcec144beef8ec42042ef00a3925bebd9c8244e702563703215f`; after `f6903e1dcf92a664d355aec5f6524240d6db03bd52f950b36e9bbd2cfd500125`.

Remaining experiment for the original report: run the same href/resolved-index/painted-character/CFI/scroll trace against the actual Chapter 48 publication, including its exact CSS and viewport. Controlled successes cannot exclude a book-specific boundary defect. Additional writes during repeated reflow are serialized by the existing queue; no concurrent-navigation race was demonstrated or claimed fixed.

## EPUB-S2: paged chapter reversal

Baseline: S1 committed at `5d58e66`; clean short status, one existing checkout. No commit, dependency/pin change, permission change, PDF change or `report.txt` modification.

### Confirmed mechanism and correction

The supplied `review-a.epub` reproduces the failure in fresh Tauri/WebKitGTK 2.54.2 with X11/XTEST. After ordinary-text focus, `n` paints Chapter 2 in the right column beside Chapter 1's tail; `Shift+N` does nothing. At settled idle, the rebuilt S1 baseline saves Chapter 1's tail (`/6/2!.../150[p59]...`), unlike the earlier review's Chapter 2 CFI. Both observations are retained, not conflated.

A disposable real-App WebKitGTK trace separates target resolution from placement: `goTo(1)` completes with index 1, but the retained predecessor occupies half the destination spread. Paged anchor placement floors the target's global spread offset; the delayed container-scroll relocation selects that preceding section again. At 1280×700, requested/returned index is 1, settled primary/CFI/first-painted indices are 0, and previous-chapter issues no `goTo`. Repeating next without a new scroll can instead leave primary/CFI at 1 on the identical mixed spread. This is a placement/relocation disagreement, not an incorrect spine href or solely a stale saved CFI. Merely substituting CFI for primary index cannot correct the settled failing case.

The declared Foliate patch now distinguishes public explicit paged navigation from ordinary page turns. It retires predecessor views before aligning that destination and prevents the same navigation's short-section/fill preloads from putting them back in front. The destination starts its own spread; following sections can still preload. Private page-turn navigation keeps its existing shared-spread behavior. Continuous navigation takes the unchanged path. No supported public Foliate API exposes predecessor-cache trimming, so this correction belongs in the existing pinned renderer patch, not host DOM/CSS compensation.

Chapter commands derive their section from the existing `lastLocation.cfi` via `resolveCFI`, not spread ownership; absent location is a no-op. Existing nonlinear skipping, bounds, keyboard routing, navigation ownership and serialized canonical-path position writes remain.

### Focused evidence and owned files

Evidence directory: `/tmp/clio-s2-native/`; candidate binaries: `/home/tod/.cache/clio-s2-native/`. `trace-before-observed.json` and `trace-after-corrected.json` record requested target, actual completion, primary/CFI indices, first painted character, footer, saved CFI, viewport/frame geometry and scroll coordinates on the supplied archive at 420/1000/1280px.

Before correction, the added real-App fixture fails wide chapter arrival: target/return/CFI index 2, but first-painted index 0. After correction, both complete and EPUB-only WebKitGTK status cases pass: 27 settled chapter/boundary observations each, 420px single-column and 1000px multi-column, repeated reversal, nonlinear skipping, a short last chapter and Continuous next/previous controls. Existing destination/reflow/reopen/status/acquisition cases remain enabled. A 400ms observation window includes Foliate's debounced native scroll relocation rather than accepting only immediate `goTo` completion.

- `src/epub/FoliateReader.tsx`: read the current CFI section for chapter commands.
- `patches/foliate-js-clio.patch`: explicit paged destination alignment and scoped preload behavior; no continuous or ordinary page-turn policy change.
- `tests/fixtures/create-reader-status-documents.py`: independent four-spine archive, three linear chapters and a nonlinear middle section; existing archives unchanged.
- `tests/fixtures/reader-status-runtime.tsx`: actual command/completion, painted passage, boundary, nonlinear, status and saved-position regressions.
- `tests/reader-status-runtime.test.ts`: serve that archive.
- `docs/foliate-integration-acceptance.md`: scoped evidence, results and remaining limits.

### Native matrix and limits

Fresh debug/no-bundle candidates used isolated Cargo targets and XDG state. Baseline: headless Cage/Xwayland, 1280×720. Corrected matrix: headless Sway/Xwayland with actual reader-window sizes 420×700, 1000×700 and 1280×700. Both use `GDK_BACKEND=x11`, scale/DPI scale 1, GTK 3.24.52 and WebKitGTK 2.54.2. These are trusted X11/XTEST events, not DOM keyboard dispatch or physical-human input.

A matched 1280×720 Tauri round trip also passes. Initial and restored durable CFIs are exactly `epubcfi(/6/2!/4,/2,/40[p4]/1:196)`; after `n`, the saved CFI is `epubcfi(/6/4!/4,/2,/40[p4]/1:196)`. Chapter 2's heading moves from the baseline right-column x=674 to corrected first-column x=68; `Shift+N` restores Chapter 1 at x=68. `matched-native-summary.json` and the corresponding PNG/AT-SPI snapshots retain both runs.

| Scenario | Before | After | Evidence |
| --- | --- | --- | --- |
| Supplied archive, wide Chapter 1 → `n` → `Shift+N` | FAIL | PASS | Tauri screenshots, AT-SPI geometry and real canonical-path JSON; instrumented WebKit target/completion trace |
| Repeated adjacent chapter reversals at 420/1000/1280px | Wide failure; narrow trace PASS | PASS | Both native archives; 54 settled start/navigation/boundary observations |
| First/last chapter boundaries | UNVERIFIED | PASS | Native unchanged CFI and addressed heading; WebKit asserts no navigation |
| Nonlinear middle section, both directions | Narrow PASS; wide arrival FAIL | PASS | Native 0 → 2 → 0 spine indices; short last chapter at index 3 |
| First-painted section, footer and durable CFI agreement | FAIL on mixed spread | PASS | Native screenshots/JSON plus independent WebKit painted-character/status/save assertions |
| Content-focused colon, palette navigation, Escape focus return | Prior evidence only | PASS | Both native archives, all three widths |
| Publication selection and native Ctrl+C | Prior evidence only | PASS | Exact GTK clipboard text on supplied archive at all three widths |
| Continuous next/previous controls | Prior evidence only | PASS | Both native archives and WebKit control sequence |
| Physical input, IME, native Wayland | UNVERIFIED | UNVERIFIED | Not exercised; Xwayland is not native Wayland evidence |

Native footer pixels are retained in every per-action PNG. AT-SPI does not expose the hidden location span as text in this environment; the disposable WebKit fixture independently asserts footer/CFI agreement. The supplied archive starts with selection text and controls before its TOC `#start` heading, so the honest first-visible footer can be `Section 1`/`Section 2`, not the later heading label. It was not overridden to make navigation pass.

Native internal primary/CFI/`goTo` telemetry comes from the separate disposable real-App WebKitGTK trace, not a production Tauri hook. Native Tauri itself establishes painted destination/geometry, trusted input and actual durable writes. Initial native probes encountered stale accessibility-bus configuration, shell-versus-reader window selection and chooser focus issues; the probes were corrected without application changes. An intermediate renderer patch had incorrect downstream hunk offsets and failed parsing; corrected offsets were reapplied with the frozen lockfile before successful focused/native execution. Failure logs remain under `/tmp/clio-s2-native/`.

Risk: explicit paged navigation now retires cached predecessor documents, so reversing intentional chapter navigation may reload them. Ordinary page turns retain existing sharing/preloading; continuous scrolling, publication scripting/CSP/sandbox, native capabilities, canonical-path `reading-positions.json` and `cfiModel: "foliate-html-v1"` are unchanged. No historical CFI migration, new position tracker or broader 09C acceptance is claimed.

### Gates and proposed scope

Focused command: `CLIO_FOLIATE_REAL_BOOKS=/tmp/clio-foliate-books GDK_SCALE=1 GDK_DPI_SCALE=1 bun test tests/reader-status-runtime.test.ts` — **2 passed, 0 failed**, real WebKitGTK, 99.30s.

`bunx tsc --noEmit` and `bun run build` exit 0. `cargo test --manifest-path src-tauri/Cargo.toml` with the task-owned Cargo target passes all **13 tests**, no failures/ignored tests; binary and doc-test targets complete. Fresh native debug/no-bundle builds pass before and after.

Complete command `CLIO_FOLIATE_REAL_BOOKS=/tmp/clio-foliate-books GDK_SCALE=1 GDK_DPI_SCALE=1 bun test`: **1,258 passed, 0 failed, no skipped tests**, 8,527 expectations across 24 files, 318.23s. Real WebKitGTK status/reflow/reopen, historical two-book CFIs, security, acquisition, keyboard/listener lifecycle, EPUB preferences and the unchanged PDF suites ran. Full output is retained as `full-bun.log`; the final whitespace gate is retained as `diff-check.log`.

Preserved evidence is also copied to `/home/tod/.cache/clio-s2-native/evidence/`. Native executable SHA-256: baseline `f6903e1dcf92a664d355aec5f6524240d6db03bd52f950b36e9bbd2cfd500125`, corrected `0c346e11f0ebda5b7a6a5dab378825983ed6d1de1e51166f5fb8acfeb0626ebc`. Task-owned native compositors/processes are stopped; disposable diagnostic scripts are removed.

Proposed commit scope: the six files listed above; subject `fix(epub): align paged chapter destinations with reading location`. No commit, push or merge performed. Physical-human/IME/native-Wayland qualification and the separate hyperlink/09C limitations remain open; these fixture results do not close those workstreams.

## EPUB-C1: continuous chapter destination investigation

Baseline: `44ef1b1601b2b6625c2a61ab0209bc58add11db2` plus the eight unstaged S4C paths. Their entry patch, hashes and status are preserved under `/tmp/clio-epub-c1/baseline/`; S4C's original `/home/tod/.cache/clio-s4c/evidence/` is unchanged. No commit, staging, reset, dependency change or `report.txt` operation was performed.

### Established cause: short final-section scroll clamping

The native Chapter 2 → `n` report reproduces with Caps Lock off and on. The controlled `reversal.epub` final chapter contains only its heading and passage 0. In Continuous, its rendered height is less than the viewport height, and there is no following content. Foliate requests the correct spine index 3 and default section-start anchor 0, but the browser cannot scroll that section's start to the viewport start. The requested offset exceeds `scrollHeight - clientHeight`.

Disposable real-App WebKitGTK instrumentation records both command-promise completion and the settled result after 400ms, relocation reasons, frames, painted characters, current CFI, footer and completed save:

| CSS width / viewport height | Final-section height | Maximum scrollTop / actual scrollTop | Final frame top | First-painted passage |
| --- | --- | --- | --- | --- |
| 420 / 676 | 202.875 | 8669 / 8669 | 472.95 | Chapter 2, passage 35 |
| 1000 / 676 | 154.875 | 4781 / 4781 | 520.95 | Chapter 2, passage 32 |

`goTo(3)` returns index 3 in both cases. The geometry is already clamped at completion and remains identical after settling; `navigation` and subsequent `anchor` relocations report the same actual first-visible Chapter 2 range. The completed saved CFIs are respectively `epubcfi(/6/6!/4,/74[p35]/1:126,/82[p39]/1:166)` and `epubcfi(/6/6!/4,/68[p32],/82[p39]/1:166)`. Chapter 3's opening is painted below that tail, not lost or resolved to another section. Paged controls at both widths place Chapter 3 first and save `epubcfi(/6/8!/4,/2,/4[p0]/1:165)`.

Fresh debug/no-bundle Tauri/WebKitGTK with trusted X11/XTEST independently paints Chapter 2 passages 30–39 above Chapter 3 in the initial compositor-sized window. Actual canonical-path `reading-positions.json` saves `epubcfi(/6/6!/4,/64[p30],/82[p39]/1:166)`, tagged `foliate-html-v1`, with Caps Lock either off or on. The footer pixels say Chapter 2. Paged `n` paints Chapter 3 at the first column and saves the Chapter 3 CFI above. This window's compositor ignored the initial size request; it is not represented as the 1000×676 CSS trace.

### Scoped outcome and regression contract

No production correction is established for this reproduction under the requested “when layout and scroll limits permit” contract. The renderer already requests the correct section start; its continuous scroll range cannot place this short last section there. There is consequently **no corrected before/after placement claim** and no justification for the proposed fix commit subject.

The approved clamp contingency is retained: first-visible paint, footer and canonical saved CFI must remain truthful. No `alignStart` option, predecessor removal, host offset, trailing blank-space policy or global snapping was added. A trailing reading-space policy would change the scroll extent and needs a separate explicit product decision; relabeling the footer or saving Chapter 3 while Chapter 2 paints first would regress S1. `FoliateReader.tsx`, `foliateSession.ts`, Foliate declarations and the pinned patch remain unchanged, as do security boundaries.

Only the chapter probe in `tests/fixtures/reader-status-runtime.tsx` changes: immediate/settled placement telemetry, reachable opening placement, explicit physical-limit checks for the short final chapter, truthful first-visible CFI/footer/save, repeated reversals, nonlinear skipping, first/last controls, rapid reverse and chapter/page-turn overlap, 420/1000 CSS-pixel layouts, mode round trips and saved-passage reopening. Reachable-section bounds allow 2 CSS pixels for observed fractional scroll/device-scale quantization; the independent opening-text assertion still rejects any preceding painted passage. The S4C Shift+J hunk is untouched. Existing S1 Chapter 48 TOC/link/fragment and natural-scroll probes remain enabled.

### Separately observed mode-round-trip failure

The expanded assertion is retained, not suppressed: after Continuous → Paged → Continuous at 420px, the addressed Chapter 2 heading is outside the painted viewport. Disposable geometry shows Chapter 1 passage 23 first at y≈−2.33, Chapter 2's frame top at 1900.47, scrollTop 2671, while footer/current/saved CFI still describe Chapter 2. This is a distinct reflow/anchoring failure, not the end-of-book clamp (the maximum scrollTop is 8466). Both complete and EPUB-only focused cases fail `chapter mode reversal lost addressed passage`. The original preference/reflow assertion is unchanged and remains separately tracked; this evidence does not prove the two failures have the same cause.

### Evidence and limitations

Evidence root: `/tmp/clio-epub-c1/evidence/`. `trace-before.json` and `probe-before.txt` retain the original four-case placement trace; `before-native.json` and `before-*.png` retain native paint/storage and Caps controls. `trace-mode.json`, `focused.log` and `focused-final.log` preserve failed assertions and geometry. Startup/chooser/accessibility failures are retained as harness failures, not application passes.

Native provenance: fresh task-owned Cargo target `/home/tod/.cache/clio-epub-c1-target`, separate XDG data/config/cache and explicit disposable DBus/AT-SPI buses; WebKitGTK 2.54.2, GTK 3.24.52, Xwayland `:1`, `GDK_BACKEND=x11`, scale/DPI scale 1, `xdotool` XTEST. Publication scripting, CSP, sandbox and capabilities are untouched. Renderer internals come from the disposable WebKitGTK fixture, not production hooks in Tauri.

The original Chapter 48 publication is still unavailable and explicitly unverified. The approved real-book directory `/tmp/clio-foliate-books` is absent; the existing corpus could not be found, and no replacement corpus was downloaded or synthesized. Physical-human input, IME, native Wayland and other platforms remain unverified. This investigation does not close the earlier hyperlink/content-input limitations.

### Complete gate results

| Gate | Observed result |
| --- | --- |
| Focused actual-App status cases | 0 passed, 2 failed; both execute WebKitGTK and stop at the retained chapter mode-reversal assertion |
| Complete Bun suite with the requested real-book environment and display | 1,270 passed, 4 failed, 0 skipped; 8,577 expectations, 26 files, 393.76s |
| `bunx tsc --noEmit` | Exit 0 |
| `bun run build` | Exit 0 |
| `cargo test --manifest-path src-tauri/Cargo.toml`, isolated target | 24 passed, 0 failed/ignored; binary and doc-test targets complete |
| Fresh debug/no-bundle Tauri baseline build | Exit 0 |

The four Bun failures are the two actual-App mode-reversal cases and the two Foliate runtime cases that fail their missing `gutenberg-11.epub` precondition before opening WebKitGTK. The absent second required book is `gutenberg-1342.epub`. Those two native compatibility cases are **not passes**. The existing EPUB preferences/reflow test passes this complete run; its intermittent assertion was neither changed nor reproduced here.

Before the new mode-round-trip failure, each focused case completes all 36 S1 Chapter 48 TOC/link/fragment destinations, large forward/backward jumps, ordinary continuous scrolling, resize, existing mode changes and saved-passage reopening. Paged chapter placement runs at 420/1000px; expanded Continuous 420px chapter/clamp/rapid/page-turn checks complete before the failing mode reversal. Expanded Continuous 1000px chapter assertions and subsequent same-fixture scenarios are not accepted merely because their code remains enabled.

The complete run also executes the existing command-palette/modifier, keyboard/lifecycle, selection/copy, security, acquisition, EPUB preferences and unchanged PDF tests. Full logs: `full-bun.log`, `typescript.log`, `frontend.log`, `rust.log`, `build-before.log`. Acceptance is incomplete: the mode-transition failure is retained and the required real-book corpus is unavailable. No production fix or final corrected native candidate is claimed.

### Native matrix completion and boundary

Trusted XTEST flows completed in Paged and Continuous at requested 420/1000px reader widths on the desktop display, and at an actual 1400×700 client size on a task-owned headless Sway/pixman/Xwayland `:2` display with output scale 1. Desktop captures are 525×875 and 1250×875 device pixels respectively; they are not mislabeled as scale-1 image coordinates. Desktop chooser/focus failures remain in their original logs/captures; the remaining wide cases completed on the isolated display without application changes.

The matrix records forward/backward nonlinear skipping, repeated reversals, a 30ms rapid reversal, first-boundary input, the short final destination, Caps off/on, actual paragraph triple-click/Ctrl+C, content-focused colon/Escape, wheel movement, mode requests and reopening. The clipboard contains the complete expected Chapter 2 passage-0 sentence in each completed case. The 1400px short-destination inputs also follow an actual ordinary-publication-text click, not host focus injection. Long Chapter 1 → Chapter 2 opens with the Chapter 2 heading first; the short last chapter retains the documented clamp in Continuous and starts its own spread in Paged.

Matched isolated 1400px native bounds: Chapter 3's heading is at screen `[173,219,591,49]` in Paged and `[440,692,720,49]` in Continuous (client top y=150). Footer pixels and actual storage identify Chapter 3 in Paged and Chapter 2 passage 32 in Continuous. Five wheel-up notches move the continuous saved start to passage 26; five down notches return it to passage 32 without a chapter-start snap. `headless-1400-*.png`, `headless-1400-*-matrix.json` and corresponding logs retain this evidence; `native-420-*` and `native-1000-*` retain the desktop cases.

Native mode requests are not blanket mode-transition acceptance: one requested Paged transition still paints a continuous passage-9 viewport, so it is not reported as a completed Paged step or as proof that the heading was retained. Reopening preserves the actual saved passage in the observed paged range; it does not prove every mode round trip is correct. The failing real-App mode assertion above remains the acceptance blocker.

Evidence is also preserved under `/home/tod/.cache/clio-epub-c1/evidence/`, including the S4C entry snapshot, native position files, original before trace, automation source and all gate/failure logs. Disposable instrumentation is not installed in production; task-owned native applications and the isolated compositor are stopped after capture.

## EPUB-C1.1: mode-round-trip anchoring and test recovery

Entry: HEAD `44ef1b1601b2b6625c2a61ab0209bc58add11db2`, nine modified unstaged paths, empty index. The S4C changes and C1 investigation were preserved, including their original evidence and the fixture's Shift+J hunk. New evidence is isolated at `/home/tod/.cache/clio-epub-c1/evidence/c1-1-20261121-093525/`. No commit, push, reset, rebase, dependency-version change or `report.txt` modification.

### Original failures: real settled anchor loss, not clamping

Both `complete` and `epub-only` runs fail the unchanged `chapter mode reversal lost addressed passage` assertion: expected `cfiVisible(addressed) === true`, actual `false`. They are the same Continuous → Paged → Continuous transition at 420×700 outer CSS pixels / 420×676 reader pixels, not two different mode directions.

The independent `reversal.epub` spine is Chapter 1 (40 paragraphs), nonlinear notes, Chapter 2 (40 paragraphs), Chapter 3 (one paragraph). The failing command sequence addresses Chapter 2's opening after chapter/page-turn overlap. Starting CFI: `epubcfi(/6/6!/4,/2,/14[p5]/1:43)`. Its start is the heading, not passage 5; passage 5 is the range's end.

Before switching, Chapter 2's heading paints at y=24.71. Paged paints it at y=71.44. On returning Continuous, an `anchor` relocation initially paints it at y=3.91 and emits `stabilized`. The next frame expands the preceding section: Chapter 2's frame moves to y=1900.47, Chapter 1 passage 23 becomes first at y=−2.33, and the addressed heading disappears. ScrollTop remains 2671 with maximum 8466, so this is not an end clamp. No later relocation repairs the position during the remaining **15,097ms** of observation.

Both original variants persist `epubcfi(/6/6!/4,/2,/14[p5]/1:81)` and show Chapter 2 despite the actual first-painted character CFI `epubcfi(/6/2!/4/50[p23],/1:0,/1:1)`. The failure therefore also violates truthful first-visible status/persistence; a correct resolved section or an early `stabilized` event is not sufficient acceptance.

### Confirmed renderer corrections

1. **Continuous sizing order:** Foliate's section `expand()` measured height while its iframe still retained the paginated cross-axis width. It reset that width only after measuring. The deferred ResizeObserver expansion then enlarged preceding sections after the paginator had placed its anchor; scrolled `onExpand` deliberately does not re-anchor, and the anchor-position guard consumed the idle scroll notification. Move the two existing cross-axis size assignments before measurement. No extra scroll, spacing or anchor state is introduced.
2. **Repeated shared-spread anchoring:** the extended 1000px two-cycle control paints Chapter 1 passage 39 before the still-visible Chapter 2 heading. A debounced `container-scroll` changes primary ownership to Chapter 1; `#anchorIsVisible` rejected the Chapter 2 range solely because it belonged to another Document, replacing a still-visible reading anchor. The next round trip drifted to Chapter 1 passage 29 and lost Chapter 2. Check visibility in the anchor's own mounted section using Foliate's existing visible-range machinery, and map its rectangle using that section's offset/direction rather than the primary view's. Ordinary scrolling still replaces the anchor through its existing relocation reasons.

These are private section-measurement, anchor-visibility and coordinate-ownership stages. Public `goTo()`/`render(anchor)` cannot reorder iframe sizing or correct those private cross-document assumptions. The changes belong in `patches/foliate-js-clio.patch`; host `FoliateReader.tsx` and `foliateSession.ts` remain unchanged. No speculative mode anchor, duplicate position tracking, forced chapter boundary, CSS compensation or navigation generation was added. Publication sandbox, CSP, capabilities and scripting restrictions are unchanged.

The isolated renderer correction passes all eight geometry/direction combinations: original 420×700 plus 420×600, 1000×700 and 1440×800, both initial modes; chapter openings, a long middle passage, short-final-section clamping, two round trips per location and canonical saved-passage reopening. Its 200 observations include 108 mode transitions and 92 chapter/boundary observations; none loses its addressed target.

### Test-oracle and completion distinctions

- **Legal page boundary:** at 1000px, Chapter 1 passage 39 can be first while Chapter 2's heading remains painted. Footer and saved CFI must describe Chapter 1, not be forced to Chapter 2. This remains a passing control; byte-identical page-start CFIs are not required.
- **Explicit middle target:** navigation to `#p20` paints a paginated range starting at passage 19 offset 44. Continuous correctly starts at the requested passage 20. A newly added assertion initially mistook that earlier page-start suffix for the requested destination; the oracle now retains the explicit passage-20 CFI, while independently requiring truthful first-visible CFI/footer/save.
- **Reopening protection:** a fresh reader does not enable writes merely by restoring or reflowing. A new test initially demanded a changed first-visible CFI overwrite the restored record. It now requires that original canonical record remain intact, with its passage visible, until intentional navigation enables writes. Production persistence ordering is not changed.
- **Completion:** mode assertions observe actual flow, `stabilized`/`relocate`/scroll events, and unchanged paint/CFI/footer/save/frame/scroll tuples across consecutive animation-frame samples. New events restart quiet detection. The reported CFI range must contain the independently painted first character. Target visibility is then asserted separately; no fixed mode-switch sleep substitutes for renderer completion.
- **Unchanged C1 clamp:** a short final chapter cannot align at the leading edge when preceding content fills the physical scroll maximum. The existing bounds, destination visibility and truthful first-visible Chapter 2 assertions remain; no trailing blank-space policy is introduced.

### Real-book prerequisite recovery

No exact local copies were found. The existing provisioner restored the official manifest-pinned release assets into `/tmp/clio-foliate-books`; both EPUB ZIPs validate and their SHA-256 values match:

| File | SHA-256 |
| --- | --- |
| `gutenberg-11.epub` | `fcbd44d87632d0cd8e9740de1c80d98c2dfb56d222d66865dacfce66e44a3da3` |
| `gutenberg-1342.epub` | `4b2c87ff4bb6ceb1b5fefd406a7e98d068a3a9335fae0395db8cd90d3de830fc` |

The previously blocked two Foliate cases execute real WebKitGTK and pass, including section-5 historical-CFI compatibility in paged/continuous/paged layouts for both books. Missing books were a fixture-environment failure, not a reader defect or permission to skip.

### Installed before/after placement evidence

| Actual-App WebKitGTK state | First painted passage | Addressed Chapter 2 heading | ScrollTop / maximum | Current and completed saved CFI |
| --- | --- | --- | --- | --- |
| Original 420×676 Continuous return, both variants | Chapter 1 passage 23, y=−2.33 | Outside viewport; frame y=1900.47 | 2671 / 8466 | Both incorrectly remain `epubcfi(/6/6!/4,/2,/14[p5]/1:81)` |
| Corrected 420×676 Continuous return, both variants, second cycle | Chapter 2 opening, y=3.44 | Painted; frame y=−20 | 4748 / 8780 | Both truthfully equal `epubcfi(/6/6!/4,/2,/14[p5]/1:81)` |
| Corrected 1000px Paged return, shared-spread control | Chapter 1 passage 39 | Still painted in following column | Horizontal paginated spread | Both truthfully equal `epubcfi(/6/2!/4/82[p39],/1:56,/1:166)`; no forced Chapter 2 label |

The same CFI can be truthful after correction and false before it: painted geometry establishes the distinction. `focused-status-installed.log` and `installed-placement.json` preserve the real installed-patch results, not just the preceding disposable transform experiment. Both full status variants pass, with 200 reversal/mode observations and all 36 controlled Chapter 48 TOC/link/fragment destinations each. Original assertions first passed unchanged after the sizing correction (`corrected-original-status.log`).

The expanded mode observer also proved the separate shared-spread drift before its correction (`matrix-target-status.log`), and the restoration-only save-oracle error (`timeline-anchor-fix-restoration.json`). A sparse-patch destination offset initially removed an adjacent `try` under Bun's installer; the parse/build failures are retained. Correcting that hunk's destination restores the unchanged guard, and the installed package passes the complete focused status matrix.

### Automated verification

All commands use the repository checkout and a live WebKitGTK display; full/focused Foliate runs supply `CLIO_FOLIATE_REAL_BOOKS=/tmp/clio-foliate-books` and scale/DPI scale 1.

| Gate | Actual result |
| --- | --- |
| Unchanged original status assertions before correction | 0 passed, 2 failed; same retained mode-reversal failure |
| Recovered real-book Foliate cases before implementation | 2 passed, 0 failed |
| Original status assertions after sizing correction, before test expansion | 2 passed, 0 failed |
| Installed final expanded status matrix, both variants | 2 passed, 0 failed; 6 expectations; 309.25s |
| Retained Foliate/preferences/keyboard-lifecycle/palette/PDF-navigation focused suites | 50 passed, 0 failed; 1,132 expectations |
| Complete `CLIO_FOLIATE_REAL_BOOKS=/tmp/clio-foliate-books GDK_SCALE=1 GDK_DPI_SCALE=1 bun test` | **1,274 passed, 0 failed, 0 skipped**; 8,587 expectations, 26 files, 610.14s |
| `bunx tsc --noEmit` | Exit 0 |
| `bun run build` | Exit 0 |
| `cargo test --manifest-path src-tauri/Cargo.toml`, task-owned Cargo target | 24 passed, 0 failed/ignored; binary/doc targets also complete |
| Final fresh `bunx tauri build --debug --no-bundle`, task-owned Cargo target | Exit 0 |

The complete gate executes the recovered two-book compatibility cases, both status variants, selection/focus, S4C routing, keyboard/listener lifecycle, acquisition, security, S1 controlled Chapter 48 destinations and S2 reversals. The original preference/reflow assertion remains enabled and passes; its earlier intermittent failure did not reproduce in this run. Default-product-name, chunk-size, software-renderer and accessibility-bus warnings remain recorded, not suppressed or counted as test skips.

Fresh native executable SHA-256: `e009c0dcb264f43821eeef30bdfa9cd09a75a51c111f660707edd4a55d7dc7d6`. The evidence directory retains each original failure, correction experiment, installed-patch run, command gate and native startup/input-calibration failure separately.

### Final native Tauri/XTEST verification

The fresh candidate above completed on task-owned headless Sway/pixman/Xwayland `:2`, output scale 1, GTK 3.24.52 / WebKitGTK 2.54.2, `GDK_BACKEND=x11`, scale/DPI scale 1, and isolated XDG/DBus/AT-SPI state. Actual client sizes: **420×700, 1000×700, 1440×700**. These are measured native client sizes, not an independently queried native CSS DPR.

Trusted X11/XTEST keyboard, pointer and wheel input exercised both initial modes and two round trips each: **24 mode transitions**, **24 Caps-off/on next/Shift+previous transitions**, **6 close/reopens**, **6 publication selection/Ctrl+C and content-focused colon/Escape controls**, and continuous wheel crossings at all three widths. All **81 recorded states** complete; all six clipboard strings match the complete fixture paragraph, not merely a prefix.

| Native observation | Painted evidence and actual durable record |
| --- | --- |
| 420px Continuous second return | Chapter 2 heading bounds `[629,151,341,49]` in client `[590,150,420,700]`; footer Chapter 2; tagged saved CFI `epubcfi(/6/6!/4,/2,/14[p5]/1:81)` |
| 1000px Continuous second return | Chapter 2 heading `[440,151,720,49]` in client `[300,150,1000,700]`; saved `epubcfi(/6/6!/4,/2,/22[p9]/1:165)` |
| 1440px Paged second return | Chapter 1 passages 38–39 paint in the first column; Chapter 2 heading remains painted at `[838,219,608,49]`; footer correctly shows Chapter 1 / Page 4 of 4; actual save is `epubcfi(/6/2!/4,/80[p38],/82[p39]/1:166)` |
| Native natural continuous crossing at 420px | Five wheel-up notches reach Chapter 1 passage 36, saved `epubcfi(/6/2!/4,/76[p36]/1:126,/82[p39]/1:166)`; five down return to Chapter 2 opening, saved `epubcfi(/6/6!/4,/2,/14[p5]/1:42)`, without forced section-boundary snapping |

`accepted-native.json`, `native-summary.json`, `native-accepted.log`, per-action `accepted-*.png`, and `native-accepted/data/com.tod.tauri-app/reading-positions.json` retain final native observations. Renderer internals remain confined to disposable real-WebKitGTK instrumentation; no production diagnostic hook or publication script was installed.

Earlier desktop/offscreen native attempts stopped on acquisition, wrong-window/footer-hit targeting or keyboard delivery before the mode scenario. They are not before/after reader passes. Native acceptance uses calibrated actual client coordinates on the isolated display. One intermediate completed narrow run stopped while enumerating a retired accessibility object during reopening; the final probe waits for fresh live paint/storage samples and records those transient AT-SPI errors. It does not retry reader navigation or suppress failed passage assertions. The native before-correction evidence remains the earlier C1 campaign; the exact two C1.1 before-failure traces are actual-App WebKitGTK, not a newly matched native-before run.

### Scope, preservation and limitations

Task-owned changes:

- `patches/foliate-js-clio.patch`: continuous cross-axis measurement order and shared-spread anchor ownership only.
- `tests/fixtures/reader-status-runtime.tsx`: settled transition observations, repeated geometry/direction/short/long/reopen coverage and the two demonstrated new-oracle corrections. Existing S1/S2/C1/S4C controls remain.
- `tests/reader-status-runtime.test.ts`, `tests/fixtures/run-palette-webkit.py`: explicit bounded timeout for this enlarged status matrix; other runner callers retain the existing default.
- `public/licenses/foliate-js.txt`: updated local patch-scope description; license terms unchanged.
- `docs/foliate-integration-acceptance.md`: this classification and evidence.

Seven other S4C files retain their entry hashes. The entire status fixture `run()` tail, including S4C Shift+J, is byte-identical to entry; the prior C1 acceptance text is retained as an exact prefix. `report.txt` retains its entry state. No files were staged or committed.

The original Chapter 48 publication remains unavailable and **unverified**; the controlled Chapter 48 tests pass. Human physical input, IME, native Wayland, other platforms and assistive-technology certification remain unverified. This task does not close the broader documented EPUB focus/hyperlink limitations or claim that short final sections can align beyond their physical scroll limit.

Proposed separate commit: `fix(epub): preserve passage anchors across mode round trips`. No commit or push is authorized or performed.

Task-owned native applications, registries, buses and compositor are stopped. Disposable instrumentation scripts/configuration are removed; original evidence, final screenshots/JSON/logs, fixture publications, verified real books and the fresh native executable are retained.
