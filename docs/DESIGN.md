# Clio interface specification

Engineering, security, lifecycle and verification rules live in [AGENTS.md](../AGENTS.md). This document owns interface decisions, not implementation history.

## Document first

The publication is primary, the external 24px status bar secondary, commands on demand. No persistent settings panel, decorative cards, toolbar or transition animation. New features enter the command hierarchy before acquiring permanent chrome.

Reuse the existing UI font stack, 13px palette text, 11px tabular status text, compact 30–32px command rows and 4/8/12/16px spacing rhythm. The Clio Index is a floating panel centered near the top of the reader, at most 440px wide and 55vh tall, with internal list scrolling, a subtle border and no backdrop dimming. Its header is the drag handle; position is clamped to the reader viewport and resets on reopen.

Publication typography defaults to Publisher. Preserve hierarchy, emphasis, indentation, paragraph spacing, direction and specialized formatting. Optional Latin prose measures target roughly 45–75 characters per line, not a universal RTL/CJK metric. Offer system Serif/Sans, not downloaded fonts. Fixed-layout publications retain publisher presentation; unsupported preferences must be described honestly.

## Independent appearance layers

**Application appearance** controls Light/Dark chrome. **Document theme** controls page colors. **EPUB reading preferences** control typography and column geometry. PDF and EPUB remember document appearance independently.

**Compatibility decision:** `i` toggles application chrome only, in both formats; it no longer inverts unrecolored PDF pages. Document themes alone change page appearance. Preserve all other accepted Task 08 shortcuts. PDF `r` toggles saved recoloring without discarding the remembered theme, custom colors or advanced settings.

|Theme|Background|Foreground|
|---|---|---|
|Original|Publisher/native|Publisher/native|
|Light|`#FFFFFF`|`#202124`|
|Dark|`#1E1E1E`|`#E6E6E6`|
|Sepia|`#FBF0D9`|`#3C3836`|
|Zathura Dark|`#14161B`|`#DCD7BA`|
|Gruvbox Dark|`#282828`|`#EBDBB2`|
|Solarized Dark|`#002B36`|`#839496`|
|Rose Pine Dawn|`#FAF4ED`|`#575279`|

Original means no reader color override, not forced white/black recoloring. Transparent Original EPUB pages use a white backdrop independent of chrome; explicit publisher backgrounds remain. PDF Custom is a truthful extra state, not a stock theme. Selecting Original disables recoloring but retains the saved appearance. Show effective versus saved/off state distinctly; never mark an unapplied saved theme active.

Legacy PDF settings whose preset identity was replaced by `original` retain their exact colors and flags and display as Custom when enabled; do not guess a lost preset identity. The persistent `sepia-warm` ID maps to Sepia without migration. Advanced PDF appearance retains hue/image preservation, lightness adjustment, hexadecimal colors and the saved-color toggle.

EPUB Reset typography/layout leaves its independent theme unchanged. Publisher choices remove only reader-owned overrides. Prefer supported Foliate APIs and a minimal opt-in CSS layer; do not normalize the publication wholesale.

## Commands and focus

Open into a short, contextual root: EPUB has open, search, chapter, layout, theme and typography; PDF has open, search, page, page layout, theme and fit width. Keep the existing catalog searchable so advanced actions and settings remain available. EPUB layout directly toggles Paged/Continuous and stays open; PDF page-layout retains its existing chooser semantics. Theme and layout show current values at the right. Do not add category headings to the root.

Choosers replace the visible list inside the same panel. Preserve a parent's selection and scroll position when returning; Escape and `h`/Left return to the parent. At the root, Escape closes the Index; `h`/Left leaves it open. A compact back control provides pointer access. Chapter filtering searches the EPUB table of contents. The prompt can be clicked to enter command or filter mode, and its unused header space remains draggable.

Choices apply immediately while preserving chooser focus; no Apply/Save buttons. Distinguish requested and applied settings from the keyboard-focused row: selected commands use a soft graphite row and `›`; applied settings use brighter, medium-weight text and accessible state descriptions. Bookmark multi-selection has its own selection semantics. Disabled choices cannot execute. Keep the existing combobox/listbox focus, Tab transitions and active-option visibility. Ordinary actions close the palette; search/jump/color commands replace it with their footer editor. Only one overlay/editor is active.

Escape closes that surface and restores the current host reader target, not publication focus; it cancels unsubmitted jump/color input, not already applied preferences. Closing/replacing a document must not restore focus to a retired reader. Validation errors keep the editor and its value available. With no overlay, Escape does not close the document. Do not intercept publication editing/copy keys or move focus during reading/status updates.

A compact trailing **Commands :** footer button is the explicit entry point, named `Open reader commands (:)`. Hide it during overlays/search/jump/color editing. It is not a pointer overlay or workaround for iframe input delivery.

