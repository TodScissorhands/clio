# 09C trusted-surface prototype — stopped at acquisition

The initial stop report below is historical. **09C-A1 subsequently authorized the acquisition-only dependency correction recorded at the end of this document. The trusted-surface prototype remains stopped.**

The approved bounded prototype hit its explicit acquisition stop condition before a trusted rendering surface could be accepted. No prototype or production correction is shipped. Production 09C remains unresolved.

## Executed observation

Environment: Linux, Bun 1.3.14, GTK 3, WebKitGTK 2.52.6 (`WebKit2` 4.1 introspection), X11 offscreen runner with `GDK_SCALE=1 GDK_DPI_SCALE=1`. This is a real archive/Book execution, **not native Tauri input or clipboard acceptance**.

A generated EPUB contains three XHTML spine members, archived CSS and a PNG. A normal opening with the installed epub.js 0.3.93 completed `book.open(..., "binary")`, `book.opened` and `book.ready`; `isOpen` was true and spine length was 3.

The cancellation reproduction delays real `Archive.getBlob()` completions on that Book's archive instance. Once replacement work has read a real Blob, it calls `Book.destroy()`, then releases those pending reads. Installed library source is unchanged. URL creation/revocation and errors are observed temporarily and restored in `finally`.

Observed after releasing the reads:

- Two blob URLs were created **after destruction**, with zero revocations at measurement. The destroyed archive's URL cache was repopulated with `/EPUB/style.css` and `/EPUB/pixel.png`.
- Replacement continuation reported `TypeError: undefined is not an object (evaluating 'this.resources.replaceCss')`.
- The captured `ready` promise settled; the captured `opened` promise remained unsettled during the 250 ms observation window. This is not a claim of an infinite-duration observation.
- `book.navigation` and `book.resources` were not resurrected. The failure is post-destruction archive URL creation/cache mutation plus the late destroyed-resource access.
- The probe explicitly revoked remaining blob URLs after measurement, closed its ephemeral HTTP server and removed temporary generated books.

The runner's `passed:true` means the reproduction executed, **not** that the architecture passed.

## Library ownership boundary

Relevant installed source:

- `node_modules/epubjs/src/archive.js:210–219`: `createUrl()` retains a Blob-read continuation that creates and caches its URL without checking destruction.
- `archive.js:245–252`: `destroy()` clears the ZIP and URL cache but does not cancel that continuation.
- `node_modules/epubjs/src/book.js:690–692`: replacement completion dereferences `this.resources`, which `Book.destroy()` clears.
- `book.js:500–507`: replacement failure is logged rather than rejecting the captured `opened` deferred.
- `book.js:481–484,548–552,729–759`: detached navigation work and destruction also lack an acquisition cancellation/join contract. These paths were inspected; navigation resurrection was not observed in this reproduction.

Parent generation/port checks could reject stale interaction messages, but cannot prevent this library work from creating resources after retirement. Waiting for public readiness is not a bounded cancellation guarantee: the inspected error path can leave `opened` pending, and not all internal work is joined by the public opening promise.

The approved plan explicitly required stopping rather than patching epub.js, exposing an unsafe opener, or silently widening acquisition/renderer scope. No alternate same-origin shell, weakened sandbox/CSP/capability, focus theft or native-event bridge was substituted.

## Reproduction and preserved work

Standalone evidence is retained outside the repository in `/tmp/clio-09c-acquisition-evidence.tar.gz`. It contains the fixed browser probe, five-book generator, in-memory Vite runner, existing WebKit runner copy, result JSON and instructions. Extract it into a task-owned directory; with the Clio workspace as the current directory and its existing dependencies installed, run:

```sh
bun /path/to/extracted-evidence/run.ts
```

Requires a working X11 `DISPLAY`, Python 3/PyGObject, GTK 3 and WebKit2 4.1. This is not a permanent regression suite or a native input test. The archive contains temporary investigation instrumentation only; it is not imported by the application.

Archive integrity: `gzip -t` passed. SHA-256: `1368da5e428841cbcd97582b0fd40d53d4c8108364db484592a22e60462c6815`.

All unverified prototype files and the two task-added router guards were removed. PDF, EPUB rendering/CFI/preferences, shared router, sandbox, Tauri capabilities and native source remain unchanged. Existing user modifications to `README.md`, `package.json`, `bun.lock`, `docs/epub-keyboard-focus.md` and untracked `report.txt` were preserved. Nothing was staged, committed or pushed.

