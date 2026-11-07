# Task 09C2 — EPUB reading status and shared document identity

## Result

Implemented a compact external EPUB status footer and shared PDF/EPUB document identity. The native title is `Selected Filename — Clio`, or `Clio` when closed. Failed same-format and cross-format replacements retain the previous document and title. Task 09C2 is complete; the known EPUB focus and internal-hyperlink limitations are not fixed or hidden.

## Baseline and exact file changes

Entry HEAD: `0e81fff5b0ba8501cd1e3cca0c73ff553bff7e28`, `master...origin/master`. Entry worktree contained modified `README.md` and untracked `docs/epub-keyboard-focus.md` / `report.txt`.

Task-owned production changes:

- `src/epub/readingStatus.ts` — indexed navigation labels, defensive location interpretation and weak live-Document anchor caches.
- `src/epub/EpubReader.tsx` — current-rendition status, reflow invalidation and accessible footer.
- `src/epub/EpubReader.css` — reserved footer space and narrow presentation.
- `src/reader/ReaderStatus.css` — shared existing 24px status styling extracted without changing PDF values.
- `src/reader/Reader.css` — removes the extracted shared declarations; PDF-specific input/preset/feedback styling remains.
- `src/App.tsx` — committed filename identity, acquisition generations and prepare-before-cutover for EPUB → PDF.
- `src/pdf/engine.ts` — shared PDF preparation and request envelope; no second parse or new rendering algorithm.
- `src/reader/PdfReader.tsx` — prepared-task handoff, acquisition cancellation and committed-document identity notifications.
- `src/reader/useDocumentTitle.ts` — plain-text browser title and serialized native title writes.
- `src-tauri/capabilities/default.json` — adds only `core:window:allow-set-title` to the existing main-window capability.
- `src-tauri/tauri.conf.json` — native startup title `Clio`.

Task-owned tests/evidence documentation:

- `tests/epub-reading-status.test.ts`
- `tests/document-title.test.ts`
- `tests/reader-status-runtime.test.ts`
- `tests/fixtures/create-reader-status-documents.py`
- `tests/fixtures/reader-status-runtime.html`
- `tests/fixtures/reader-status-runtime.tsx`
- `docs/epub-reading-status.md`

No dependency, lockfile, epub.js patch, publication sandbox, keyboard router, PDF navigation/recolor algorithm or existing test file was changed.

## EPUB location model and limits

The footer describes the **first visible location** supplied by the active rendition, not a requested chapter target or a saved page number.

- Paged mode uses validated `start.displayed.page` / `total`, explicitly labeled **in section**. These values are local to the first visible spine file and depend on reflow. A spread can show more than one page; the displayed number is its first visible page.
- Continuous mode shows chapter/section identity only. epub.js's continuous `displayed` values count viewport-sized slices and are not presented as publication pages.
- No whole-book count, generated locations index, percentage, print-page interpretation or second position store is added.
- Valid current-book CFI, numeric spine index and resolvable href identify a section. Conflicting valid identities discard the location rather than mix labels/counts. Missing/unusable values yield section metadata or neutral `EPUB`, never fabricated numbers.
- Navigation is traversed once per Book effect. The existing palette keeps its depth-first destinations, depths and fallback naming; generated palette `Chapter N` names do not become status chapter numbers.
- Real same-file fragment labels are resolved using live Contents, element CFIs and CFI ordering. Equal-boundary aliases prefer deeper navigation entries, then the first entry. A missing fragment is not treated as section start.
- Structural parent labels are retained. Ordered, unambiguous top-level ranges can describe a multi-file chapter gap as `Parent label · Section N`; direct applicable labels win. Duplicate/reversed/unresolved group starts disable cross-file guessing. Non-linear files do not inherit a range. No TOC falls back to the actual one-based spine ordinal labeled **Section**.
- Live anchor caches use WeakMap Document keys and string/display metadata values, not strong references to removed frames/Contents/DOM nodes.

`relocated` drives ordinary updates. Initial presentation and successful reflows obtain a fresh synchronous `currentLocation()` snapshot after the existing layout boundary. A missing/throwing/thenable result provides metadata without counts until a valid relocation. Old numeric counts are removed immediately on a changed viewport or actual layout switch, before the existing resize debounce. Pending/failed reflow cannot republish old numbers. This does not alter epub.js display/check settlement or canonical-CFI persistence.

