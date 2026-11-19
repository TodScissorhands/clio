# Progressive PDF opening

PDF preparation now awaits PDF.js document metadata (`numPages`) rather than resolving every page before reader commit. Each prepared document owns a sparse, one-based page-geometry table. The reader ensures exact geometry for the initial restored page, then begins sequential background discovery only after the active page has a nonempty text layer and a nonzero main canvas. Explicit navigation, search targets, fit/layout commands, and resize into a spread ensure the target page/group before applying the transition. A cancelled owner stops starting new work; an in-flight `getPage()` is cleaned up but cannot publish into a retired document.

Page count and navigation bounds continue to come from `PDFDocumentProxy.numPages`. Unknown dimensions remain `undefined`; fit calculation returns the existing neutral scale of `1` when its required page/group dimensions are not available. PDF.js remains the sole renderer. No position format or S3B lifecycle contract changed.

## Evidence

Generated 5-, 100-, and 1,000-page PDFs use printed page labels and alternating portrait, landscape, and nonuniform MediaBoxes. Actual App, PdfReader, PDF.js and WebKitGTK were used at a 1000×700 offscreen viewport. The disposable test bundle counted per-document geometry reads at reader commit and required both nonzero canvas and expected text-layer label for readability.

| Fixture / transition | Before (single WebKit sample) | Progressive (focused WebKit sample) |
| --- | ---: | ---: |
| 5 pages, page 1 readable | 192 ms; full scan gated commit | 189–195 ms in two runs; 1 geometry read at commit |
| 100 pages, page 1 readable | 148 ms; full scan gated commit | 124–139 ms in several runs; 1 geometry read at commit |
| 1,000 pages, page 1 readable | 316 ms; full scan gated commit | 83–200 ms across several runs; 1 geometry read at commit |
| 1,000 pages, restore page 995 | Not measured before | 182–191 ms to page-995 canvas/text; 1 geometry read at commit; MediaBox-derived size 440×650 pt |
| 1,000-page background discovery | Not measured before | 66–184 ms in several runs; sequential scan completed |

Initial page 1 was measured as 440×680 pt. The fixture includes other dimensions/orientations and the focused layout tests verify sparse fit-page/fit-width/fit-spread behavior without invented dimensions. Peak RSS was 734,300 KiB for the complete WebKit process that sequentially opened all fixtures and restored page 995; it is not a per-document or before/after comparison.


Native confirmation used a fresh debug/no-bundle Tauri binary, isolated XDG directories, Cage headless/pixman with Xwayland `DISPLAY=:2`, WebKitGTK 2.54.2, 1280×720, and trusted `xdotool` XTEST input. The 1,000-page mixed-size PDF opened through the native chooser. X11 screenshots visibly showed `Benchmark page 1` / `Page 1 / 1000`, and later `Benchmark page 995` / `Page 995 / 1000`. After native page-995 navigation and graceful close, the actual file contained `{"/tmp/clio-s4a-native/fixtures/progressive-1000.pdf":{"page":995,"offset":0.0}}`. Reopening restored and visibly painted page 995.

Five same-process native close/reopen samples measured chooser selection to the AT-SPI `Page 995` landmark: 733.6, 712.2, 688.5, 716.4, and 716.3 ms (median 716.3 ms, range 688.5–733.6 ms). The initial page-1 native reopen was one 725.6 ms sample. The landmark plus same-run screenshot confirms the passage was painted, but the landmark itself is not a canvas/text-layer event timing.

These timings are exploratory, not comparative performance acceptance: the before measurements are single WebKit samples; the after WebKit runs vary substantially; and no native baseline candidate was measured. No baseline memory sample exists. Do not claim the required repeatable improvement from these measurements.
Focused actual-reader WebKitGTK tests exercise metadata-first commit, initial page readability, late-page restoration, sparse geometry, background completion, and retirement of an in-flight geometry read during replacement. PDF layout/navigation, reader position, viewer lifecycle, recoloring/detail rendering, and status tests are separate gates. Native X11/XTEST confirms one initial page and five warm late-page restores with persisted JSON. Native Wayland, human physical input, Windows, macOS, an isolated native cold-start comparison, per-document memory comparison, and five-sample native before/after performance acceptance remain unverified.

## S4A.1 acceptance measurements

The following supersedes the exploratory performance limitation above for the native text/footer landmark, not for unobservable baseline internal phases. No production implementation was changed during S4A.1. Temporary benchmark transforms were removed byte-for-byte after collection.

### Provenance and recovered capacity

