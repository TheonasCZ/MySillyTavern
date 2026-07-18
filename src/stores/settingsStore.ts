import { create } from "zustand";

import i18n, { type SupportedLanguage } from "../i18n";
import { getSetting, setSetting } from "../db/repositories/settingsRepo";
import type { CalendarMode } from "../memory/calendar";

export type Theme = "dark" | "light";

/** Root font-size scale in % — everything is sized in rem, so this scales
 * the whole UI. Keep the steps modest so layouts don't break. */
export const FONT_SCALES = [87.5, 100, 112.5, 125, 150, 175, 200] as const;
export type FontScale = (typeof FONT_SCALES)[number];
const DEFAULT_FONT_SCALE: FontScale = 100;

interface SettingsState {
  theme: Theme;
  language: SupportedLanguage;
  fontScale: FontScale;
  calendarMode: CalendarMode;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setTheme: (theme: Theme) => Promise<void>;
  setLanguage: (language: SupportedLanguage) => Promise<void>;
  setFontScale: (scale: FontScale) => Promise<void>;
  setCalendarMode: (mode: CalendarMode) => Promise<void>;
}

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.remove("dark", "light");
  root.classList.add(theme);
}

function applyFontScale(scale: FontScale) {
  if (typeof document === "undefined") return;
  document.documentElement.style.fontSize = scale === 100 ? "" : `${scale}%`;
}

function parseFontScale(raw: string | null): FontScale {
  const value = Number(raw);
  return (FONT_SCALES as readonly number[]).includes(value)
    ? (value as FontScale)
    : DEFAULT_FONT_SCALE;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  theme: "dark",
  language: "cs",
  fontScale: DEFAULT_FONT_SCALE,
  calendarMode: "fantasy",
  hydrated: false,

  hydrate: async () => {
    const [storedTheme, storedLanguage, storedFontScale, storedCalendarMode] = await Promise.all([
      getSetting("theme"),
      getSetting("language"),
      getSetting("font_scale"),
      getSetting("calendar_mode"),
    ]);
    const theme: Theme = storedTheme === "light" ? "light" : "dark";
    const language: SupportedLanguage = storedLanguage === "en" ? "en" : "cs";
    const fontScale = parseFontScale(storedFontScale);
    const calendarMode: CalendarMode = storedCalendarMode === "real" ? "real" : "fantasy";

    applyTheme(theme);
    applyFontScale(fontScale);
    await i18n.changeLanguage(language);

    set({ theme, language, fontScale, calendarMode, hydrated: true });
  },

  setTheme: async (theme) => {
    applyTheme(theme);
    set({ theme });
    await setSetting("theme", theme);
  },

  setLanguage: async (language) => {
    await i18n.changeLanguage(language);
    set({ language });
    await setSetting("language", language);
  },

  setFontScale: async (fontScale) => {
    applyFontScale(fontScale);
    set({ fontScale });
    await setSetting("font_scale", String(fontScale));
  },

  setCalendarMode: async (calendarMode) => {
    set({ calendarMode });
    await setSetting("calendar_mode", calendarMode);
  },
}));

// Apply a sane default immediately so the very first paint (before the DB
// hydration resolves) is already dark-themed, per the "dark by default"
// requirement.
applyTheme(useSettingsStore.getState().theme);
