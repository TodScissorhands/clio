# Task 09C1 — EPUB keyboard focus: blocked on the tested WebKitGTK boundary

## Outcome

No production correction is applied. The defect remains **blocked by platform constraints for ordinary browser-level event handling on WebKitGTK 2.52.6 with the existing sandbox**. A deferred host-focus workaround restores shortcuts in one case but breaks native copying after text selection. Shipping it would misrepresent keyboard reliability and violate interaction safety.

This is the Task 09C1 stopping condition, not completion of EPUB keyboard acceptance. No Task 09C2 work is included.

## Baseline and preservation

- Entry: `master...origin/master`, HEAD `0e81fff5b0ba8501cd1e3cca0c73ff553bff7e28`.
- Only entry worktree item: untracked `report.txt`; left untouched.
- Repository changes: this report and a README link to it. No application, epub.js patch, configuration, capability, dependency or existing test changes.
- No commit, push, staging, reset or rebase.
- H03A evidence: `/tmp/clio-h03a-9zkfbh9n/H03A-audit.md`, especially section 11.
- H03B1 evidence: `/tmp/clio-h03b1-p9oz0a25/H03B1-report.md` and its native comparison/integration results. Its ownership correction is present in the accepted baseline; it did not claim to fix native delivery.

## Native method and provenance

The task-owned Tauri debug binary loaded a fresh production-mode Vite bundle of the current App, EpubReader, shared interactions hook, installed patched epub.js and PDF reader. Test-only transforms exposed reader state and observed entry to the actual shared keyboard handler. They did not replace rendering/navigation, alter the sandbox or directly call keyboard callbacks. Opening generated files used an exposed App source-opening callback; layout and TOC acceptance used the real palette with native clicks.

Native input came from X11/XTEST through `xdotool`, not JavaScript `dispatchEvent`. Host positive controls recorded `isTrusted: true`. Capture observers were attached from the host to the host Window/Document, iframe element and embedded Window/Document for keyboard, pointer, mouse, focus and selection events. No executable script was inserted into publication markup.

The native backend was X11 under the desktop's Xwayland server. Process-local `GDK_SCALE=1 GDK_DPI_SCALE=1` did not remove WebView scale: measured DPR was 1.25. Authoritative normal-window observations used a 761 × 829 CSS viewport; narrow observations used 448 × 576 (560 × 720 native window). Input coordinates were converted using measured DPR. Early unscaled-coordinate interaction observations were superseded; they are not used for the acceptance conclusions below.

A separate visible Python GTK/WebKitGTK view loaded the same production App bundle to observe the supported widget-local native input signals. It was not a substitute renderer. The final standalone native regression ran there; the full Tauri instance independently reproduced the same boundary and supplied the interaction/keyboard/lifecycle observations below.

These runs reuse the installed native debug binary, rather than establish fresh packaged-binary provenance. No physical keyboard/touchpad or native Wayland-backend acceptance is claimed.

## Exact event boundary

| Focus / input | Host Window / Document JavaScript | Embedded Window / Document JavaScript | Application result |
| --- | --- | --- | --- |
| Host reader DIV, native PageDown/PageUp | Native key events observed; shared router entered | Not the focused input context | Paged position moves; continuous viewport scrolls |
| Host reader DIV, native `:` | Native keydown reaches shared router | Not the focused input context | Real command palette opens and focuses its input |
| Palette input, native Escape | Shared router entered | Not the focused input context | Palette closes; host reader DIV regains focus |
| Native click on ordinary publication text | Host DIV blur/focusout and host Window blur observed; no publication pointer event bubbles into the parent | No mouse/pointer/focus listener callbacks observed | Top activeElement IFRAME; embedded activeElement BODY |
| Iframe BODY, native navigation or `:` | No keydown/keyup callback; no shared-router entry | No keydown/keyup callback on either Window or Document | No Clio navigation or palette; navigation guard remains zero |
| Iframe input, native typing | No host key callback | No embedded key callback | Browser default editing still changes the input value |
| Iframe text, native selection and Ctrl+C | No host key callback | No selection/key listener callback | Browser default selection and copying work |

