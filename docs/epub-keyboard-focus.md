# Task 09C1 — EPUB keyboard focus: blocked on the tested WebKitGTK boundary

## Reconciliation status

Reviewed against `origin/master` at `ebbb079` on 2026-11-08. Task 09C1 and Task 10B below are historical reports; their measurements, cleanup statements and proposed next steps are not current acceptance or authorization to repeat the probes.

- **09C-A1:** [merged PR #2](https://github.com/TodScissorhands/clio/pull/2) corrected acquisition retirement and a pre-existing fractional-page visibility defect that could save the preceding chapter's CFI. Task 10B's successful fixture reopen remains a scoped observation, not proof that all chapter positions were correct. See [the final native acceptance](epub-trusted-surface-prototype.md#final-native-acceptance-and-review-handoff).
- **09C-A2:** [draft PR #4](https://github.com/TodScissorhands/clio/pull/4) records the trusted shell's opaque-origin stop: nested `contentDocument` was null and access threw `SecurityError` in both `srcdoc` and `write` trials. No trusted-surface implementation shipped; neither publication scripting nor relaxing isolation is authorized.
- **09C-A3:** [Issue #5](https://github.com/TodScissorhands/clio/issues/5) records destination URLs reaching Tauri's URL-only callback, but Wry 0.57.1 handles `NavigationAction` before a later `with_webview()` policy handler. WebKit's general asynchronous-policy API and Task 10B's observed signal therefore do not establish a usable Clio interception path, live source attribution or generation-safe routing. A3 shipped no production change.
- **Current decision:** in-content EPUB hyperlinks are deferred under Issue #5, not a 09D blocker. Ordinary reading keyboard/focus reliability remains unresolved; 09C is not fully accepted. The [roadmap](ROADMAP.md#09c-acceptance-and-deferred-hyperlinks) owns priorities and the unchanged wheel policy. This report does not start another prototype, renderer migration or 09E implementation.

### Historical evidence availability

The recorded `/tmp/clio-09C1-evidence.tar.gz` and `/tmp/clio-10b-native-evidence.tar.gz` archives, `/tmp/clio-h03a-9zkfbh9n/H03A-audit.md` and `/tmp/clio-h03b1-p9oz0a25/H03B1-report.md` are absent at their documented paths. A scoped search of Clio project/worktree and temporary evidence names found no Task 10B replacement archive. The historical contents, hashes and native measurements below have not been revalidated from raw artifacts in this reconciliation. They are not available downloads or currently reproducible archive-based checks; replay instructions require recovering and verifying the original archive first.

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

No permanent green regression test was added for the unresolved defect. The historical report recorded a failing native acceptance reproducer with its evidence, rather than substituting a jsdom/synthetic callback test. That reproducer's archive is now unavailable at the recorded path; there is no passing-after implementation to compare.

Historical evidence archive: `/tmp/clio-09C1-evidence.tar.gz`, **now unavailable at the recorded path**. It was reported to contain labeled `native-acceptance.json`, raw `results.jsonl`, `native-regression-result.json`, widget-native observations, native screenshots, generated inputs and disposable harness sources. The original replay instructions require recovering this archive: extract into an isolated directory, start `bun server.mjs` on port 1420, launch a task-owned native binary with isolated XDG directories (or `gtk-boundary.py` with `GDK_BACKEND=x11`), and run `DISPLAY=:1 python3 native-regression.py TASK_WINDOW_ID`. Never target a user's reader window. These instructions were not rerun during reconciliation.

The probe's exposed reader getter can outlive an unmounted reader in diagnostic state. Only live DOM iframe inventory is used for close/format-switch observations; stale getter fields are not lifecycle/resource proof. Lifecycle ownership conclusions use the dedicated existing regression suite.

## Supported alternative and smallest next decision

A **GTK-widget-local native input integration feasibility task** is the smallest realistic alternative to browser focus tricks. GTK provides supported [`key-press-event`](https://docs.gtk.org/gtk3/signal.Widget.key-press-event.html) and key-release signals; the native probe received PageDown, n and colon while the sandboxed child supplied no DOM callbacks. It returned false and forwarded nothing. Some press signals appeared twice, so a bridge must not assume one callback equals one new command.

This observation proves a native interception point exists, **not** that a production bridge is safe or complete. A separately authorized proof must establish:

- Access through Clio's Tauri/Wry GTK WebView, scoped to the focused application window and active EPUB reader, with explicit teardown.
- Reuse of `interactions.ts`, not a second shortcut interpreter; correct key/code/modifier/repeat/keyup and focus-loss semantics, including duplicate native notifications.
- Reliable live target/selection classification and default-action ownership, preserving copy, editing, link/button activation and accessibility without async races or double navigation.
- No publication script execution, sandbox/capability change, OS registration or cross-document stale delivery.

**Historical next decision:** authorize a bounded native-widget investigation, or retain the blocker and pursue an upstream WebKit solution. Task 10B and the subsequent 09C findings above now qualify that proposal; it is not a current instruction to restart it. No available WebKit upgrade is established here as a fix. Renderer replacement and security weakening are not proposed.

Physical acceptance, once a viable mechanism exists, still needs both modes/widths: text click → shortcuts; slow/fast drag → copy; internal link and TOC; image and focusable input/button; palette/Escape; held-key focus change/release; close/reopen and EPUB/PDF replacement. XTEST cannot certify touchpad timing, IME, accessibility or all physical keyboard layouts.

## Cleanup

All three task-owned Tauri instances, the visible GTK probe and the three diagnostic server instances were stopped. Their seven recorded process IDs were absent; port 1420 had no listener. No user's Clio process was terminated. The disposable workspace and isolated XDG runtime files were removed after preserving the inert evidence archive. `report.txt` and unrelated repository files were left untouched.

## Task 10B — native Wayland feasibility

### Decision gate

**Keyboard: an application-local native boundary exists; a safe command bridge is not established. Internal links: native navigation policy is observable; safe publication-owned interception is not established. No production correction is applied.**

The keyboard candidate is the current window's Tauri `with_webview().inner()` WebKitGTK handle, widget-local key press/release and focus signals, and a generation-scoped delivery boundary into the existing `reader/interactions.ts` router. It is not a second shortcut interpreter. Native signals bypass the sandbox's JavaScript-listener restriction, but observing a signal is insufficient to ship this candidate.

The link candidate is Tauri's application-scoped plugin `on_navigation(&Webview, &Url)` boundary, or the underlying WebKit navigation policy decision, followed by validated routing through the active Book and `EpubReader.navigateToHref()`. No native callback is connected to either candidate's production command/navigation path.

| Requirement | Evidence / remaining blocker |
| --- | --- |
| A. Actual WebView input | The actual Tauri process's `WebKitWebView` receives native press/release callbacks with iframe BODY, input and button focus. |
| B. Window / document ownership | The widget and native toplevel are identifiable. Focus transitions are observable. The live EPUB/Book/Document identity remains host-owned; safe native-to-reader generation synchronization is not demonstrated. |
| C. Duplicates / repeat / release | The same WebView callback can receive a press twice with identical GDK timestamp, hardware code and event pointer. Host repeat, content-focus release and native-window focus loss were exercised, but no bridge deduplication/repeat protocol was implemented or proven. |
| D. Browser-default ownership | **Safety-critical blocker.** GTK needs a synchronous handled/default decision. Supported host DOM target/selection inspection is asynchronous. The observer returns false, preserving copying, editing and control activation; it does not establish that a forwarding bridge can synchronously distinguish those cases and consume only Clio commands. |
| E. Sole router | The existing router's entry and actual actions were observed. Content-focused events never reach it. Forwarding without duplicate DOM/native execution or losing native default behavior is unproven. |
| F. Lifecycle | Existing live-Document teardown is unchanged. Baseline close/reopen, replacement and held-key transitions passed the scoped observations below. They do not prove a new native bridge's ownership or delayed-callback cancellation. |
| G. Practicality / security | GTK/WebKit signals and Tauri's raw WebView access are available. Disposable probes use installed system libraries only. A maintainable production mechanism satisfying B–F without new dependencies or security changes is not established. |

Do not consume every key and later replay browser defaults, forward every native notification, cache target/selection state as an event-time guarantee, or restore host focus automatically. None of those workarounds is shipped or asserted safe.

### Native provenance and method

- Starting point: `master`, `df6452d47b744ad1999aea090b6313a5305eacd5`; existing modified `package.json`/`bun.lock` and untracked `report.txt` were preserved.
- Arch Linux, niri `26.04 (8ed0da4)`, WebKitGTK `2.52.6`; locked Rust sources expose Tauri `2.12.5`, tauri-runtime-wry `2.12.3`, Wry `0.57.1`.
- The actual task-owned Clio debug binary ran with `GDK_BACKEND=wayland`. Discovery recorded `GdkWaylandDisplay`, not X11/Xwayland. The authoritative run used PID `47298`, niri window `21`, isolated XDG data/config/cache, and a fresh production-mode bundle of the current App/readers/router.
- The existing native binary was reused, not freshly packaged: SHA-256 `ad8b19f07a30cbc43723478e1a9baeefc9942d9d83f6f097b1ea7107024287dd`. No claim of fresh packaged-binary provenance is made.
- Native input used niri's advertised virtual-keyboard and virtual-pointer Wayland protocols, compiled against installed `wayland-client`/`xkbcommon`. No JavaScript keyboard/pointer dispatch, global input hook or new dependency was used. Each batch checked that the task-owned native window was focused; a separate task-owned GTK window supplied the focus-loss control.
- A process-local pass-through C observer recorded the actual WebView's GTK signals, WebKit policy decisions and asynchronous host-only DOM snapshots. Ordinary key callbacks returned false; emission hooks only observed. It did not invoke commands, make navigation decisions, change focus or execute publication scripts.
- The display was 1536×864 logical px at compositor scale 1.25; the authoritative reader viewport was 1000×720 CSS px with measured WebView DPR 2. Native pointer coordinates used niri window placement, not a guessed DPR multiplier. A native window screenshot was recorded in the now-unavailable archive below.
- An unrelated IPv6 localhost dev server appeared during setup. The authoritative task processes used a disposable localhost-to-127.0.0.1 resolver preload to reach their private IPv4 diagnostic host while retaining the configured localhost origin. The preliminary IP-origin run produced a Tauri IPC denial and is not used as canonical-path acceptance evidence. No unrelated server/window was stopped and no Tauri permission was broadened.

### Exact keyboard and interaction evidence

Paged host PageDown moved `epubcfi(/6/2!/4/2[destination]/1:0)` to `epubcfi(/6/2!/4/36[p12]/1:0)`; PageUp returned. Each added one router keydown and one page action. Host colon/Escape opened/closed the real palette and returned focus to the host reading area.

After a native text click, the top active element was IFRAME and the embedded active element BODY. Nine native shortcut presses added **zero** router keydowns in each mode: paged count stayed 10, continuous count stayed 68. Paged tested colon, PageDown/PageUp, Right/Left, j/k and n/Shift+N; continuous used Down/Up in place of Right/Left. The captured reading CFI did not change. Continuous scroll had a 1px rounding difference, not a Clio navigation action.

For one content-focused PageDown, two actual WebView handler callbacks recorded GDK time `6696906`, hardware code `117`, event pointer `0x55f70f69a030`, at monotonic times `6696907061` and `6696908354` microseconds. Widget-level notification count is therefore not command count. The first 16 sampled content-focused host-snapshot callbacks arrived 665–2261 microseconds after submission; they were asynchronous observations, not synchronous default-action authority.

| Native scenario | Observed result |
| --- | --- |
| Palette execution and Escape | Native typing/Enter executed layout and TOC commands; Escape closed the palette. The real footer Commands button provided explicit access after content focus. |
| Drag selection / Ctrl+C, both layouts | Actual `wl-paste --type text/plain --no-newline` returned exactly `Native clipboard sentence stays intact.` (39 characters), matching the real iframe Selection. |
| Embedded input, both layouts | Native typing changed `note` to `noteabc:` in paged and `notexyz:` in continuous. Colon remained input text, not a Clio command. |
| Embedded button / image, both layouts | Native click focused the button and Space was sent there; image clicks returned ordinary content focus. No publication-script action or observable button action is claimed for the script-free button. |
| Continuous host navigation | PageDown changed scrollTop 3357→3948; PageUp returned to 3356. j/k added paired 48px reader scroll actions. |
| Held j into iframe, both layouts | Host repeat navigated. Release in content was followed by explicit footer/palette/Escape return; no queued navigation appeared during the subsequent 600ms observation. |
| Native window focus loss | Held j was released in a separate task-owned GTK focus window. Returning to Clio left CFI/scroll stable during the subsequent 600ms observation. |
| Layout / resize | Native palette switched both layouts; native 1000→720→1000px window resizing exercised reflow. Paged stage dimensions were checked, not only the outer window. |
| Close/reopen / replacement | Close left no live EPUB iframes; canonical-path reopen restored its saved CFI. A→B, EPUB→PDF→EPUB rendered correctly. New host input worked; new content clicks reproduced missing delivery. |
| Held-key format replacement | While j remained held, EPUB was replaced by PDF. Further PDF router events added no old EPUB page/scroll actions (counts stayed 28/25); after release and reopening B, its CFI stayed stable for 650ms. |

These are baseline/observer-only results, not a passing native bridge regression. Native GTK focus-out can precede an updated `window_active` query; use the focus transition itself rather than treating one cached active-state sample as an ownership guarantee.

### Independent internal hyperlink finding

The script-free fixtures contain three distinct chapters. Paged chapter 1→2 and continuous chapter 2→3 native anchor clicks produced `WEBKIT_POLICY_DECISION_TYPE_NAVIGATION_ACTION` (0), `WEBKIT_NAVIGATION_TYPE_LINK_CLICKED` (0), `user_gesture=true`, button 1, modifiers 0, and `frame_name=null`.

- Paged request: `http://localhost:1420/EPUB/chapter-1.xhtml#destination`, monotonic time `6757802882` microseconds.
- Continuous request: `http://localhost:1420/EPUB/chapter-2.xhtml#destination`, monotonic time `6892496836` microseconds.
- The diagnostic HTTP host recorded the corresponding `/EPUB/chapter-*.xhtml` GETs and deliberately returned 404: these paths are archive members, not host routes. The child Document was replaced by that HTTP response; rendition ownership did not move to the intended chapter. This identifies native fallback navigation outside epub.js, not CFI-string corruption.
- Native TOC controls used the existing owner correctly: paged reached chapter index 1 / `epubcfi(/6/4!/4/2[destination]/1:0)`; continuous reached index 2 / `epubcfi(/6/6!/4/2[destination]/1:0)`.

Installed epub.js `Contents.linksHandler()` calls `replaceLinks()`, which installs an embedded `onclick`. Its `linkClicked` event normally reaches `Rendition.handleLinks()`, resolves against `book.path`, then calls `display()`. Under the existing sandbox, that listener invocation is suppressed; the native request above remains observable outside that boundary.

Tauri's plugin navigation callback supplies WebView and URL, not source iframe/Document identity. The lower-level decision observed here also supplied no frame name. Books A and B intentionally use the same resolved member URLs, demonstrating that URL alone does not identify the owning publication generation.

WebKit supports [retaining a policy decision asynchronously](https://webkitgtk.org/reference/webkit2gtk/stable/signal.WebView.decide-policy.html), unlike the synchronous GTK key handled/default result. This makes native link interception a plausible independent mechanism, not an established impossibility. It still needs proven live-source/publication generation ownership, normalized archive/spine destination validation, stale-decision cancellation and explicit separation of external URLs, unsafe schemes and top-level/new-window navigation before calling the existing `navigateToHref()` path. External/unsafe activations and those cancellation cases were not safety-proven; no blanket URI allowlist, blanket deny, link rewrite or partial implementation is shipped.

### Reproduction and retained evidence

Historical evidence archive: `/tmp/clio-10b-native-evidence.tar.gz`, **now unavailable at the recorded path**. It was reported to contain script-free inputs, diagnostic server/C sources, Wayland protocol sources, a native screenshot, `acceptance.json`, clipboard results, `evidence-summary.json`, `host-events.jsonl`, `host-results.jsonl` and `native-final.jsonl`, with preliminary startup/origin diagnostics named separately. The following historical replay instructions are conditional on recovering and verifying that archive; they are not currently runnable from this repository alone.

1. Extract the archive into an isolated directory; adjust its diagnostic scripts' workspace path if necessary. Build the two C helpers with installed system headers/libraries as described in their sources, generate protocol sources with `wayland-scanner`, and run `python3 create-documents.py`.
2. Start `bun server.mjs` on free IPv4 port 1420. Launch only a task-owned Clio instance with isolated XDG directories, `GDK_BACKEND=wayland`, the observer preload and trusted snapshot origin `http://localhost:1420`. The archived resolver preload is only needed to avoid the unrelated IPv6 listener; it is not application code.
3. Use the host-only `/__control` acquisition command to open `native-a.epub`; this bypasses the picker, not the real App/renderer lifecycle. Position the task window and derive native pointer coordinates from its niri geometry plus recorded DOM rectangles.
4. Run the archived `wayland-input` emitter. Host colon is `mods 1`, `key 39 1`, `wait 60`, `key 39 0`, `mods 0`; PageDown/PageUp use evdev codes 109/104; Escape uses 1. Commands acknowledge completion after a compositor roundtrip.
5. For the recorded 1000×720 viewport/window origin (52.8,79.2), ordinary text was clicked at output-logical (144,176). Repeating the shortcut sequence there leaves router counts unchanged. Dragging the sentence approximately (93,176)→(423,176), then Ctrl+C (`mods 4`, key 46 press/release, `mods 0`) allows comparison with actual `wl-paste` output.
6. Use the real footer/palette to change layouts and choose TOC chapters, click the visible cross-chapter links, then compare policy URLs, child Document URLs and rendition indices. Keep the emitter/window identity guard; never target an existing user reader.

No new permanent test is added for an unresolved mechanism. Production source, security configuration, permissions, dependencies and existing tests are unchanged; the conditional production-change verification gates are not rerun for this documentation-only outcome. This probe does not certify physical keyboard/touchpad timing, all keyboard layouts, IME, accessibility, other compositors, other WebKit versions or packaged applications.

### Task 10B cleanup and final checks

All 15 recorded task-owned process IDs were absent at cleanup; the authoritative Tauri app, focus control and input emitter exited with code 0. Native teardown logged both widget destruction and removal of observer hooks/handlers with pending snapshots cancelled. The diagnostic HTTP host was stopped; no user's Clio session or unrelated server was terminated.

At original cleanup, `gzip -t` was reported to pass before the disposable source/runtime workspace and isolated XDG directories were removed. Recorded archive SHA-256: `91c8c1c4eb36ce8ac31c2902b6a1931b0d6b6c0db7f2910ccae92ff8f52db103`. Neither that integrity check nor the hash could be repeated with the archive unavailable.

At the original Task 10B handoff, only `README.md` and this report were task-owned repository changes; protected-file hashes were reported unchanged, the index empty and `git diff --check` passing. No commit or push had been made at that historical point.
