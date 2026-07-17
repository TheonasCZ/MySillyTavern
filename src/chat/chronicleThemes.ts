export interface ChronicleTheme {
  font: string;
  bg: string;
  accent: string;
  text: string;
}

export const THEMES: Record<string, ChronicleTheme> = {
  fantasy: {
    font: "Georgia, serif",
    bg: "#f5e6c8",
    accent: "#8b6914",
    text: "#3d2b1f",
  },
  horror: {
    font: "Courier New, monospace",
    bg: "#0a0a0a",
    accent: "#8b0000",
    text: "#c0c0c0",
  },
  cyberpunk: {
    font: "Consolas, monospace",
    bg: "#0d0221",
    accent: "#00ffff",
    text: "#c0c0ff",
  },
  universal: {
    font: "Georgia, serif",
    bg: "#ffffff",
    accent: "#333333",
    text: "#000000",
  },
};

export const THEME_LABELS: Record<string, string> = {
  fantasy: "Fantasy (výchozí)",
  horror: "Horor",
  cyberpunk: "Cyberpunk",
  universal: "Univerzální",
};
