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

Root commands expose Document theme, EPUB Reading preferences and PDF Advanced appearance. Keep advanced color/engine controls available without flooding the root. Nonempty root queries search their subcatalogs; stable keys deduplicate results. Submenus filter locally and provide Back to commands.

Choices apply immediately while preserving chooser/filter focus. Distinguish requested and applied settings. Disabled choices cannot execute. Escape closes the overlay and restores the host reader target, not publication focus. Keep the existing combobox/listbox containment and active-option visibility.

A compact trailing **Commands :** footer button is the explicit entry point, named `Open reader commands (:)`. Hide it during overlays/search/jump/color editing. It is not a pointer overlay or workaround for iframe input delivery.

Align Ctrl/Cmd+O/W and chrome `i`; retain format-specific navigation meanings. EPUB continuous page commands are Next/Previous screen with PageDown/PageUp hints. PDF page hints use unconditional page-navigation shortcuts, not context-dependent pan keys.

## Responsive and accessible

At 420×600, 1000×700 and 1440×800 CSS px, the footer remains single-line and reserved during overlays. Chapter text can shrink; hide secondary location details at ≤600px. Controls never overlap text or scrolling.

Target 4.5:1 controlled-text contrast and 3:1 control/focus/highlight boundaries. Never rewrite publisher/custom palettes to enforce a ratio. Use text/structure, not color alone, for active settings and search matches. Keep EPUB status non-live; announce errors/initial loading once, not scrolling. Status updates never move focus.

Preserve selection, copying, links, editable content and keyboard containment. Native input and assistive-technology claims require real testing; document limitations without certification language.