- Checkout: `master`, HEAD `5d58e66cf08a5a987b8df4c61ebcc77060778622`, existing dirty S2/S3A/S3B/S4A checkout, no staged changes at entry, one worktree. No commit, push, merge, reset, rebase or new worktree.
- Pre-S4A S3B executable: `/home/tod/.cache/clio-s3b-native/target/debug/tauri-app`, SHA-256 `c8e9819166bf8c7f2de64980d94a543b867bd628c8221e13cbb20fbefae4c851`.
- Fresh final-source executable: `/home/tod/.cache/clio-s4a1-acceptance/final-tauri-app`, SHA-256 `5b891f143ef9f4361b2cfcb4c9de7b6f38db0ba96f101f676cbeb7a99b534390`. Built successfully with `CARGO_TARGET_DIR=/home/tod/Projects/clio/src-tauri/target CARGO_INCREMENTAL=0 bun run tauri build --debug --no-bundle`; includes the frontend TypeScript/build step. Core source hashes and build output are in the evidence directory.
- The earlier S4A executable was copied to `/tmp/clio-s4a-native/evidence/s4a-intermediate-tauri-app` and its existing SHA-256 `9240f58dfd2ae39018a102389738211209a9706e6cdfdbc1d5f015a6ed4b7bdc` verified. It was not used for final acceptance.
- `/tmp` had free blocks and abundant inodes, but is a 7.5 GiB tmpfs with `usrquota`; the prior build reported `EDQUOT`. Although the quota utility is unavailable, a read-only `quotactl_fd(Q_GETQUOTA, USRQUOTA, uid=1000)` query succeeded: both soft and hard limits are 6,261,222 KiB (5.97 GiB), with no inode limit. This establishes the per-user quota constraint, rather than filesystem/inode exhaustion; exact usage at the failed build was not recorded. Cargo clean targeted only `/tmp/clio-s4a-native/target`, reporting 4,413 files / 5.1 GiB logical outputs removed. Allocated `/tmp` usage fell from 5.4 to 1.8 GiB, reclaiming approximately 3.6 GiB; filesystem available space rose from 2.1 to 5.8 GiB. The later quota query recorded 1.83 GiB charged to this user, leaving approximately 4.14 GiB of quota headroom. Existing fixtures, application data, logs and screenshots were preserved. Final build used `/home`, with 339 GiB free afterward.

Evidence archive: `/home/tod/.cache/clio-s4a1-acceptance/`. Complete raw measurements: `matched/evidence/samples.jsonl`; each sample also has a detailed JSON record with monotonic timestamps, accessible text, actual persisted records, process-tree memory samples and a same-run PNG. `matched/evidence/measurements.md` includes ranges, sample standard deviations and paired-round deltas. Disposable measurement scripts and source-transform snapshot are archived under `evidence/` for provenance.

Fixtures are the exact existing `/tmp/clio-s4a-native/fixtures/progressive-{5,100,1000}.pdf` bytes:

| Pages | SHA-256 |
| --- | --- |
| 5 | `36ec078d268aa82602895d3753cf48b1bb9cbf4a664889986b7d6b3076eef57a` |
| 100 | `65c62c3021d0ce936c777d6cb09fdf8a374f01c2454d9de81b4f406e9be5a377` |
| 1,000 | `ca9e212eeccf0ab0f04b8fcb224f0cd74e7c5698fe0e7df27946ebc3f7d13c58` |

### Matched native results

Same hardware (Ryzen 5 5600U), WebKitGTK 2.54.2 / GTK 3.24.52, Cage 0.3.1 headless/pixman / Xwayland 24.1.15 `:2`, 1280×720, `GDK_SCALE=1`, `GDK_DPI_SCALE=1`, default isolated configuration, exact shared fixtures and trusted XTEST chooser input. Five rounds alternate candidate order. Each round uses a fresh process followed by same-process close/reopen. “Cold” means fresh process/cache directory, not evicted kernel page cache; no OS-cache-cold claim. Page-995 records were seeded identically, then retained through actual close/reopen.

Timing starts immediately before XTEST activation of the chooser Open button and ends when AT-SPI exposes both expected page text and footer. Every sample has a screenshot. This is a user-visible landmark with input/accessibility polling overhead, not an exact canvas-paint timestamp. All 80 samples completed; no measured sample was dropped. Preliminary controller calibration failures (retired AT-SPI objects and premature close polling) were excluded before the complete dataset began.

