import type { ChronicleTheme } from "./chronicleTypes";

export interface ThemeDef {
  key: ChronicleTheme;
  label: string;
}

export const THEMES: ThemeDef[] = [
  { key: "fantasy", label: "Fantasy" },
  { key: "horror", label: "Horror" },
  { key: "cyberpunk", label: "Cyberpunk" },
  { key: "universal", label: "Universal" },
];