Align Ctrl/Cmd+O/W and chrome `i`; retain format-specific navigation meanings. EPUB continuous page commands are Next/Previous screen with PageDown/PageUp hints. PDF page hints use unconditional page-navigation shortcuts, not context-dependent pan keys.

Use Open/Close document, Search document, Next/Previous search match, Document theme and Application appearance consistently. Show platform-correct Ctrl/Cmd hints for shared commands. Do not unify `n`: PDF search matches and EPUB chapters retain their accepted meanings. Use Paged/Continuous for presentation, page for a PDF page or paginated EPUB location, screen for continuous EPUB viewport movement, and Text size (not Zoom) for EPUB typography. PDF view grouping and fit scale are distinct controls, not duplicates; retain both with their current state.

Letter case identifies a shortcut, not modifier intent: reverse chapter/search navigation requires `shiftKey` (`Shift+N`), as does PDF page navigation via Shift+J/K. Caps Lock alone retains unshifted n/j/k behavior; intentional Shift shortcuts still work with Caps Lock enabled. Ctrl+PageDown/PageUp remain unconditional PDF page commands.

## EPUB reading preferences

Replace the long all-options list with six small choosers, ordered Text size, Font, Line spacing, Alignment, Margins, Reading column, followed by Reset typography and layout to Publisher. Each entry summarizes its effective value; its choices include the existing Publisher/preset values only. Text size retains Smaller/Larger, its current percentage or Publisher, and existing limits. Back from a field returns to Reading preferences; Back there returns to commands. Root queries still reach qualified leaf choices directly.

Keep Paged/Continuous in the root view commands and Document theme in its own chooser; do not duplicate either under Reading preferences. Reset affects only typography/column geometry, not theme or Paged/Continuous. Suppressed overrides retain their saved choice but state Publisher retained and the reason, never a false Current mark. No new preferences, font downloads, sliders or persistent settings surface.

Continuous EPUB keyboard line/screen movement uses Foliate's short smooth motion, with at most one movement in flight; repeat input during a move is dropped rather than queued. Line keys move 40 CSS pixels initially and 160 on accepted native repeats; screen commands retain their viewport-sized distance. Reduced-motion preference disables that animation. Wheel/touchpad scrolling, paginated turns and Foliate's section-boundary behavior remain native.

## Reader status

Keep the external 24px footer and trailing Commands : control. PDF shows Page current / total, plus the effective recolor theme only when enabled. EPUB shows whole-book percentage first, alongside the first-visible chapter/section label, in both paged and continuous modes. Use Foliate CFI text progress weighted by linear section sizes; exclude `linear="no"` sections. This is geometry-independent for the same CFI, not a renderer page count: typography, column and viewport changes may move the first-visible CFI slightly but must not redefine the book's total. Section weights are publication byte sizes, not exact prose lengths; the rounded percentage is a reading-progress estimate. Omit it when unavailable.

Do not convert Foliate's byte-based locations into pages. Estimated pages remain unavailable: trustworthy totals require laying out actual content under the active font, line spacing, column and viewport geometry, then recounting after geometry changes. Avoid that whole-publication startup/reflow cost. Progress indexes only visited sections lazily and caches their text offsets for the Book session; no second reading-position store is introduced. Keep the filename in the window title, not duplicated in the footer; zoom/view/preference detail belongs in command states.

Show loading, validation and search feedback only when relevant. Footer editors take space before optional theme/section details. Retain a compact current / total matches indicator while PDF results remain active, including after Escape closes the search input; Commands : returns then. No persistent search toolbar or result sidebar.

## PDF search

Keep the existing index, explicit Enter-to-search, wrapped next/previous navigation and temporary highlight layer. Enter/Shift+Enter move forward/backward after results are ready; `n`/`Shift+N` continue from the reader. Escape dismisses input without discarding the query/results. Editing the query clears stale results; submitting an empty query clears search. Document close/replacement clears its search state.

Search caches normalized text and source-offset mappings per PDF page for the in-memory document lifetime. First search still extracts every page; later queries reuse the index. Benchmark with `bun scripts/benchmark-pdf-search.ts [path/to/file.pdf]`.

Normalize PDF source and queries with NFKC, soft-hyphen omission, collapsed/trimmed whitespace and whole-string default-locale lowercase. Preserve original text-layer UTF-16 ranges, including combining sequences split across adjacent items and compatibility expansions; inserted geometry/EOL spaces have no highlight. Search follows PDF.js extraction order, including RTL, not a reconstructed visual reading order. This is normalization equivalence, not full Unicode case folding or accent-insensitive search.

Use borderless, translucent glyph-aligned fills: inactive matches are lighter than the active match. Only the active match has a thin underline with at least 3:1 contrast against controlled page backgrounds. Preserve readable text, selection and copying; highlights never intercept input or get recolored with page pixels. The count and active-only underline distinguish active from other matches without color alone.

