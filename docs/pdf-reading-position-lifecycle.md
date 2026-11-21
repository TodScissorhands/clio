# PDF reading-position lifecycle

PDF positions retain the existing canonical-path `{page, offset}` records and IPC boundary. Native transaction/recovery guarantees are described in [reading-position-storage.md](reading-position-storage.md). EPUB authorization, PDF rendering and navigation are unchanged by S3B.

## Ownership and ordering

- Active reading keeps the 700 ms debounce. The PDF hook snapshots connected, visible page/viewer geometry synchronously; incomplete, nonfinite and restoration-suppressed positions are not saved.
- Same-path writes follow a hook-owned promise tail. A later logical position cannot invoke storage before an earlier write settles. Different paths remain independent. A rejected write does not permanently block later writes.
- Close document, prepared PDF replacement and prepared PDF→EPUB replacement await a final snapshot before retiring geometry/task ownership. Same-path reopening loads its record **after** flushing the outgoing PDF.
- Explicit retirement has a five-second deadline. Failure/timeout retains the outgoing document and reports an error. IPC is not cancellable: timeout does not remove the queue or allow later writes to overtake the pending write.
- Cleanup cancels timers/frames and retires error ownership; it does not read detached DOM or pretend asynchronous React cleanup is awaited. StrictMode replay neither flushes nor clears pending restoration. Cross-format unmount is coordinated explicitly by App.
- After initial restoration, PDF.js layout/scale/grouping can emit scroll events. The hook refreshes the restoration scroll sentinel after layout anchoring, rather than interpreting that automatic movement as user navigation and overwriting a nonzero saved offset with zero.

## Deterministic WebKitGTK evidence

`tests/pdf-reading-position-runtime.test.ts` builds the actual App, PdfReader, PDF.js and viewer in real WebKitGTK. Only the persistence IPC boundary is replaced with isolated canonical-path records and deferred promises; synthetic fixture interaction is **not** native input evidence.

| Reproduction | Before | After |
| --- | --- | --- |
| Page 2, close within debounce, reopen | No save; reopened page 1 | Stored/reopened page 2 |
| Hold page-1 save, request page 3, release newer before older | Two overlapping calls; final record page 1 | Only one call until released; final record page 3 |
| Restore page 2/0.35, width/continuous/resize reflow | Automatic page 2/0 overwrite | No automatic write; 0.35 retained |
| Deferred A→B replacement | Not asserted as a separate baseline defect | A remains mounted until saved; A=2, B=3 under separate keys |
| Same-path reopen | Not separately established | Latest page 3 restored after flush |
| Scroll offset, immediate close | Debounce-loss mechanism above | Captured page 2/0.199324; page 2 reopened |
| PDF→EPUB | Not separately established | PDF remains mounted until its page-3 save completes |
| Rejected/timed-out final save | Not separately established | Reader retained; later save succeeds without overtaking |
| Unmount/StrictMode | No separate baseline defect claimed | Retired rejection cannot report into remounted reader; B restores page 3 |

The original hook, PdfReader and App were also compiled from HEAD in a disposable baseline bundle for the restoration reproduction. Those overrides were removed; production instrumentation was never installed.

## Native X11 evidence

Evidence: `/home/tod/.cache/clio-s3b-native/evidence/`. Isolated Cage/headless-pixman/Xwayland `:2`, Tauri debug/no-bundle candidate, separate XDG directories, WebKitGTK 2.54.2 and trusted `xdotool` XTEST input. Screenshots and AT-SPI observe painted PDF text/footer; JSON snapshots read the actual app-data file. Binary hashes are recorded in `binary-hashes.txt`.

- Baseline S2 candidate: page 1 was durable before navigation. Page 2→immediate Ctrl+W kept page 1 in JSON; reopening painted `Status PDF page 1` / `Page 1 / 3`.
- S3B candidate: the same sequence stored `{page:2,offset:0}` and reopened painted page 2. PDF A→B retained A=3, then closing B retained B=2 separately. Reopening A painted page 3.
- Trusted wheel scrolling followed by immediate Ctrl+W stored page 2/0.11016144349477684; reopening painted page 2 without rewriting that stored offset.
- PDF→EPUB stored A=3; returning to PDF painted page 3. Content-focused EPUB Ctrl+W/Ctrl+O did not finish the first return attempt. The existing Commands footer, activated with XTEST, closed EPUB; acquisition then succeeded. This is the documented EPUB input limitation, not an S3B fix.
- Three additional close/reopen cycles alternated pages 3→2→3; each actual JSON record and painted/footer page agreed. Settled same-path reopening restored page 2. A subsequent spread/width transition retained page 3 and its durable record.

Restoring a zoomed/continuous offset into the default fit-page layout may show the entire page rather than identical pixel placement; view preferences are not part of the position schema. Persisted offsets are not normalized to zero merely because the page now fits.

## Limits

The guarantee covers explicit application document close/replacement and their coordinated reader teardown. Arbitrary external component unmount is not an awaited persistence barrier. Native OS-window shutdown has no new flush handshake in this scope and is not guaranteed; forced termination/power loss are likewise outside the guarantee. Native Wayland, physical-human input and Windows/macOS execution remain unverified. No application permissions, native storage, dependency, EPUB renderer or PDF viewer changes are included.

