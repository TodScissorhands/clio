# Reader controls

Shortcuts apply when the reader receives keyboard input and no editor owns it. Ctrl/Cmd means either Control or Meta for shared commands; PDF Control navigation and zoom specifically require Control. Shift shortcuts require Shift, not Caps Lock. Native EPUB content-focused delivery remains limited; the footer **Commands :** button provides an explicit entry point. See [native input evidence](epub-keyboard-focus.md).

## Clio Index

Press `:` or click **Commands :** to open the floating Index in **Normal** mode. The contextual root has six entries: PDF open/search/page/page layout/theme/fit width; EPUB open/search/chapter/layout/theme/typography. Advanced actions remain searchable. EPUB layout toggles Paged/Continuous in place; PDF page layout opens a chooser.

| Mode | Entry and behavior |
| --- | --- |
| Normal | Navigate commands without a text input. `:` enters Command; `/` enters Filter. |
| Command | Type aliases such as `marks`, `chapter`, `theme` or `fit width`. Exact aliases take precedence over prefix matches; `bookmarks` also resolves to `marks`. Enter executes a unique result or one explicitly selected with navigation. |
| Filter | Search the root catalog by labels, identifiers and shortcut text; inside a chooser, filter its entries. Chapter filtering uses titles and destinations. |

Click the **Clio Index** label to enter Filter mode, or the `:` prompt to enter Command mode. These controls also accept Enter/Space when focused. Once an input is active, clicking the prompt focuses it. Drag the header to reposition the panel, including starting over the label or prompt; dragging does not activate them. Position is clamped to the viewport, retained between choosers and reset when reopened.

| Keys | Index behavior |
| --- | --- |
| `j` / `k`, Down / Up | Next/previous enabled entry in Normal mode or with results focused; wraps at ends |
| `gg` / `G` | First/last enabled entry in Normal mode or results |
| `Ctrl+D` / `Ctrl+U` | Move by half the visible list in Normal mode or results |
| Enter | Execute focused entry |
| `l` / Right | Open a focused chooser; ordinary actions use Enter |
| `h` / Left | Return to parent; at root, stay in the Index |
| Escape | Input mode → Normal with query cleared; chooser → parent; root → reader |

In Command/Filter inputs, letters edit the query. Up/Down and Ctrl+P/N select results without leaving the input; Shift-modified variants retain text selection. Tab moves from input to results, where Vim navigation applies; Shift+Tab returns to input. Further Tab presses cycle the available back/prompt controls within the dialog. In Normal mode, focus starts on results. Pointer movement focuses a row; clicking executes it. Applied-setting descriptions are separate from keyboard focus. Escape returns to the host reader, without forcing publication focus.

## Shared reader controls

| Keys | Action |
| --- | --- |
| Ctrl/Cmd+O / Ctrl/Cmd+W | Open/close document |
| Ctrl/Cmd+F or `/` | Open search |
| Enter / Shift+Enter in search | Submit query, then next/previous match with wrapping |
| Escape in an editor | Close editor; PDF search results remain available |
| `i` | Toggle Light/Dark application chrome independently of document theme |
| `:` | Open Index |

## PDF

| Keys | Action |
| --- | --- |
| Ctrl+PageDown / Ctrl+PageUp or Shift+J / Shift+K | Next/previous logical page group at any zoom |
| PageDown / PageUp | In paged view, viewport paging then group navigation at boundary; native scrolling in continuous view |
| `j` / `k`, Down / Up | Vertical pan; native arrows scroll in continuous view |
| `h` / `l`, Left / Right | In paged view, horizontal pan when overflowing, otherwise previous/next group; scrolling in continuous view |
| Home / End | Document beginning/end |
| Ctrl+Home / Ctrl+End | Document beginning/end |
| `g` | Page-number editor; Enter accepts a whole number in range, invalid input remains editable |
| `+` / `-`, Ctrl++ / Ctrl+- | Manual zoom, 5% multiplicative steps; Ctrl+= and Control numpad Add/Subtract also work |
| `=` / `w` / Shift+F | Fit width/page/spread |
| `r` | Toggle saved document recoloring |
| `n` / Shift+N | Next/previous search match |

Groups are single pages or spreads paired 1–2, 3–4, etc.; narrow windows fall back to single pages and navigation clamps at document ends. Shift+PageUp/PageDown retain ordinary page-key behavior. Keyboard zoom preserves the fit basis, limits and viewport-center anchor. Use the Index for view grouping, continuous scrolling, document themes and advanced PDF colors.