| Workload | State | Candidate | Raw milliseconds, round order | Median ms | Range ms |
| --- | --- | --- | --- | ---: | --- |
| 5 / page 1 | Cold | S3B | 495.7, 492.7, 494.4, 497.6, 521.0 | 495.7 | 492.7–521.0 |
| 5 / page 1 | Cold | S4A | 482.6, 495.3, 512.9, 530.8, 499.1 | 499.1 | 482.6–530.8 |
| 5 / page 1 | Warm | S3B | 406.5, 396.8, 430.8, 399.9, 400.2 | 400.2 | 396.8–430.8 |
| 5 / page 1 | Warm | S4A | 382.9, 405.6, 400.8, 399.1, 404.9 | 400.8 | 382.9–405.6 |
| 100 / page 1 | Cold | S3B | 530.3, 533.5, 530.5, 566.8, 536.5 | 533.5 | 530.3–566.8 |
| 100 / page 1 | Cold | S4A | 500.1, 527.8, 512.5, 532.4, 520.5 | 520.5 | 500.1–532.4 |
| 100 / page 1 | Warm | S3B | 428.4, 415.7, 434.8, 445.9, 441.4 | 434.8 | 415.7–445.9 |
| 100 / page 1 | Warm | S4A | 420.7, 422.4, 414.1, 436.4, 428.0 | 422.4 | 414.1–436.4 |
| 1,000 / page 1 | Cold | S3B | 730.1, 766.4, 755.6, 743.7, 784.6 | 755.6 | 730.1–784.6 |
| 1,000 / page 1 | Cold | S4A | 620.8, 643.8, 608.7, 645.5, 645.4 | 643.8 | 608.7–645.5 |
| 1,000 / page 1 | Warm | S3B | 629.4, 662.3, 645.2, 629.8, 654.8 | 645.2 | 629.4–662.3 |
| 1,000 / page 1 | Warm | S4A | 495.0, 508.2, 503.8, 497.3, 501.5 | 501.5 | 495.0–508.2 |
| 1,000 / page 995 | Cold | S3B | 749.4, 769.1, 743.1, 789.2, 775.0 | 769.1 | 743.1–789.2 |
| 1,000 / page 995 | Cold | S4A | 606.0, 644.7, 603.5, 603.0, 639.6 | 606.0 | 603.0–644.7 |
| 1,000 / page 995 | Warm | S3B | 626.9, 663.0, 648.0, 632.9, 662.3 | 648.0 | 626.9–663.0 |
| 1,000 / page 995 | Warm | S4A | 499.0, 501.5, 542.0, 517.9, 506.0 | 506.0 | 499.0–542.0 |

Large-document ranges do not overlap. Every paired large-document sample improved; median paired improvements exceed the corresponding baseline ranges. The slowest S4A large sample was 645.5 ms cold page 1 and 542.0 ms warm page 995, still faster than every baseline sample in those groups. Five-page medians changed by less than 1%; 100-page medians improved. This demonstrates repeatable improvement for the measured text/footer endpoint, without a material small-document regression in these samples.

### Final-source phase observation

A disposable Vite transform observed the actual App/PdfReader/PDF.js in offscreen WebKitGTK at 1000×700. This is separate from the unmodified native binary measurements, not a native internal-phase comparison. Timestamps below are elapsed from request before fetch; raw `performance.now()` values and request ownership are in `evidence/timeline.json`. Readability requires nonzero canvas and expected text-layer content, polled every 20 ms; it can be observed after background discovery has already finished for small documents.

| Pages / destination | Bytes ready ms | Metadata ready ms | Reader commit ms | Readable canvas/text ms | Geometry complete ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| 5 / page 1 | 15 | 104 | 106 | 203 | 203 |
| 100 / page 1 | 1 | 68 | 69 | 130 | 124 |
| 1,000 / page 1 | 3 | 88 | 89 | 199 | 260 |
| 1,000 / page 995 | 2 | 86 | 88 | 213 | 266 |

Each commit had exactly one geometry read. The actual-reader test verified exact initial dimensions (page 1: 440×680 pt; page 995: 440×650 pt), background completion, and retirement of an intentionally held in-flight old-document read without publishing into the replacement. The saved S3B binary exposes no internal phase instrumentation: baseline acquisition/parsing, metadata, commit and geometry-completion phase comparisons remain **UNVERIFIED**, not estimated.

### Native lifecycle and memory limits

The fresh executable painted page 1, navigated to page 995, gracefully closed, retained `{page:995,offset:0}`, and reopened the visibly correct passage/footer. Replacement with the 5-page PDF, navigation to page 3, replacement back to the 1,000-page PDF, and reopening the small PDF retained separate canonical-path records for pages 995 and 3. A further settled screenshot still showed page 3. All 20 benchmark page-995 storage snapshots retained the seeded page/offset. See `evidence/native-lifecycle.json` and same-prefix screenshots.

