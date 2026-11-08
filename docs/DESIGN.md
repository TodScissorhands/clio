# Clio interface specification

Engineering, security, lifecycle and verification rules live in [AGENTS.md](../AGENTS.md). This document owns interface decisions, not implementation history.

## Document first

The publication is primary, the external 24px status bar secondary, commands on demand. No persistent settings panel, decorative cards, toolbar or transition animation. New features enter the command hierarchy before acquiring permanent chrome.

Reuse the existing UI font stack, 13px palette text, 11px tabular status text, 28px minimum command rows and 4/8/12/16px spacing rhythm. Retain the full-screen command palette; fix functional overflow rather than redesigning its geometry.

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

EPUB Reset typography/layout leaves its independent theme unchanged. Publisher choices remove only reader-owned overrides. Prefer supported epub.js APIs and a minimal opt-in CSS layer; do not normalize the publication wholesale.

## Commands and focus

Keep one format-aware root, ordered as file actions, search/jump, navigation, view/layout, then appearance. Retain direct reading commands; do not add category screens for ordinary navigation. Root appearance entries remain Document theme…, EPUB Reading preferences… and Advanced PDF appearance…. Nonempty root queries search their setting subcatalogs; qualify leaf labels (e.g. Document theme: Sepia) and deduplicate stable keys. Chapter filtering stays in Go to chapter…, not document text search.

Every chooser, including chapters, provides an explicit Back row to its parent; entering or leaving a chooser clears its local query and selects the first row. Escape always closes the entire overlay, not one hierarchy level. Show a short, noninteractive palette hint for arrow selection, Enter and Escape; retain the Commands : entry rather than adding a help panel.

Choices apply immediately while preserving chooser/filter focus; no Apply/Save buttons. Distinguish requested and applied settings. Disabled choices cannot execute. Keep the existing combobox/listbox containment, Tab containment and active-option visibility. Ordinary actions close the palette; search/jump/color commands replace it with their footer editor. Only one overlay/editor is active.

Escape closes that surface and restores the current host reader target, not publication focus; it cancels unsubmitted jump/color input, not already applied preferences. Closing/replacing a document must not restore focus to a retired reader. Validation errors keep the editor and its value available. With no overlay, Escape does not close the document. Do not intercept publication editing/copy keys or move focus during reading/status updates.

A compact trailing **Commands :** footer button is the explicit entry point, named `Open reader commands (:)`. Hide it during overlays/search/jump/color editing. It is not a pointer overlay or workaround for iframe input delivery.

Align Ctrl/Cmd+O/W and chrome `i`; retain format-specific navigation meanings. EPUB continuous page commands are Next/Previous screen with PageDown/PageUp hints. PDF page hints use unconditional page-navigation shortcuts, not context-dependent pan keys.

Use Open/Close document, Search document, Next/Previous search match, Document theme and Application appearance consistently. Show platform-correct Ctrl/Cmd hints for shared commands. Do not unify `n`: PDF search matches and EPUB chapters retain their accepted meanings. Use Paged/Continuous for presentation, page for a PDF page or paginated EPUB location, screen for continuous EPUB viewport movement, and Text size (not Zoom) for EPUB typography. PDF view grouping and fit scale are distinct controls, not duplicates; retain both with their current state.

## EPUB reading preferences

Replace the long all-options list with six small choosers, ordered Text size, Font, Line spacing, Alignment, Margins, Reading column, followed by Reset typography and layout to Publisher. Each entry summarizes its effective value; its choices include the existing Publisher/preset values only. Text size retains Smaller/Larger, its current percentage or Publisher, and existing limits. Back from a field returns to Reading preferences; Back there returns to commands. Root queries still reach qualified leaf choices directly.

Keep Paged/Continuous in the root view commands and Document theme in its own chooser; do not duplicate either under Reading preferences. Reset affects only typography/column geometry, not theme or Paged/Continuous. Suppressed overrides retain their saved choice but state Publisher retained and the reason, never a false Current mark. No new preferences, font downloads, sliders or persistent settings surface.

## Reader status

Keep the external 24px footer and trailing Commands : control. PDF shows Page current / total, plus the effective recolor theme only when enabled. EPUB shows the first-visible chapter/section label, with Page current / total in section only when the paginated layout supplies it. Continuous EPUB must not invent page counts, percentages or estimated reading time. Keep the filename in the window title, not duplicated in the footer; zoom/view/preference detail belongs in command states.