No full CI gate was run: there is no candidate implementation past the approved stop gate. No content-focused native shortcuts, text selection/copy, hyperlink delivery, Tauri privilege isolation, or portable rendering feasibility is claimed by this acquisition probe.

## Required next scope decision

Continuation needs an explicitly authorized, bounded acquisition/retirement design that owns and joins **all** archive asset/navigation work, prevents resources being created after destruction and settles opening failures. Whether that requires a maintained upstream cancellation fix or a different acquisition path must be established before restarting the shell prototype. No dependency/library patch or renderer migration is authorized by this result. Existing CFI/mapping/per-Document preferences/multiview integration stop gates remain separate and unchanged.

## 09C-A1 — acquisition and retirement correction

### Root cause and lifecycle

The installed epub.js 0.3.93 patch now gives Book, Archive and Resources separate immediate retirement boundaries, sharing a small `Lifecycle` implementation in the existing `utils/core.js`. Both `src` and compiled `lib` are patched; no renderer, Section, CFI, preference, interaction, sandbox, capability or native API was migrated.

- Each owner tracks its pending public operations. Retirement rejects them immediately with `AbortError`; raw ZIP reads may still finish, but guarded continuations cannot publish their results. There is no sleep, polling or deferred-destruction grace period.
- Book opening now joins navigation, display options and resource replacement instead of detaching those continuations. Failure retires asset owners and rejects `open()`, `opened` and all still-pending `loaded`/`ready` promises. Captured promise identities remain usable after destruction. Internal observers prevent detached rejection reports without converting the caller's rejected promise into success.
- Book field accesses after asynchronous boundaries, cover URL resolution and serialization hooks check retirement. Destruction is idempotent. The existing optional Apple display-options fallback remains; real archive, navigation and asset/CSS failures propagate instead of being logged and leaving opening pending.
- Archive owns archive-generated URLs; Resources owns its network/CSS rewrite URLs. Concurrent member requests share their URL operation. Creation checks ownership before publishing and revokes a URL if destruction happens reentrantly during `createObjectURL()`. Explicit revocation removes its cache entry; destruction revokes actual URL values exactly once, not archive member names. CSS rewrite blobs are now owned too.
- Clio's `openEpubBook(bytes, signal?)` creates an empty owned Book, explicitly opens copied bytes as `"binary"`, and awaits `open()`, `opened` and `ready` before transfer. Abort/failure retires its candidate once. App aborts pending EPUB acquisition on the next request, close and unmount; its generation check remains the final commit guard. A cancelled candidate never owns the committed replacement or its error state.
- A failed replacement retains the current reader. Successfully acquired Books still transfer to EpubReader, whose existing rendition/CFI/preference/effect-replay teardown remains unchanged. PDF acquisition and rendering are unchanged.

### Maintained patch and files

The existing `patchedDependencies` entry still applies `patches/epubjs@0.3.93.patch`; no version, dependency or manifest change is required. The previous continuous-manager and source/compiled Stage corrections are retained.

The new patch changes only Book, Archive, Resources and shared core utilities in both entrypoints. The helper lives in an existing utility file because Bun 1.3.14 failed to apply newly added helper-file hunks (`EACCES` while attempting a relative `lib/utils` mkdir outside the extracted package). A fresh isolated installation of the final standard-context patch succeeded and reproduced all eleven patched files byte-for-byte. An attempted zero-context representation was rejected after its installation produced invalid compiled code; it is not retained.

`patches/.gitattributes` declares unified-diff payload whitespace semantics: context prefixes before upstream tabs/empty lines are not application-source indentation/trailing-space errors. Other source retains normal whitespace checks. No compiler/runtime warning was disabled.

Repository changes:

- `src/epub/engine.ts`, `src/App.tsx`: candidate ownership and cancellation.
- `patches/epubjs@0.3.93.patch`, `patches/.gitattributes`: maintained lifecycle correction and patch-format handling.
- `tests/epub-acquisition-runtime.test.ts`, `tests/fixtures/epub-acquisition-runtime.tsx`, `tests/fixtures/epub-acquisition-runtime.html`, `tests/fixtures/create-epub-acquisition-document.py`: deterministic real-archive regression using the existing WebKit runner, with explicit prerequisite failures.
- `tests/reader-status-runtime.test.ts`: migrate its test-only opener observation/gate to the empty-Book acquisition boundary, before the final abort check. Its consumer-visible assertions are unchanged.
- This document: correction and evidence.