Memory uses identical opening-window summed RSS of the app and live descendants, excluding Cage/Xwayland. Sampling requested a 20 ms delay; actual cold-sample intervals were 32.6–48.0 ms (median 36.1 ms), including `/proc` enumeration overhead. Shared pages can be double-counted; process startup, post-readability background peaks and total physical-memory impact are not established. Median opening-window RSS for 1,000-page page 1 was 611.1→623.1 MiB cold and 639.5→631.9 MiB warm; page 995 was 614.4→625.1 MiB cold and 645.6→643.0 MiB warm. These are comparable observations, not proof of unchanged full-lifetime peak memory. Full memory-impact acceptance remains **UNVERIFIED**.

Native physical-human input, native Wayland, Windows and macOS remain unverified. No EPUB rendering, PDF navigation implementation, storage schema, dependencies or permissions were changed in S4A.1.

### Verification repeated for S4A.1

- Focused command: `DISPLAY=:2 GDK_SCALE=1 GDK_DPI_SCALE=1 bun test tests/pdf-progressive-opening-runtime.test.ts tests/pdf-navigation.test.ts tests/pdf-reading-position-runtime.test.ts tests/pdf-open-lifecycle.test.ts tests/pdf-pristine-lifecycle-runtime.test.ts tests/pdf-detail-rendering-runtime.test.ts tests/pdf-cooperative-rendering-runtime.test.ts tests/reader-status-runtime.test.ts`: **55 passed, 0 failed**, 1,129 expectations, eight files. Both reader-status runs passed, including the previously intermittent EPUB reflow path; this does not establish that its intermittent risk is fixed.
- `bunx tsc --noEmit`: **PASS**.
- `bun run build`: **PASS**.
- `cargo test --manifest-path src-tauri/Cargo.toml`: **24 passed, 0 failed, 0 ignored**.
- Fresh `bun run tauri build --debug --no-bundle` with the target/incremental environment above: **PASS**.
- Complete required Bun gate: `DISPLAY=:2 CLIO_FOLIATE_REAL_BOOKS=/tmp/clio-foliate-books GDK_SCALE=1 GDK_DPI_SCALE=1 bun test`: **1,261 passed, 0 failed**, 8,541 expectations, 26 files, 330.01 seconds. Required real-book fixtures were present; native WebKitGTK suites executed, with no skipped suites reported. EPUB status/reflow cases passed in this run; the prior intermittent failure remains a separate risk, not a change made here.

S4A.1's only lasting repository edit is this acceptance record. The progressive runtime test was restored byte-for-byte against its pre-instrumentation copy before the focused gate. Existing S2/S3A/S3B/S4A changes remain unstaged and separate from this validation-only scope; `report.txt` was absent at entry and was not created or modified. Suggested eventual S4A commit remains `perf(pdf): initialize visible pages progressively`; no commit authorized or created.

### Acceptance decision

| Criterion | Result | Evidence / limit |
| --- | --- | --- |
| Repeatable large-document opening improvement | PASS | All paired native page-1 and page-995 samples improved beyond baseline variability; text/footer endpoint plus same-run screenshots, not exact paint-instant timing |
| No material small-document regression | PASS | Five-page median changes below 1%; 100-page medians improved in this controlled workload |
| Exact geometry and restored passage | PASS | Actual-reader geometry assertions, native painted page 995/footer and retained canonical-path record |
| Bounded background work / safe retirement | PASS | One geometry read at commit; full discovery completes; held retired read cannot publish into replacement |
| Comparable memory observations or explicit limitation | PASS | Same-method opening-window RSS retained; full-lifetime memory impact remains UNVERIFIED |
| Final-source native execution | PASS | Fresh executable/hash, XTEST open/navigation/save/reopen/replacement and screenshots |
| Required build/test gates | PASS | Focused and complete Bun, TypeScript, frontend, Rust, fresh Tauri debug/no-bundle build |
| Baseline internal phases / exact native paint instant | UNVERIFIED | Saved baseline has no internal instrumentation; no estimated phase baseline |

Performance acceptance is demonstrated for the specified generated mixed-geometry workloads and the documented native visible-text/footer endpoint. This is not a claim about image-heavy/complex PDFs, true OS-cache-cold opening, full-lifetime physical memory, or other platforms. No production tuning was needed in S4A.1.