## Status layout and accessibility

The publication viewport reserves 24px at the bottom, matching PDF. The footer is outside its iframe and does not cover text or the scroll container.

- Normal paged presentation: `Chapter One · Page 1 / 10 in section`.
- At widths up to 600 CSS px: chapter/section label only; counts and separator are hidden.
- Long labels remain single-line with ellipsis only when necessary, a full-label title, and a full accessible description.
- Shared black background, existing muted colors, 11px tabular typography and padding are reused. No publication typography/theme changes.
- Accessible name: `EPUB reading status`; `aria-live="off"`, no implicit live status role and no new focus target. A single hidden description supplies complete text; visible duplicates are hidden from the accessibility tree.
- Palette opening hides the footer without returning its reserved space to publication layout. Palette focus, containment and Escape restoration remain intact.

Real rendered text contrast measured 4.63697:1 in light application appearance and 7.37094:1 in dark appearance. Screen-reader certification is not claimed.

## Document identity and resource ownership

The selected filename, including extension, is used consistently for PDF and EPUB. No filesystem path is displayed. Unicode, quotes, ampersands and markup-looking text remain literal strings; whitespace-only names have a format-specific untitled fallback. Publication metadata is never inserted as executable markup.

App owns the committed name. EPUB activation and the current PDF success branch commit it; close clears it. Loading, failure and unmount cleanup do not reset the current title. One native writer serializes asynchronous setters, skips queued superseded revisions and allows the latest title to run last; setter failure is reported without poisoning subsequent writes.

The installed Tauri API requires `core:window:allow-set-title`. This is the only added permission, within the existing `windows: ["main"]` capability. A newly built native instance verified real title properties, including `Résumé & <Notes> “一”.epub — Clio` and closed `Clio`.

EPUB → PDF now prepares the actual PDF before removing the EPUB. The prepared task, document and page sizes are transferred once to PdfReader; it does not parse the same bytes twice. Unclaimed candidates are destroyed on cancellation/error. PdfReader retains its committed task while loading a replacement and releases only obsolete candidates. Successful PDF close/unmount retains its existing ownership responsibilities.

A bounded addition to the planned envelope was necessary: `PdfReaderOpenRequest.generation` and mandatory `PdfReader.openGeneration`. A newly selected file can supersede an in-flight PDF **before its bytes finish reading**, without delivering another PDF envelope. Sharing the acquisition epoch lets PdfReader reject/cancel that obsolete preparation while retaining the committed document. Native picker/read and browser File reads allocate the generation before asynchronous acquisition; late error/focus callbacks are also guarded.

## Automated verification

| Command | Observed result |
| --- | --- |
| `GDK_SCALE=1 GDK_DPI_SCALE=1 bun test` | **998 passed, 0 failed**, 5,307 expectations, 20 files; all **seven** real-WebKit suites ran |
| `bunx tsc --noEmit` | Exit 0 |
| `bun run build` | Exit 0; existing large-chunk warning |
| `cargo test --manifest-path src-tauri/Cargo.toml` | **Nine passed**, no failures; binary/doc suites have zero tests |
| `git diff --check` | Exit 0, no output |

The 22 added Bun tests cover location policy boundaries, title write ordering/error recovery and a real App/WebKit integration scenario. The latter covers A–M: opening, actual page turns, continuous scrolling, nested/encoded/duplicate fragment targets, multi-file parent gaps, missing TOCs/location fields, layout/resize freshness, CFI close/reopen, rapid acquisition and replacement, failed replacements across both formats, PDF status/input/recolor-state retention, six geometries/appearances and literal filenames.

Real engine completion gates and genuine delayed File.arrayBuffer reads exercise stale-acquisition precedence. The runtime observed six gated PDF/EPUB candidates, each destroyed once at its appropriate retirement/close boundary. H03B1's existing real-WebKit suite still passes all 13 lifecycle scenarios: production keydown and keyup registrations each 21 added / 21 removed, zero active at teardown, no errors. Existing pristine-canvas and cooperative PDF rendering suites also passed unchanged.

During test integration, test-only transform ordering, settling checks, observer scope across footer remount and a result-field collision were corrected. No production behavior was weakened to make tests pass.

## Native acceptance and screenshots