`document.hasFocus()` stays true while publication content has focus. The application is still the focused native window; the host Window blur is a transition into a child browsing context, not evidence of an application freeze or lost OS focus. React cannot route an event whose JavaScript listener was never invoked. The existing shared hook uses native Window capture listeners, not a React iframe event handler.

The observations establish **suppressed JavaScript listener invocation**, not absence of all internal browser events. Native editing and copying prove browser default input processing remains active. No diagnostic manually invoked an installed keyboard callback as evidence of native delivery.

### Source explanation

Installed epub.js `src/managers/views/iframe.js` creates an iframe with `sandbox="allow-same-origin"`; `allow-scripts` is added only for `allowScriptedContent`. Clio explicitly passes `allowScriptedContent: false` in `EpubReader.tsx`. The iframe's loaded Document is passed to `Contents`.

`Contents.addEventListeners()` attaches to the embedded Document; its selection handler also depends on Document events. `Contents.linksHandler()` uses `replaceLinks()`, which assigns an `onclick` callback. Clio's `useReaderKeyboard()` separately attaches keydown/keyup capture handlers to the embedded Window through `attachEpubKeyboard()`. Moving registration between those two embedded event targets cannot bypass the platform guard.

Version-matched WebKit source explains why a host-created callback is still suppressed:

