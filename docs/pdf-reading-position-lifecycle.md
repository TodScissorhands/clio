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