The new runtime executes the same 17 cases against actual source and CommonJS entrypoints. It covers normal section/CFI/rendition output; pre-aborted acquisition; cancellation during ZIP opening, container/navigation text, asset Blob and rewritten-CSS reads; propagated read/JSON/missing-member/invalid-ZIP errors; concurrent URL creation, revoke/recreate, reentrant destruction and repeated destruction; same-member A/B replacement; App stale-open cancellation and invalid replacement retention. Public owner promises must settle **before** the controlled raw reads are released. Timers are test failure deadlines, not cleanup mechanisms.

### Before/after and executed checks

The established archived reproduction was reused without changing its cancellation gate. Its observation window remains evidence only; deterministic regression settlement does not depend on it.

| Established reproduction | Before | Corrected installed patch |
| --- | --- | --- |
| Normal opening | Three sections, open | Three sections, open |
| Captured `opened` at measurement | Unsettled | Settled rejection |
| URLs created after destruction | 2 | 0 |
| Unreclaimed URLs / post-destroy cache entries | 2 / 2 | 0 / 0 |
| Destroyed-resource access | `this.resources.replaceCss` TypeError | None |

The corrected reproduction's three error entries are the expected observed `AbortError` rejections of `open()`, `opened` and `ready`, not late exceptions. Both new entrypoint regressions reported 24 created / 24 revoked URLs and no runtime errors.

Focused reading-position, preferences, Stage teardown and PDF-navigation coverage passed (73 tests). The new acquisition runtime passed both entrypoints. Frozen install passed. The first complete native-required Bun run exposed an outdated reader-status opener observation hook; it was migrated without changing consumer-visible assertions. After its focused regression passed, the complete native-required gate passed: **1,287 tests, zero failures**, with all WebKit suites executed. TypeScript, production frontend build and all 9 Rust tests passed; the existing frontend chunk-size advisory remains. `git diff --check` passes with standard unified-patch handling.

### Native preservation smoke and limits

A newly compiled task-owned Tauri debug process loaded the ordinary Vite App at `http://localhost:15439`, using isolated XDG directories and **X11/Xwayland**, GTK 3/WebKitGTK 2.52.6. Binary SHA-256: `76e127de1b4e19cd13dbc51429da05ad5dbb8303a09d2228d0fb9a63964e5968`. Native window 4194307 belonged to PID 217090; screenshots were 952×1037 native pixels, not a claimed CSS viewport.

Native XTEST input used the actual GTK picker: A opened/rendered; A→B rendered B; an invalid EPUB displayed its ZIP error while retaining B and its native title; close returned the empty reader; ordinary reader click/picker reopened B; host chapter navigation displayed B chapter 2. No publication script or diagnostic acquisition bridge was injected. The post-close reopen used an ordinary reader click to restore input focus, not a new focus workaround.

The initial smoke did not establish native CFI restoration: the chapter-2→close→reopen attempt retained a saved first-spine CFI and reopened chapter 1. The focused final acceptance below diagnoses that pre-existing failure and records its correction. Automated CFI restoration/preferences suites passed. No native content-focused shortcut, hyperlink, clipboard/IME/accessibility, Wayland, Windows or macOS correction is claimed.

Raw JSZip decompression and already-issued network work are not physically preempted; ownership, public settlement and publication are retired immediately. The optional epub.js `store()` subsystem is not used by Clio and was not redesigned. Failed required asset loads now reject acquisition rather than silently yielding a partially prepared Book.

The original stop evidence remains unchanged. The acquisition correction does **not** authorize resuming the trusted-surface prototype, expanding the renderer or bypassing its separate integration/security gates.

### Retained correction evidence and cleanup

At verification time, corrected reproduction, exact patch/source/regression provenance, native screenshots and isolated position records were archived as `/tmp/clio-09c-a1-retirement-evidence.tar.gz`. `gzip -t` passed; its recorded SHA-256 was `140111ff912baeadde96db8b4ff196d0b19b4a456243d6a19081d207d7632e6d`. Its `README-after.txt` distinguished expected cancellation rejections from late failures and recorded the native CFI limitation. **After session resume, neither this archive nor the original `/tmp/clio-09c-acquisition-evidence.tar.gz` is present in the current filesystem. These are historical paths, not available downloads.** The observed results above and permanent real-archive regressions remain available; raw archived screenshots cannot currently be supplied.