Proposed commit scope: `fix(pdf): flush and order reading-position saves`. No commit authorized or created.

## Owned files

- `src/reader/useReadingPosition.ts`: synchronous snapshots, ordered per-path tails, bounded flush, restoration/reflow suppression and retired-error ownership.
- `src/reader/PdfReader.tsx`: close/replacement persistence barriers and flush registration; include actual layout changes in restoration tracking.
- `src/App.tsx`: await the registered PDF flush before committing EPUB; retain acquisition-generation checks.
- `tests/pdf-reading-position-runtime.test.ts`, `tests/fixtures/pdf-reading-position-runtime.tsx`, `tests/fixtures/pdf-reading-position-runtime.html`: actual-reader WebKitGTK lifecycle regression with deterministic persistence delays.
- This document: contract, evidence and limitations. Existing S2/S3A edits and `report.txt` were not modified.

## Verification results

| Check | Result |
| --- | --- |
| Focused new actual-reader WebKitGTK regression | PASS; close/order/restoration/replacement/error/timeout/unmount scenarios |
| Focused PDF navigation | PASS; 45 tests |
| Combined open/pristine/status/new-position run | 6 PASS, 1 FAIL; EPUB-only continuous→paged passage assertion failed |
| Complete Bun gate with required real-book path and scale variables | PASS; 1,259 tests, 0 failed, 0 skipped; 8,532 expectations, 25 files |
| TypeScript `--noEmit` | PASS |
| Frontend production build | PASS |
| Rust tests | PASS; 24 tests, no ignored tests |
| `git diff --check` | PASS |
| Isolated native Tauri debug/no-bundle build | PASS |

The focused EPUB failure was not hidden or changed; both status modes passed in the subsequent required full gate. That inconsistency remains an observed test/reflow risk, not a diagnosed or corrected S3B defect. Required native suites and real-book fixtures were available and executed. Task-owned native processes and temporary control instrumentation were removed.

## S4D: updater purity and appearance persistence

Audited from clean `master` at `eb2dee2647f0bb245c8799434a3bb7928f66c75f`.
The production correction is confined to `src/reader/PdfReader.tsx`; PDF
geometry, acquisition, restoration, rendering and retirement algorithms are
unchanged.

### Inventory and classification

| Calculation or boundary | Observation | Disposition |
| --- | --- | --- |
| Theme selection; recolor, hue, reverse-video and lightness toggles; custom hex submission | Six functional-updater sites called `saveRecolorSettings`, which synchronously writes localStorage. Development replay and batched intermediate calculations therefore performed external writes. | Confirmed impurity; move persistence to changed, committed appearance state. |
| Viewport resize | The previously cited impure `setViewerSize` callback is absent at this baseline. Capture already runs in ResizeObserver/RAF before asynchronous spread geometry and `setViewerSize(nextSize)`. The initial-size updater only compares and returns sizes. | No resize correction. Preserve pre-layout capture and existing generation/cleanup checks. |
| Page-element version, continuous-mode toggle, zoom-basis updater and search-result concatenation | Calculate new values without DOM access, storage, IPC, scheduling or resource acquisition. | Pure; unchanged. |
| Lazy recolor initialization | Reads and validates unknown localStorage data; two reads in development StrictMode, one in production. Unavailable storage retains the existing fallback behavior. | Read-only initialization; do not turn mount/replay into a preference write. |
| Reader/surface/position/keyboard latest-value refs | Render publishes current callbacks, values or path snapshots. Resource ownership is separately held by loading-task/geometry owners and effect-scoped renderer work. | No supported-flow failure reproduced. Speculative render values escaping through mutable refs remain a theoretical concurrent-render risk, not evidence for moving every assignment. |
| `matchesByPageRef` inside `useMemo` | Replaces a private structural-sharing cache; constructs local maps/arrays and performs no external operation. | No demonstrated defect; unchanged. |
| Recolor math and shader instance | SVG matrix/theme calculations are local math. Canvas/WebGL acquisition through `RecolorShaderRenderer.getInstance()` occurs in effect-owned recolor jobs, not React rendering/updater calculation. | Preserve existing cooperative cancellation and pristine/detail ownership. |
| Position, search, keyboard and title hooks | Storage/IPC, DOM changes, timers, listeners and async work run in event, committed-effect or explicitly owned lifecycle boundaries. Position cleanup still cancels work without flushing detached DOM or clearing pending restoration during replay. | Existing ownership and S3B/S4A contracts retained. |

### Reproduction and smallest correction

The new actual-App/PDF.js WebKitGTK fixture intercepts real Storage methods and
observes committed settings in a layout effect. Disposable Vite transforms count
updater evaluations, anchor operations, viewer creation/disposal and event-bus
listeners; no production diagnostic API is added. React's runtime and JSX
development mode are explicitly paired so the production control really uses
production React.

