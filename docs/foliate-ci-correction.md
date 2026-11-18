# PR #10 — CI verification correction

Date: 2026-11-18. Verdict: **PASS for the local corrective acceptance campaign**. The corrected GitHub-hosted job has not run; pushing remains unauthorized.

Worktree: `/home/tod/.omp/wt/clio-foliate-rebuild`. Branch: `task/foliate-epub-rebuild`. Accepted parent: `b0f28bc96d64a16cd19640c37a95b279bc1b2c5e`, unchanged. This correction is separate from that integration commit. No additional worktree, branch, dependency upgrade, push, merge or amendment was made. `report.txt` was not created or modified.

## Evidence and environment

The complete [Verify job 134981909633](https://github.com/TodScissorhands/clio/actions/runs/44355365419/job/134981909633) log was downloaded and examined, including both serialized reader-status scrolling observations. Its result was 1,253 passed and five failed. Raw job logs, extracted scrolling observations, diagnostic snapshots, intermediate failures and final verification logs are preserved locally at:

`/home/tod/.cache/clio-pr10-ci-correction-014RLK/`

The original working evidence remains at `/tmp/clio-pr10-ci-correction-Fx6x3X/`. Neither location is a versioned application asset.

| Environment | WebKitGTK | GTK | Graphics / display | Default fonts |
| --- | --- | --- | --- | --- |
| Failing GitHub Ubuntu 24.04.5, image `20261111.370.1` | `2.52.6-0ubuntu0.24.04.2` | `3.24.41-4ubuntu1.3` | Mesa `25.2.8-0ubuntu0.24.04.5`; Xvfb `21.1.12-1ubuntu1.9`; DRI3/EGL acceleration warnings | Ubuntu serif/sans environment |
| Local representative Ubuntu 24.04 rootfs | Same WebKitGTK package | Same GTK package | Same Mesa and Xvfb packages; `xvfb-run`, scale/DPI scale 1 | DejaVu Serif / Sans |
| Accepted Arch stack, also used for corrected focused tests | `2.54.2` | `3.24.52` | Mesa `26.2.7-arch1.1`; AMD Radeon/radeonsi; accelerated X11 display `:1` on the Wayland desktop | Noto Serif / Sans |

Bun was `1.3.14 (0d9b296a)` in the failing job and both local environments. The Ubuntu rootfs runs with unprivileged UID/PID namespaces and the existing worktree bind-mounted, not a second checkout. It shares the Arch `7.3.4-arch1-1` kernel; it is not an identical GitHub VM. WebKit's sandbox was not disabled. The GitHub GPU model was not recorded. DRI3 warnings alone do not establish a rendering failure.

The old passage-preservation failure was reproduced on the matching Ubuntu userspace. Different wrapping/page counts are valid environmental differences; losing the addressed painted passage is not.

## Failure classification and corrections

### 1. Missing real-book corpus — CI configuration defect

The required historical-CFI compatibility case had no `CLIO_FOLIATE_REAL_BOOKS` or publications in CI. The workflow now provisions two unmodified, versioned GITenberg release EPUBs before tests and passes the directory to the required WebKit runner. The compatibility test executes; it is not skipped.

`tests/fixtures/foliate-real-books.manifest` pins HTTPS URLs and SHA-256 digests:

| Publication | Release | SHA-256 |
| --- | --- | --- |
| Alice / Gutenberg 11 | GITenberg `0.2.2`, `book.epub` | `fcbd44d87632d0cd8e9740de1c80d98c2dfb56d222d66865dacfce66e44a3da3` |
| Pride / Gutenberg 1342 | GITenberg `0.0.2`, `Pride-and-Prejudice.epub` | `4b2c87ff4bb6ceb1b5fefd406a7e98d068a3a9335fae0395db8cd90d3de830fc` |

The provisioner checks both downloads and existing files, stages downloads before publishing them, rejects changed contents without overwriting them, and permits HTTPS redirects only. Fresh provisioning and verified reuse succeeded. A deliberately corrupt existing Alice fixture was rejected with exit 1 and retained unchanged.

Provenance, source commits, release asset IDs and rights are documented in `tests/fixtures/foliate-real-books.md`. ZIP CRCs and all OPF resource references were checked. Earlier Alice releases referencing an absent cover were rejected rather than repaired; a preliminary run using Alice 0.0.1 failed for that reason. Pride's text is public domain in the USA, but this edition's Tim Daniel cover is CC BY-NC 4.0: its attribution/noncommercial restriction is explicit, and the EPUB is a downloaded test input, not an application distribution asset.

Both selected books executed legacy epub.js CFI resolution, layout/font-change passage checks and tagged Foliate reopening successfully on Ubuntu and Arch.

### 2. First EPUB render — fixture ordering/readiness correction

Input-element discovery did not establish that React StrictMode's initial passive-effect cleanup had completed. The complete fixture now crosses a MessageChannel checkpoint before dispatching acquisition, matching the existing lifecycle fixture's startup discipline. It waits for the relocated CFI's document and a non-whitespace painted character intersecting the viewport on both axes, not renderer-primary text from a potentially preloaded frame.

[INFERENCE] The original empty reader/no-error first-render timeout is consistent with the synthetic acquisition being retired during StrictMode startup replay. The original log did not capture the exact effect schedule, so that individual scheduling attribution is not proven. No independent production first-render defect was established, no timeout was increased, and the corrected complete scenario passed in both native WebKit versions and the complete Ubuntu suite. Bounded failure observations now retain CFI, frame geometry, paint state and runtime errors before teardown.

### 3–4. Both continuous-to-paged failures — confirmed Foliate compatibility defects

The Ubuntu diagnostic captured continuous `scrollTop=4760`, with section 1's first paragraph beginning at viewport y = −1.5. The saved range began at offset **201 of a 201-character text node**. That end-of-node caret was not an addressed painted character. After repagination the observed first-visible section was 0/page 6. The discrepancy was not accepted merely because a primary section or target index matched.

Two localized paginator corrections address the geometry:

- Start-boundary bisection now uses the prefix rectangle's intersecting end (`p.right > start`) rather than the suffix's start (`q.left > start`). A partially clipped final line can no longer make the start search select the text-node end instead of visible text.
- Horizontal continuous rectangles are mapped from their actual `top`/`bottom`; they no longer subtract page margins absent from that layout. Vertical-writing mapping is unchanged.

These changes are in `patches/foliate-js-clio.patch`. They preserve Clio's **first-visible reading passage** contract for relocation, CFI, status and persistence. No viewport-centre substitution, duplicate tracker, polling loop or global primary-index policy change was introduced. The existing painted-passage assertion remains; an additional check requires the continuous relocation CFI itself to address painted text before switching modes.

The correction exposed a separate obsolete nonlinear-navigation setup: a chapter-start spread could also show its predecessor, and command dispatch did not await navigation. The status fixture now starts inside the nonlinear section, awaits the actual requested navigation, checks that its target is the previous linear section, and independently requires that section's heading to paint. A deep linear-section precondition also makes the trailing-nonlinear check unambiguous. Neither check substitutes a primary index for visibility.

### 5. Unsettled B section 2 — confirmed preload/restore ordering race plus fixture assumptions

An intermediate Ubuntu run passed four cases but still failed acquisition. It retained B's saved section-1 CFI while showing chapter 1 and the genuine “Saved EPUB position could not be restored” warning. All three section frames were present by the eventual failure snapshot; extending the readiness timeout would not restore the failed passage.

Foliate adds an adjacent view to its map **before** its asynchronous iframe load finishes. Explicit CFI navigation could reuse that view while its Document was still `about:blank`, resolve the saved anchor against the unfinished tree, and trigger Clio's safe original-position-retained fallback.

Public paginator `goTo()` now awaits the renderer's **existing** fill promise before resolving/reusing the target. Destruction is checked before and after that await, retaining retirement protection. No new readiness state, retry, fallback or observer was added.

The acquisition regression deliberately holds B's real adjacent iframe after view creation and before loading, crosses the restore-attempt checkpoint, then releases it. Both late-A success and late-A failure paths must reopen B at the saved painted passage. This gate exists only in the disposable Vite test bundle; it is absent from production Foliate source.

The fixture also now captures saved A/B records only after the intended CFI section is readable and the corresponding queued persistence write completes. Reopening checks the saved CFI's painted character, not primary selection. Final acquisition runs created and revoked **73/73** resource URLs, with no reported lifecycle errors.

## Changed files

- `.github/workflows/verify.yml`: provision the verified corpus and export its path.
- `scripts/provision-foliate-real-books.sh`: fail-closed fixture downloader/verifier.
- `tests/fixtures/foliate-real-books.manifest` and `tests/fixtures/foliate-real-books.md`: checksums, provenance, validation and rights.
- `patches/foliate-js-clio.patch`: intersecting start-character search, correct continuous coordinates, and explicit-navigation preload ordering.
- `tests/fixtures/foliate-runtime.tsx`: startup ordering, CFI/paint-based readiness, shared compatibility visibility helper and bounded failure evidence.
- `tests/fixtures/epub-acquisition-runtime.tsx` and `tests/epub-acquisition-runtime.test.ts`: saved-passage preconditions/assertions, unfinished-frame regression and bounded observations.
- `tests/fixtures/reader-status-runtime.tsx`: continuous-CFI paint assertion and asynchronous nonlinear-navigation preconditions.
- `README.md`: accurate native prerequisites and corpus provisioning instructions.
- This report.

No PDF production code, Tauri permissions/capabilities, native session authorization, publication isolation, application dependency version or lockfile changed. No diagnostic script, corpus archive, cache, screenshot or generated binary is included in the corrective source change.

## Verification results

| Executed gate | Passed | Failed | Skipped / ignored |
| --- | ---: | ---: | ---: |
| Five affected runtime cases, representative Ubuntu | 5 | 0 | 0 |
| Same five cases, Arch WebKitGTK | 5 | 0 | 0 |
| Complete existing Bun suite, representative Ubuntu | 1,258 | 0 | 0 |
| Locked Rust tests, Arch | 13 | 0 | 0 |

The full Ubuntu run executed 24 test files, 8,527 expectations, in 266.27 seconds. The focused Ubuntu run took 52.13 seconds; Arch took 54.37 seconds. The full campaign ran once after the coherent corrective batch; earlier focused/diagnostic failures were retained, not presented as passes.

Also successful:

- `bunx tsc --noEmit`.
- Final-source `bun run build` (`tsc && vite build`).
- `cargo test --locked --manifest-path src-tauri/Cargo.toml`; its additional zero-test targets also completed successfully.
- `bun install --frozen-lockfile` in the worktree and a separate minimal install directory with an empty isolated Bun cache: 68 packages installed without lockfile changes.
- Independent application of the patch to pristine cached pinned source, then byte-for-byte comparison with the active package and fresh frozen installation (excluding Bun's own `.bun-tag*` markers).

The complete suite includes PDF.js and shared EPUB/PDF status regressions, actual WebKit EPUB rendering/search/TOC, both continuous directions, reflow/restoration, acquisition/cancellation/replacement, publication security, keyboard/focus, and historical/tagged CFI compatibility. There were no failing or skipped cases in that run.

### Reproduction commands

With the workflow's native prerequisites installed, use Bun 1.3.14:

```sh
bun install --frozen-lockfile
export CLIO_FOLIATE_REAL_BOOKS="$(mktemp -d)"
bash scripts/provision-foliate-real-books.sh "$CLIO_FOLIATE_REAL_BOOKS"
PATH="/usr/bin:$PATH" xvfb-run -a env GDK_SCALE=1 GDK_DPI_SCALE=1 \
  bun test tests/foliate-runtime.test.ts tests/reader-status-runtime.test.ts tests/epub-acquisition-runtime.test.ts
PATH="/usr/bin:$PATH" xvfb-run -a bash scripts/test-webkit-required.sh
bunx tsc --noEmit
bun run build
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

## Dependency and patch reproducibility

Foliate remains pinned to `22a49acaa120877ede21f713679ab8ba4d1ef663`. Existing Foliate license/attribution remains intact; no dependency upgrade or additional application dependency was needed.

| File | Final SHA-256 |
| --- | --- |
| `patches/foliate-js-clio.patch` | `6469725ccab9605c648ade5d74f2eee0f035b950a0b3d061fc58c7fcdec79085` |
| Patched `paginator.js` | `dcb975c929d0b765c0e308c2a1fe04363119a8c1e8a2d09e87b709364570e111` |
| Patched `epub.js` | `b7f76063841b33349bd0786febc9486454f95e2ceef6b1229012e599a9c17229` |
| Patched `view.js` | `0ce9f681f432a7b30432034c8e438555f0ecc149c0a4a76b5e1fd1a764c45778` |
| Patched `fixed-layout.js` | `97322c9d924c1cbf2ac7d3a7338972ccd255dac2eef27cd3413587e341e0703e` |

The latter three source hashes are unchanged from integration acceptance. Independent patch and isolated-install comparisons were identical. See `final-patch-equivalence.log`, `final-frozen-equivalence.log`, `final-isolated-frozen-install.log` and `final-patched-source-hashes.txt` in the persistent evidence directory.

## Remaining verification boundaries

- The corrected GitHub-hosted workflow still requires an authorized push and actual Actions execution. Local representative Ubuntu acceptance is not a claim that a new hosted run occurred.
- The precise scheduler interleaving behind the original first-render timeout was not captured; the startup explanation above is explicitly an inference.
- This CI correction did not build and manually drive a fresh standalone Tauri executable. It exercised the corrected implementation through real native WebKitGTK regression runners and built the frontend. Physical-human keyboard input, IME and native Wayland were not newly verified.
- The prior accepted native evidence remains available at `/home/tod/.cache/clio-final-native-7GXfud/evidence/`; its executable hash is not reused as proof of these corrections. `docs/foliate-integration-acceptance.md` is unchanged.
- Release availability is external; changed asset contents fail checksum verification. Publication rights outside the documented test use require separate review.

No confirmed failing production behavior remains in the executed correction campaign. Push approval and the subsequent hosted verification remain outstanding.