## EPUB

| Keys | Action |
| --- | --- |
| `o` | Open document |
| `n` / Shift+N | Next/previous linear chapter |
| `j` / `k`, Right / Left, PageDown / PageUp | Paged: next/previous page |
| `j` / `k`, Down / Up | Continuous: scroll a line |
| PageDown / PageUp | Continuous: scroll a screen |
| `m` | Save a bookmark at the current location |

Continuous line motion uses 40 CSS pixels initially and 160 on accepted native repeats, with one movement in flight; input during motion is dropped. Reduced motion disables animation. Continuous wheel scrolling stays native. No paged wheel policy or Ctrl+Wheel font gesture ships; see [wheel limitations](epub-wheel-input.md).

### Bookmarks

From the Index press `:`, type `marks`, then Enter (`:marks`); bookmarks are outside the six-entry root. Bookmarks are EPUB-only and require a native document session. In the bookmark chooser, use Normal mode or focus results for these controls:

| Keys | Action |
| --- | --- |
| `a` | Add current reading location |
| Space | Toggle focused mark selection and advance |
| `j` / `k`, arrows | Move focus |
| Ctrl+A | Select all only in unfiltered Normal mode |
| `d` | Delete selected marks; focus alone is not selection |
| `u` | Undo last successful removal in the active session |
| Enter / `l` / Right | Navigate to focused bookmark |
| Escape | Clear selection first, then ordinary Index back/close behavior |

Entering filtering/command mode or changing the query clears selection. Unavailable bookmark locations remain listed and are retained. Undo is session-scoped, not durable across closing/reopening. Bookmarks persist separately from reading positions; see [storage](reading-position-storage.md#epub-bookmarks).

## PDF wheel navigation

- Enlarged pages and spreads use native viewport scrolling on both axes. Paged mode contains only the active page group, so scrolling clamps there rather than advancing at its edges. Continuous mode keeps normal scrolling between pages.
- A fully fitted page or spread can turn with unmodified, predominantly vertical wheel input. Movement accumulates to 48 CSS pixels before a turn; line units use 16 CSS pixels and page units use the corresponding reading-viewport dimension. Fractional input does not turn per event, and horizontal-dominant input does not request a page turn.
- One wheel burst can turn at most one logical group, using the same groups as Shift+J/Shift+K. Another action is enabled after 250 ms without wheel input, measured from the last event rather than the last turn. Closely spaced mouse notches can therefore count as one burst, just like a sustained smooth-scroll sequence; this is an intentional safety tradeoff, not device detection.
- Ctrl+Wheel zoom is described below. Other modifier-wheel combinations, search/palette exclusions, keyboard controls, and EPUB navigation retain their existing behavior. Explicit Shift+J/Shift+K navigation remains available on enlarged PDFs.
- Task 08A's normal-wheel behavior passed all eight physical touchpad acceptance checks, including its 250 ms burst policy.

## PDF Ctrl+Wheel zoom

- Over the PDF reading viewport, `Ctrl+Wheel` up zooms in and down zooms out, in the existing 5% multiplicative steps with the existing fit basis and limits. Handled events do not perform ordinary wheel scrolling or turn pages, and remain consumed at zoom limits instead of falling through to WebKit page zoom. Other modifiers, interactive inputs, and active overlays retain precedence.
- Vertical movement accumulates to 48 CSS pixels per step: pixel units are unchanged, line units use 16 CSS pixels, and page units use the reading-viewport height. A reversal or 200 ms idle gap clears partial accumulation. Each event contributes at most one step, with surplus discarded; each animation frame applies at most one step without queuing a backlog. Continued movement can zoom on subsequent frames; this does not use the 250 ms page-turn latch or identify an input device.
- Wheel zoom anchors the position on the PDF page under the pointer, in single-page, spread, and continuous layouts. Page margins/gaps fall back to the current page-group anchor. Native scroll bounds can limit exact anchoring near document edges or when a page fits. Keyboard zoom keeps its viewport-center anchor.
- Task 08C passed all eight physical Ctrl+touchpad acceptance checks. Synthetic native input separately verifies event handling and geometry; physical acceptance covers the tested gestures, not a claim of universal device compatibility. Pinch-specific integration is not implemented.