1. [`JSEventListener::handleEvent`, WebKitGTK 2.52.6](https://github.com/WebKit/WebKit/blob/webkitgtk-2.52.6/Source/WebCore/bindings/js/JSEventListener.cpp) obtains the **event target's execution context** and returns when that frame's `canExecuteScripts(AboutToExecuteScript)` is false, before calling the listener function. The callback's own JavaScript global object is examined later.
2. [`ScriptController::canExecuteScripts`, WebKitGTK 2.52.6](https://github.com/WebKit/WebKit/blob/webkitgtk-2.52.6/Source/WebCore/bindings/js/ScriptController.cpp) returns false for `SandboxFlag::Scripts` and reports the missing `allow-scripts` permission.

Keyboard events within a child browsing context do not bubble through the iframe element into its parent document. Parent capture listeners therefore cannot recover them. The frame element did not supply a usable publication pointer-up or selection-completion callback in these native runs either.

## Bounded mechanisms evaluated

| Mechanism | Native result | Decision |
| --- | --- | --- |
| Existing embedded Window capture + additional embedded Document capture observation | Neither receives native input callbacks under the current sandbox | No extra listeners or duplicate router |
| Set iframe `tabIndex=-1` | Native text click still focuses iframe; `:` still fails | Reject; sequential tab order is not pointer focus ownership |
| Synchronously refocus host from host Window blur | Top activeElement can report DIV while native keys still go to the child; input editing confirms that mismatch | Reject; DOM focus state alone is not native-delivery proof |
| Defer host refocus until the next timer, only for iframe BODY and no existing noncollapsed selection | Plain-click `:` works; a subsequent native drag creates an iframe selection but Ctrl+C is delivered to the host and does not copy it | Reject; steals input ownership during selection |
| Forward epub.js keyboard/selection/pointer events | Those event callbacks depend on the same suppressed embedded listeners | Not a separate delivery mechanism |
| Fixed delay, polling, pointer overlay, scripted publication bridge or sandbox relaxation | Not implemented | Delays cannot establish pointer release; overlays/script grants violate this task's boundaries |

The deferred candidate left `Select and copy this ordin` selected in the iframe. Native Ctrl+C was observed as trusted host-DIV input, and the clipboard read returned no text. With the candidate disabled, native iframe selection/copy worked; a fresh full-sentence selection copied `Select and copy this ordinary publication sentence safely.` with paragraph newlines. The initial empty-selection guard cannot predict a drag that starts after the focus transition. Adding an arbitrary delay is not a reliable release detector.

## Keyboard acceptance

No production before/after improvement exists: the final application remains the accepted baseline. Candidate results above are experiments, not a shipped partial fix.

| Scenario | Observed result |
| --- | --- |
| Paged, host focus: PageDown/PageUp, Right/Left, j/k | Trusted router input; forward/backward position changes |
| Continuous, host focus: PageDown/PageUp, Down/Up, j/k | Trusted router input; page/48px line scrolling observed |
| Host `n` / Shift+N | Trusted router input in both modes; continuous run changed to adjacent chapters and back. Paged placement observations were not a separate proof of exact chapter-target correctness |
| Host `:` / palette Escape | Opens palette and restores host DIV focus in both modes; narrow palette also works |
| Paged or continuous, after text click | PageDown/PageUp, arrows, j/k, n/Shift+N, `:` and Escape produce no shared-router input. Same failure at normal and narrow widths |
| Four repeated host/content focus transitions | Host palette remains operable after explicit host refocus; each content click reproduces missing delivery |
| Paged held PageDown and continuous held j | Multiple native keydowns and navigation observed; position/scroll stable after release |
| Paged j held while focus changes into iframe, released there, then host refocused | No queued navigation after release/refocus during the observation interval |
| Close/reopen; EPUB A → EPUB B; EPUB → PDF → EPUB | Replacement/reopen renders; new EPUB has working initial host input and reproduces the content-focus failure |
| Layout changes and resize | Native palette switches paged/continuous; narrow resize reflows; neither restores content-focused keyboard delivery |

Existing meanings remain unchanged: paged mode uses horizontal arrows; continuous mode uses vertical arrows. No shortcut additions or PDF keyboard modifications.

## Publication interaction checks

| Check | Baseline native result |
| --- | --- |
| A. Click ordinary body text | Focus IFRAME/BODY; keyboard failure reproduced |
| B. Click-drag a sentence | Selection created without embedded JavaScript callbacks; selected text read back from the real Selection |
| C. Copy selected text | Native Ctrl+C copies iframe selection; full-sentence control checked against the X11 CLIPBOARD |
| D. Internal chapter hyperlink | Anchor receives native focus, but the test link does **not** reach its distinct chapter destination; CFI remains unchanged. This is a baseline limitation, not a preserved-success claim or a new fix |
| E. EPUB TOC | Native palette Go to chapter opens real publication entries; native entry click closes palette and changes reading position. Exact destination alignment is not asserted |
| F. Click image | Image remains normally clickable; subsequent reader shortcut input is still lost with iframe focus |
| G. Focusable publication elements | Native input focus/editing works (`note` → `notea`); button focus and space interaction exercised, without asserting a publication-script action |
| H. Return to navigation | Manual host refocus restores command input; automatic reliable return is **not resolved** |

The internal-link result is consistent with epub.js relying on a suppressed `onclick` callback; that causal interpretation is source-supported, not a separate engine-internals trace. No link rewrite/navigation redesign was attempted.

## Security and lifecycle

- `allowScriptedContent` remains false; sandbox remains exactly `allow-same-origin`. No `allow-scripts`, publication executable injection, cross-window messaging or new Tauri capability.
- No file-access, isolation, renderer or shortcut-policy change; no global hooks, OS-wide shortcuts, overlays or pointer interception.
- No production focus listeners/timers were added. Disposable experiment listeners died with their task-owned windows.
- H03B1's live-Document ownership, removal cleanup, same-frame replacement, stale-callback isolation and same-Book replay code is unchanged.
- Its real-WebKit lifecycle suite passed all 13 scenarios: helper keydown/keyup registrations each 86 added / 86 removed; production each 21 added / 21 removed; zero active registrations at teardown, no errors. The actual trim removed 11 views and retained two neighbors. Same-frame replacement, late hooks, disposal/replay, invalid replacement and repeated reopen were included.
- The lifecycle suite's `iframeDispatchDelivered: false` and manually invoked callback check are not native keyboard acceptance evidence.

## Verification and evidence

| Command | Result |
| --- | --- |
| `GDK_SCALE=1 GDK_DPI_SCALE=1 bun test` | 976 passed, 0 failed; 5,201 expectations, 17 files; all six real-WebKit integration suites ran |
| `bunx tsc --noEmit` | Exit 0 |
| `bun run build` | Exit 0; existing large-chunk warning |
| `cargo test --manifest-path src-tauri/Cargo.toml` | Nine tests passed; binary/doc suites contain zero tests |
| `git diff --check` | Exit 0; no output |
| Disposable `native-regression.py WINDOW_ID` | Exit 1: host native `:` positive control passes; native text click focuses iframe; native `:` does not open production palette |

No permanent green regression test is added for an unresolved defect. The targeted native acceptance reproducer is retained with the evidence, reports failure honestly, and is not substituted with a jsdom/synthetic callback test. There is no passing-after implementation to compare.

Evidence archive: `/tmp/clio-09C1-evidence.tar.gz`. It contains labeled `native-acceptance.json`, raw `results.jsonl`, `native-regression-result.json`, widget-native event observations, genuine native screenshots, generated EPUB/PDF inputs and archived disposable harness/reproducer sources. The scripts target this checkout and port 1420; to replay, extract into an isolated directory, start `bun server.mjs`, launch the task-owned native binary with isolated XDG directories (or `gtk-boundary.py` with `GDK_BACKEND=x11`), and run `DISPLAY=:1 python3 native-regression.py TASK_WINDOW_ID`. Never target a user's reader window. The archive is local evidence, not a tracked runtime dependency. Active diagnostics, generated runtime directories and task-owned processes are removed after collection.

The probe's exposed reader getter can outlive an unmounted reader in diagnostic state. Only live DOM iframe inventory is used for close/format-switch observations; stale getter fields are not lifecycle/resource proof. Lifecycle ownership conclusions use the dedicated existing regression suite.

## Supported alternative and smallest next decision

A **GTK-widget-local native input integration feasibility task** is the smallest realistic alternative to browser focus tricks. GTK provides supported [`key-press-event`](https://docs.gtk.org/gtk3/signal.Widget.key-press-event.html) and key-release signals; the native probe received PageDown, n and colon while the sandboxed child supplied no DOM callbacks. It returned false and forwarded nothing. Some press signals appeared twice, so a bridge must not assume one callback equals one new command.

This observation proves a native interception point exists, **not** that a production bridge is safe or complete. A separately authorized proof must establish:

- Access through Clio's Tauri/Wry GTK WebView, scoped to the focused application window and active EPUB reader, with explicit teardown.
- Reuse of `interactions.ts`, not a second shortcut interpreter; correct key/code/modifier/repeat/keyup and focus-loss semantics, including duplicate native notifications.
- Reliable live target/selection classification and default-action ownership, preserving copy, editing, link/button activation and accessibility without async races or double navigation.
- No publication script execution, sandbox/capability change, OS registration or cross-document stale delivery.

**Next decision:** authorize that bounded native-widget integration investigation, or retain the blocker and pursue an upstream WebKit solution for trusted host-owned listener delivery. Neither alternative is implemented here; no claim is made that a currently available WebKit upgrade fixes it. Renderer replacement and security weakening are not proposed.

Physical acceptance, once a viable mechanism exists, still needs both modes/widths: text click → shortcuts; slow/fast drag → copy; internal link and TOC; image and focusable input/button; palette/Escape; held-key focus change/release; close/reopen and EPUB/PDF replacement. XTEST cannot certify touchpad timing, IME, accessibility or all physical keyboard layouts.

## Cleanup

All three task-owned Tauri instances, the visible GTK probe and the three diagnostic server instances were stopped. Their seven recorded process IDs were absent; port 1420 had no listener. No user's Clio process was terminated. The disposable workspace and isolated XDG runtime files were removed after preserving the inert evidence archive. `report.txt` and unrelated repository files were left untouched.