A task-owned Tauri/WebKitGTK instance used a fresh production-mode frontend bundle and newly built native configuration/capabilities. It ran on X11/Xwayland with isolated XDG directories, port 15420 and an isolated Cargo target directory, not the user's port 1420/session. Test-only host observation exposed state/acquisition seams; no scripts were inserted into publication content. Native input used xdotool/XTEST. Native window titles were read using `xdotool getwindowname`, not inferred from a JavaScript callback.

DPR was 1.25 despite process-local `GDK_SCALE=1 GDK_DPI_SCALE=1`. Native window dimensions and pointer coordinates were scaled and actual CSS dimensions were measured. Explicit native-window/host-reader focus was test setup, not an EPUB focus correction.

| Actual CSS viewport | Light appearance | Dark appearance |
| --- | --- | --- |
| 420 × 600 | EPUB paged/chapter/continuous/closed and PDF page navigation passed | Same checks passed |
| 1000 × 700 | EPUB paged/chapter/continuous/closed and PDF page navigation passed | Same checks passed |
| 1440 × 800 | EPUB paged/chapter/continuous/closed and PDF page navigation passed | Same checks passed |

Across the matrix the footer stayed 24px, outside publication content, without horizontal overflow. Narrow counts were hidden. Native palette chapter/layout commands and native paged/continuous navigation updated the status. PDF retained physical page status (`Page 2 / 3` exercised). Failed EPUB → PDF and PDF → EPUB replacement retained content/title; unusual filename and close title were verified. An actual persisted native CFI reopened at the same first-visible passage: `epubcfi(/6/2!/4/52[text-20]/1:0)`.

There are **54 genuine native screenshots**: 18 unique baseline and 36 after screenshots. Representative evidence:

| Scenario | Native image |
| --- | --- |
| Before, EPUB paged | [1000×700 light baseline](/tmp/clio-09C2-evidence/before-1000x700-light-paged.png) |
| After, EPUB paged | [1000×700 paged](/tmp/clio-09C2-evidence/after-1000x700-light-paged.png) |
| EPUB continuous | [1000×700 dark continuous](/tmp/clio-09C2-evidence/after-1000x700-dark-continuous.png) |
| Chapter transition | [1000×700 chapter transition](/tmp/clio-09C2-evidence/after-1000x700-light-chapter-transition.png) |
| Narrow reader | [420×600 EPUB](/tmp/clio-09C2-evidence/after-420x600-light-paged.png) |
| Literal document title | [Corresponding EPUB surface](/tmp/clio-09C2-evidence/after-smoke-unusual-title.png), with genuine native title in the manifest |
| Closed document | [Closed reader](/tmp/clio-09C2-evidence/after-smoke-closed.png) |
| Failed replacement | [Invalid PDF retaining EPUB](/tmp/clio-09C2-evidence/after-smoke-invalid-pdf-retains-epub.png) |
| PDF status | [420×600 PDF page 2](/tmp/clio-09C2-evidence/after-420x600-light-pdf.png) |

The compositor did not paint a native title bar in these captures. The screenshot manifest records the real native title alongside each corresponding screenshot; no title bar was synthesized.

Inert screenshots and JSON evidence remain at `/tmp/clio-09C2-evidence/`. The complete local evidence archive is `/tmp/clio-09C2-evidence.tar.gz`, including archived disposable harness sources and fixture inputs. Local temporary evidence is not a tracked application dependency. Physical touchpad/keyboard, IME and screen-reader acceptance are not claimed by XTEST automation.

## Preserved limitations and files

- `allowScriptedContent` remains false and the iframe sandbox remains `allow-same-origin`, with no `allow-scripts`. No GTK keyboard hooks, overlays, touchpad implementation or new command router.
- Native clicking ordinary publication text still produces IFRAME/BODY focus. Native colon/PageDown then fail to reach Clio commands; the CFI remains unchanged. This is the documented 09C1 limitation, not a new regression or a resolved issue.
- Native selected text still copies. The test paragraph was retrieved from the X11 clipboard without a focus workaround.
- The fixture's native internal hyperlink still receives anchor focus without reaching its distinct destination. No hyperlink correction or destination-alignment redesign is included.
- `report.txt`, `README.md` and `docs/epub-keyboard-focus.md` match their planning/entry SHA-256 values byte-for-byte. 09C1 documentation is preserved.
- No stage, commit, push, reset or rebase. Task-owned native/frontend processes were stopped; temporary instrumented runtime/build workspaces were removed after evidence preservation.
- The user's Vite process and original Tauri dev runner were not targeted by task commands. At final inspection that runner had a replacement native child (entry PID 121449, later PID 140246 under the same runner). A normal watched-configuration restart is the likely explanation [INFERENCE]; its cause was not independently traced. No task-issued termination signal targeted that session. The original dev runner (121314/121315) and Vite process (121370) remained running. Task acceptance never used that session.