All five task-owned native process IDs were absent after service teardown. The extracted reproduction workspace, isolated installation/diagnostic workspace, native XDG directories and temporary instrumentation were removed after archiving. The original baseline evidence archive was not modified.

At the end of the initial acquisition correction, `README.md`, `package.json`, `bun.lock` and `docs/epub-keyboard-focus.md` retained their recorded SHA-256 values. User-owned `report.txt` was not read or modified. Nothing had been staged, committed or pushed; review handoff was authorized separately.

## Final native acceptance and review handoff

The review branch was created from `main` at `eafe53dd118fc31efaa25bab433f818b5132cafb`, matching `origin/master`. Local `master` was not reconciled or modified. All existing worktree modifications were preserved.

### CFI failure classification and causality

The targeted native check reproduced the earlier problem using the generated `acquisition-a.epub` at its canonical filesystem path. Chapter 02 was visibly displayed, but the footer still identified Chapter 01, the saved CFI was `epubcfi(/6/2!/4/24/1:0)`, and reopening restored Chapter 01. The saved CFI was **incorrect**, not missing or merely ignored during restoration.

A temporary frontend overlay replaced App, the opener and the four acquisition/resource ownership modules with their pre-09C-A1 versions, holding the publication, native geometry, reader, existing continuous-manager/Stage corrections, sandbox and current installed dependency versions constant. That baseline produced the same incorrect CFI. This is a pre-existing visibility defect, not an acquisition/retirement regression.

A trusted-host-only `relocated` observation recorded `scrollLeft=761` and container edges `[0,761]`, but the previous chapter's right edge was `0.20001220703125` CSS px. Both the previous and current chapters were classified as visible. The first location therefore selected the previous chapter's final paragraph, despite Chapter 02 filling the reading area. No publication scripts, input forwarding or generic evaluation bridge were introduced.

### Bounded correction and final native result

The maintained patch additionally corrects `DefaultViewManager.isVisible()` in source and compiled entrypoints. Only **zero-overscan, horizontally paginated** visibility is normalized to the integer CSS-pixel grid used by pagination. Fractional boundary residue no longer selects the preceding chapter. Continuous/non-paginated visibility, vertical scrolling, prefetch margins, CFI format and persistence APIs retain their previous behavior.

`tests/epub-paginated-visibility.test.ts` adds four deterministic source/compiled boundary regressions using the measured native geometry. Both previous-chapter assertions failed before the correction and passed afterward; ordinary overlap, exact boundaries, scrolling and prefetch preservation are covered.

After validating the isolated trial, the final check used the **ordinary Tauri App with no trial overlay or host observation injection**, GTK/WebKitGTK 2.52.6 on X11, explicit test-window focus and real native picker/XTEST input:

1. Open the generated file through its canonical path.
2. Navigate to Chapter 02 and verify the visible chapter and footer.
3. Read the native position store **before closing**: `epubcfi(/6/4!/4/2[start]/1:0)`.
4. Close and verify that the same CFI remains saved.
5. Reopen the identical canonical path: Chapter 02 and its footer are restored.

The ordinary App run used PID 48698/window 6291459. Native screenshots show Chapter 02 both before close and after reopen. The temporary baseline/observation/trial code was never added to application source or staged. Early automated picker attempts stopped before confirming the GTK file selection; the final ordinary-App sequence explicitly confirmed that selection and completed the entire restoration check.

Because the demonstrated visibility correction changes production dependency code, focused checks and the normal gate were rerun: **15 focused tests passed; 1,291 complete Bun tests passed with zero failures and native suites executed; frozen installation, TypeScript, frontend build, all 9 Rust tests and whitespace checks passed.** No complete suite was repeated before that production change.

Final native evidence is retained outside `/tmp` as the session artifact `local://09c-a1-final-native-evidence/native-evidence.tar.gz`, alongside `manifest.json`. Archive SHA-256: `a0d9a57f53a0a8c5ee519f37ddcb5d179e577533dad9b210eac983dfe9722640`; integrity verification passed. It contains native before/after screenshots, canonical CFI records, the baseline geometry observations and the temporary comparison sources. Physical-input/IME/accessibility and other native platforms remain unverified. The trusted-surface prototype is not resumed.
