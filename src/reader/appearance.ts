export const DOCUMENT_THEMES = [
  { id: "original", label: "Original", background: null, foreground: null },
  { id: "light", label: "Light", background: "#FFFFFF", foreground: "#202124" },
  { id: "dark", label: "Dark", background: "#1E1E1E", foreground: "#E6E6E6" },
  { id: "sepia", label: "Sepia", background: "#FBF0D9", foreground: "#3C3836" },
  { id: "zathura-dark", label: "Zathura Dark", background: "#14161B", foreground: "#DCD7BA" },
  { id: "gruvbox-dark", label: "Gruvbox Dark", background: "#282828", foreground: "#EBDBB2" },
  { id: "solarized-dark", label: "Solarized Dark", background: "#002B36", foreground: "#839496" },
  { id: "rose-pine-dawn", label: "Rose Pine Dawn", background: "#FAF4ED", foreground: "#575279" },
] as const;

export type ReaderThemeId = (typeof DOCUMENT_THEMES)[number]["id"];
