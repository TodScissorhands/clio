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