Stop: Task 09C2 only. No subsequent implementation task started.

## CI-01 — Ubuntu preference reading-start visibility

The [published verification run](https://github.com/TodScissorhands/clio/actions/runs/42236845475) failed before typography changes with `pre-reflow reading start is not visible`. An isolated Ubuntu 24.04.5 / Xvfb reproduction using Bun 1.3.14 and the committed frozen lockfile reproduced that assertion. Both Ubuntu and the Arch control used WebKitGTK 2.52.6; no renderer-version defect or production CFI corruption was established.

The requested passage was `epubcfi(/6/2!/4/76[p20])`. Ubuntu's paginated spread legitimately began earlier, at `epubcfi(/6/2!/4/68[p16]/3:0)`, offset zero in the text node `" and "`. Its leading space had a zero-width rectangle; the following `a` occupied a visible 12×24px rectangle. The iframe was at x=-3000px, the character at child x=3041px, so the visible host position was (41,23). The paragraph's union rectangle spanned columns and was not a valid substitute for that character measurement.

Ubuntu's host viewport was 1000×700 CSS px at DPR 1; the publication viewport was 1000×676, with 418px columns, an 82px gap and 500px pages. The Arch control instead had an 800×560 host viewport at DPR 1.25, Noto Serif rather than Ubuntu's DejaVu Serif, and a directly painted `S` at its captured p20 boundary. These observed layout differences explain why an Arch pass did not exercise the collapsed-whitespace case.

The failing Ubuntu CFI and character rectangles remained identical after additional frames and queue drainage. Fonts were loaded, layout was neither pending nor failed, navigation count was zero, and no resize/restoration was pending. Increasing a timeout would not address the failure.

The correction is confined to the preference fixture's visibility probe and its native controls: a text CFI is a DOM boundary, not necessarily a painted character. The probe measures the next non-whitespace character within that same text node, still requiring a positive-size fragment intersecting the reader viewport. It neither rewrites the CFI nor borrows a visible paragraph/neighboring node. A whitespace-only suffix does not count as visible reading text.

The native regression also forces a whitespace-prefixed boundary on otherwise passing fonts and verifies that offscreen passages, removed reading-start text and `display:none` text fail the probe. Test-owned text/style mutations are restored synchronously before applying preferences. The original requested-passage, captured-start, font reflow, rapid preference, canonical-CFI reopen, paged/continuous, Publisher reset and lifecycle assertions remain in place; no deadline, retry or skip policy changes.

After Sans/24px reflow, the same preserved Ubuntu CFI's `a` was visible at (41,168), sized 15×28px. The freshly reported spread start became `epubcfi(/6/2!/4/68[p16]/1:34)`; that does not invalidate preservation of the exact original reading boundary. Focused native preference runs passed with frozen dependencies on both Ubuntu and Arch.

Production EPUB code, the epub.js patch, publication script sandbox, Tauri permissions, dependency manifests and lockfiles are unchanged. The isolated Ubuntu container retained WebKit's native sandbox; container-only namespace/proc permissions were required for bubblewrap. The full GitHub job log required unavailable authenticated access (HTTP 403); public job metadata/annotations and the independently reproduced Ubuntu failure are the available evidence. No new GitHub Actions run or green-CI claim is made.

The complete frozen Ubuntu run executed all nine WebKit suites and finished with 1,284 Bun tests passing and one failure: the separately checkpointed R01 `pdf-detail-rendering-runtime.test.ts` reported `F cache 3: finished output is hidden`. Its GPU failure prevented the CPU branch from starting in that run; a disposable CPU-only selector executed the unchanged CPU assertions separately and encountered the same failure. CI-01 does not change PDF production code or those assertions. Ubuntu TypeScript/frontend build and the nine locked Rust tests on Arch passed. The EPUB correction is verified, but the complete verification baseline is not green; the R01 failure remains outside this correction.