| Nine-command appearance batch | Development StrictMode | Production |
| --- | ---: | ---: |
| Updater evaluations, before and after | 18 | 9 |
| Actual storage writes before | 18 | 9 |
| Actual storage writes after | 1 | 1 |

Before correction, all 36 development / 18 production writes across the complete
probe occurred during updater calculation and disagreed with the previously
committed appearance. Final preferences were nevertheless correct: no durable
final-state corruption, stale retired-reader write, duplicate live viewer or
resize-anchor failure was reproduced. Do not describe those risks as confirmed
user-visible failures.

The six updaters now only return settings. One effect saves changed, committed
settings, with a ref initialized to the loaded state to suppress mount/replay
writes and deduplicate an already handled state. It adds no timer, async task or
second persistence store. Batched commands save only the final committed value;
uncommitted updates have no effect to persist. The complete probe now performs
10 writes in each runtime, all outside calculation and equal to committed
settings. Mount/remount, invalid input, discarded-batch retirement and geometry
changes produce no appearance writes.

### Geometry and lifecycle observations

Before/after resize evidence is identical in both runtimes: four native GTK
resizes retain page 2's heading; nine captures occur outside updater evaluation;
ten anchor applications differ from their captured page-top target by at most
`0.800003` CSS pixels. Measured viewport widths are 800 initially, then 900,
1200, 760 and 1000. The stored restored record remains `{page: 2, offset: 0.35}`
through the resize sequence. The probe records actual dimensions; a one-pixel
outer-window rounding difference is not an anchor-loss oracle.

Development effect setup/cleanup totals are 6/6 versus production's 3/3.
Both create and dispose exactly three actual PDF.js viewers over the probe,
retain only one live viewer/five event-bus listeners while reading, and finish
with zero listeners. Coverage includes rapid themes/toggles, both custom colors
and invalid input, continuous resizing, spread/single, fit-width/fit-page/manual
zoom, PDF replacement, PDF-to-EPUB replacement, queued-resize close and remount.
Existing progressive-opening, position, pristine, detail-rendering, search,
S4C and EPUB-C1.1 suites remain required and unmodified.

Focused verification: `bun test tests/pdf-state-purity-runtime.test.ts
tests/reader-appearance.test.ts` executes 86 passing tests.

### Fresh native candidate and limits

The fresh debug/no-bundle Tauri candidate has SHA-256
`3680113ba76c4be37b1a01996a6ec976da8ace64f77f32d55f7f2372c8bbb6ee`.
An isolated scale-1 Sway/pixman/Xwayland display runs actual WebKitGTK 2.54.2.
X11/XTEST drives commands, text entry, selection/copy, scrolling and navigation;
the native file picker's Open action uses AT-SPI.

Twenty observations cover rapid theme changes, invalid/valid hex colors, all
advanced toggles, recolor off/on, copy and content-focused palette entry,
760/900/1000/1200px resizing, spread/single, Shift navigation, a Caps_Lock-toggle
and pan sequence, saved-page reopening, PDF A-to-B, late page 995, PDF-to-EPUB,
late-page reopening and rapid resize/close. Actual SQLite localStorage retains
Custom `#AABBCC` / `#123456`, enabled, with all three advanced flags true.
Screenshots show the expected background RGB `(170,187,204)` and readable ink.

The actual canonical JSON retains page 995 offset `0.25` through fit/mode/resize
reflow, then saves `0.024984384759525295` after intentional scrolling and retains
that value through replacement/reopening. At the retained fractional position
the fixture's bottom-of-page text can lie below the viewport: its laid-out
range is not proof of painted text. The reopened page-995 screenshot does paint
the addressed page's text. No physical scroll-clamping correction is claimed.

Native probe recovery did not change the reader: invalid-hex text is painted
but its AT-SPI notification has no exposed text; the EPUB fixture says
“Chapter One”, and that painted footer is not exposed through AT-SPI. Original
probe failures are retained. Ctrl+W after focusing the EPUB child window did not
close it; the trusted footer-palette command did. The existing EPUB keyboard
delivery limitation remains, and no new per-key native modifier diagnostic or
publication security exception was introduced.

Evidence: `/home/tod/.cache/clio-s4d/20261121-105247/` contains original partial
probes, complete before/after JSON, focused output, fresh-candidate build/hash,
native screenshots/AX geometry, SQLite pixel observations and canonical JSON.
The task-owned native application, session buses and compositor are stopped.

### Complete verification

With both pinned real books available and `DISPLAY=:1` verified before and after:

| Gate | Result |
| --- | --- |
| Complete Bun suite | 1,276 passed, 0 failed, 0 skipped; 8,597 expectations across 27 files, 619.01 seconds |
| `bunx tsc --noEmit` | Passed |
| `bun run build` | Passed; existing large-chunk warning remains |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 24 passed, 0 failed, 0 ignored |

The earlier EPUB preference/reflow assertion remains enabled; no unrelated EPUB
assertion was changed or suppressed. The initial whitespace gate caught an
extra EOF blank in this newly appended audit; this documentation update removes
it. Original gate output remains under `gates/`; the final whitespace check is
recorded separately. No commit or dependency change was made, and `report.txt`
was neither created nor modified.
