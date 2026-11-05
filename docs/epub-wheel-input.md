# EPUB wheel input — delivery works; safe paged interception is blocked

## Outcome

**No paged wheel implementation ships.** Native continuous scrolling remains unchanged. Trusted, cancellable wheel events reach Clio's host viewport over publication content, but the tested browser boundary does not expose reliable primary-button state at wheel delivery. A candidate could turn a page during a held press before text selection existed. A CSS-state guard improved the settled case but failed queued native input; it was rejected rather than shipped as a fragile workaround.

This result is specific to the tested WebKitGTK configuration. It is not inferred from the separate [keyboard-focus limitation](epub-keyboard-focus.md), and it does not establish that every WebKit version behaves identically. No publication scripts, sandbox change, GTK hook, focus theft, overlay or Ctrl+Wheel font gesture is introduced.

## Native method and provenance

- Starting source: accepted `33412524b9873b98adf954c5f35e08d91bd8d032`; the later candidate integrated with the verified 09C typography/preferences and shared appearance implementation.
- Fresh task-owned Tauri debug compilation in separate `CARGO_TARGET_DIR` and XDG config/data/cache roots. `tauri dev --no-watch` used a temporary config pointing at a fresh production-mode observation bundle on `127.0.0.1:15420`, with no before-dev command. Production native configuration/capabilities and the epub.js patch were untouched.
- Linux x64, X11/Xwayland, WebKitGTK **2.52.6**, GTK **3.24.52**, xdotool **4.20260303.1**. Process-local `GDK_BACKEND=x11 GDK_SCALE=1 GDK_DPI_SCALE=1`; measured WebView DPR **1.25**.
- Real generated EPUBs opened through the native file picker. The bundle retained the production App, readers, routing and patched engine. Trusted-host-only observation did not insert executable publication content; iframe sandbox remained exactly `allow-same-origin`.
- X11/XTEST supplied wheel buttons 4/5, native clicks/drags and palette interaction. Host/embedded Window/Document, viewport and iframe targets were observed. Native input and actual offsets/CFIs were checked; no installed input callback was manually invoked as delivery proof.
- Initial normal/narrow probes used 761×829 and 448×600 CSS px. Candidate input additionally used a calibrated **420×600** viewport. Picker/activation can restore window-manager geometry: only records calibrated after opening count as narrow acceptance. Early mislabelled narrow candidate records are superseded.
- X11 PageUp/PageDown injection uses `Prior`/`Next`, verified as trusted DOM PageUp/PageDown. Early `PageUp` alias attempts delivered no DOM key event and are not keyboard-boundary evidence.

## Delivery and default-action observations

| Native scenario | Observed result |
| --- | --- |
| Footer positive control | Trusted host wheel, cancellable pixel deltas. |
| Ordinary text, paged/continuous, host/content focus | Host Window/Document/viewport/iframe receive wheel retargeted to IFRAME. Embedded Window/Document callbacks remain silent. Baseline paged input does not turn a page. |
| Continuous ordinary text | Normal container scrollTop 106→188 and narrow 188→253, with relocated CFI changes. |
| Temporary host preventDefault control | Corresponding offsets stay 188→188 and 253→253, with unchanged CFIs. Cancellation stops actual native scrolling, not merely a JavaScript flag. |
| Image/link/input/button | Event-time frame-rectangle translation plus embedded `elementFromPoint` identifies the actual target. Live activeElement identifies focused input/button. |
| Native selected text | Live Selection is readable despite suppressed embedded selection callbacks. |
| Nested scroller | Child scrollTop 0→82→164 without host/embedded callbacks; outer position unchanged. At its end host scroll-chaining events resume, and the nested ancestor remains identifiable (719 scrollTop, 80 clientHeight, 799 scrollHeight). |
| Translated paged iframe | At outer scrollLeft 761 / frame x −760.8, hit-testing resolves visible P#p3 correctly. |
| Shift+wheel | Native horizontal delta 82, vertical delta 0; left unmodified. |

## Rejected candidate and decisive failure

The candidate used one Book-scoped nonpassive host-viewport listener, existing live-Document ownership, synchronous hit-testing/Selection/focus/nested-scroller guards, 48px accumulation and 250ms quiet-boundary burst consumption. It queued no future turn and left continuous scrolling native. Deterministic policy and real-WebKit adapter/lifecycle checks passed. These results were insufficient:

1. Tauri/XTEST after ordinary text focus: six 40ms-spaced notches produced one logical transition, **0→761** normally and **0→420** at calibrated 420px width. Reverse bursts returned one group. Controls, links, media, nested scrolling and active input focus were excluded in the tested cases.
2. A native primary-button hold with collapsed Selection then wheel produced **0→420**: the event was trusted but `WheelEvent.buttons` was **0**. The original guard could not detect the held pointer.
3. Reading the embedded root's standard `:active` chain looked promising: HTML/BODY/P matched while the press was settled and stopped matching after release. No pointer callbacks were required.
4. A task-owned visible GTK/WebKit production-App regression queued XTEST mousedown and wheel while returning control to the native event loop. At actual wheel delivery the record was **`trusted:true, buttons:0, activeAtDelivery:false, prevented:true`**. After the queue settled the root was active. The calibrated viewport had not changed. The CSS-state guard therefore read stale press state and intercepted the held gesture before a selection existed.

The fourth case is a native ordering/safety failure, not a synthetic WheelEvent or a manually called router. The test always released its task-owned mouse button in cleanup. The candidate, its wheel-only unit/runtime additions and temporary runner were removed from the production worktree. No red test is disguised as a passing permanent regression for an unshipped feature.

Adding a delay, polling, a host-only partial pager or a refocus trick cannot establish the missing event-time ownership guarantee and is not adopted. Continuous native scrolling does not require this interception and remains available.

## Evidence, alternatives and limits

- `/tmp/clio-09c-wheel-evidence.tar.gz`: initial delivery/cancellation/hit-testing probe, generated EPUB, observation bundle/scripts, labelled native records, fingerprints and genuine native-window screenshots.
- `/tmp/clio-09c-wheel-candidate-failure.tar.gz`: rejected candidate source and its native regression harness. It is inert evidence, not runtime code or a green test suite. The final milestone evidence archive also retains the decisive queued-pointer failure output and candidate Tauri records.
- A realistic supported direction is an upstream WebKit correction preserving pressed-button data/order on retargeted wheel events, or a **separately authorized** widget-local native input feasibility task. No available upgrade is claimed to fix this; native GTK integration is outside 09C.
- Physical touchpad momentum, native Wayland, IME and assistive technology were not certified. Future physical acceptance must include slow/fast and separated bursts, diagonal input/reversal, momentum during reflow, held presses before selection, drag/copy, links/controls and nested-scroll boundaries in both layouts/widths.
- Content-focused keyboard delivery and internal hyperlink activation remain unresolved. This investigation does not repair either boundary or change PDF input behavior.