On search or explicit next/previous, reveal the whole active match with nearby text, aiming near 40% of the usable viewport height and clamping at page edges. Reveal horizontally too when zoomed. Recompute geometry after zoom, resize, spread/layout changes and rerenders, including detail canvases; keep the active match visible across these transitions without repeatedly snapping back during ordinary scrolling. Ignore stale render callbacks. No animation, results panel or OCR in 09E.

## Responsive and accessible

At 420×600, 1000×700 and 1440×800 CSS px, the footer remains single-line and its 24px reader space remains reserved during overlays. Chapter text can shrink; hide secondary location/theme details first at ≤600px. Preserve editor input, feedback and Commands : when applicable; controls never overlap text or scrolling. The floating Index scrolls internally, hides its visual scrollbar while retaining native scrolling, wraps long labels and keeps shortcut/state text legible. Check increased UI text scale and keyboard-only operation without adding another layout system.

Reader scrollbars remain native: prefer thin CSS scrollbars on the PDF viewport and Foliate's exported scrolled-container part, with fixed normal/hover thickness where supported. Do not create another scroll owner or custom auto-hide subsystem. Overlay visibility/auto-hide and scrollbar styling vary by WebKitGTK/platform; hover enlargement is suppressed only where native CSS styling is honored. In the tested WebKitGTK 2.54.2/GTK 3.24.52 environment, overlay thumbs still enlarge on hover despite these CSS rules; native thumb dragging remains functional in both readers.

Target 4.5:1 controlled-text contrast and 3:1 control/focus/highlight boundaries. Never rewrite publisher/custom palettes to enforce a ratio. Use text/structure, not color alone, for active settings and search matches. Keep EPUB status non-live; announce errors/initial loading once, not scrolling. Status updates never move focus.

Preserve selection, copying, publication link semantics, editable content and keyboard containment; preserving semantics is not a claim that native EPUB hyperlink delivery works. Native input and assistive-technology claims require real testing; document limitations without certification language. In 09E, verify accessible overlay names, current/disabled states, focus return, error/search announcements and highlight contrast in Light/Dark chrome and document themes. Announce explicit search outcomes/match changes without making routine page/scroll updates a live stream.

## 09D review and 09E boundary

09D is approved. 09E-A implements the command hierarchy, guidance, terminology and six EPUB preference choosers specified above; PDF search refinements are implemented in 09E-B. Neither implementation accepts unresolved 09C native EPUB keyboard behavior.

- **Unchanged:** document-first surface, footer dimensions, theme separation/presets, renderer ownership and accepted keyboard/wheel semantics. No toolbar, sidebar, new framework or component rewrite.
- **Design evidence:** inspection and browser smoke of the pre-09E App identified missing chapter Back navigation and one long preference list. In that baseline, PDF active fill was 3% and its count disappeared on Escape while matches remained; 09E-B addressed those separate issues. Browser observations do not establish native WebKitGTK input or assistive-technology acceptance.
- **09E-A:** searchable qualified setting choices and six effective-value preference fields reuse the existing single command router, footer and renderer lifecycle boundaries. Choices apply immediately; typography/layout reset leaves theme and Paged/Continuous unchanged.
- **09E-B:** persistent PDF search status, borderless fills with an active underline, and full-match reveal are implemented according to the specification above. These PDF changes were separate from 09E-A.
- **Deferred:** Persistent highlights, notes and navigation history remain later roadmap work. EPUB bookmarks are implemented: `m` while reading and `:marks` open the feature without changing the six-command root. In the bookmark chooser, `a` adds the current location, Space selects, `j`/`k` move focus, Ctrl+A selects the unfiltered list in Normal mode, `d` removes selected marks, and `u` undoes the last successful removal for the active document. Enter/`l` navigates; Escape clears selection first; filtering clears selection. Bookmark selection has a small checkmark and conditional count. EPUB publication-wide text search is implemented through Foliate with CFI navigation, match count/excerpt and temporary highlights. In-content EPUB hyperlinks remain the known limitation in [Issue #5](https://github.com/TodScissorhands/clio/issues/5), not a claim of completed support. The footer button is an explicit command entry point, not a workaround for publication content keyboard delivery.

Clio Index Normal, Command and Filter modes use one shared reader command router. In Normal mode, `gg`/`G` go to the first/last enabled entry, while `j`/`k`, arrows and `Ctrl+D`/`Ctrl+U` move with wrapping. Command and Filter inputs retain ordinary typing; arrows and Ctrl+N/P select results while input focus remains. Tab moves focus to the matching list, where Vim motions and Enter operate; Shift+Tab returns to the input. Escape returns from input mode to Normal, from a chooser to its parent, or closes at root. No permanent keyboard-instruction footer is shown. List scrolling uses the existing native scroll container, with its visual scrollbar hidden.

The complete user-facing key reference, Index modes and bookmark management controls are in [reader controls](reader-controls.md).