Show loading, validation and search feedback only when relevant. Footer editors take space before optional theme/section details. Retain a compact current / total matches indicator while PDF results remain active, including after Escape closes the search input; Commands : returns then. No persistent search toolbar or result sidebar.

## PDF search

Keep the existing index, explicit Enter-to-search, wrapped next/previous navigation and temporary highlight layer. Enter/Shift+Enter move forward/backward after results are ready; `n`/`N` continue from the reader. Escape dismisses input without discarding the query/results. Editing the query clears stale results; submitting an empty query clears search. Document close/replacement clears its search state.

Replace near-transparent fills with a clearly visible controlled fill and solid active outline; other matches use a lighter fill and dashed boundary. Preserve readable text, selection and copying; highlights never intercept input or get recolored with page pixels. The count and different boundary styles distinguish active from other matches without color alone.

On search or explicit next/previous, reveal the whole active match with nearby text, aiming near 40% of the usable viewport height and clamping at page edges. Reveal horizontally too when zoomed. Recompute geometry after zoom, resize, spread/layout changes and rerenders, including detail canvases; keep the active match visible across these transitions without repeatedly snapping back during ordinary scrolling. Ignore stale render callbacks. No animation, results panel or OCR in 09E.

## Responsive and accessible

At 420×600, 1000×700 and 1440×800 CSS px, the footer remains single-line and its 24px reader space remains reserved during overlays. Chapter text can shrink; hide secondary location/theme details first at ≤600px. Preserve editor input, feedback and Commands : when applicable; controls never overlap text or scrolling. The existing full-screen palette scrolls internally, wraps long labels and keeps shortcut/state text legible; its compact hint must not displace the active option. Check increased UI text scale and keyboard-only operation without adding another layout system.

Target 4.5:1 controlled-text contrast and 3:1 control/focus/highlight boundaries. Never rewrite publisher/custom palettes to enforce a ratio. Use text/structure, not color alone, for active settings and search matches. Keep EPUB status non-live; announce errors/initial loading once, not scrolling. Status updates never move focus.

Preserve selection, copying, publication link semantics, editable content and keyboard containment; preserving semantics is not a claim that native EPUB hyperlink delivery works. Native input and assistive-technology claims require real testing; document limitations without certification language. In 09E, verify accessible overlay names, current/disabled states, focus return, error/search announcements and highlight contrast in Light/Dark chrome and document themes. Announce explicit search outcomes/match changes without making routine page/scroll updates a live stream.

## 09D review and 09E boundary

This is one proposed design awaiting user approval before 09E; it is not an implemented UI or 09C acceptance.

- **Unchanged:** document-first surface, full-screen shared palette, footer dimensions, theme separation/presets, renderer ownership and accepted keyboard/wheel semantics. No toolbar, sidebar, new framework or component rewrite.
- **Evidence:** inspection of `interactions.ts`, `ReaderCommandPalette.tsx`, `appearanceCommands.ts`, both readers and their styles; browser smoke of the existing App with real PDF/EPUB fixture documents at the three target sizes. The chapter chooser lacks Back; preferences expose all values in one scrolling list; PDF active fill is 3% and its count disappears on Escape while matches remain. These justify the refinements above, not an architecture investigation. Browser observations do not establish native WebKitGTK input or assistive-technology acceptance.
- **09E:** implement the hierarchy/Back/hint and terminology refinements, consolidate preferences into field choosers, retain relevant search status, and strengthen/reposition PDF highlights. Reuse existing palette, footer and renderer lifecycle boundaries; verify the transitions above, selection/copy and responsive/accessibility behavior.
- **Approval needed:** the six-field preference hierarchy (one extra step, less scanning), retained search count after Escape, and the specified active-match visibility/reveal behavior. Retaining one-step Escape-to-reader is intentional; Back rows handle hierarchy navigation.
- **Deferred:** EPUB publication-wide search, bookmarks, annotations and navigation history belong to later roadmap work. In-content EPUB hyperlinks remain the known limitation in [Issue #5](https://github.com/TodScissorhands/clio/issues/5), not a 09D blocker. Ordinary EPUB keyboard/focus reliability remains an unresolved essential-reading requirement; the footer button is not its fix. No new renderer prototype or wheel gesture is authorized here.
