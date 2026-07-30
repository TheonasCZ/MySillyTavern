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

/** Classic fixed-resolution presets for the app window, plus "maximized".
 * "1280x800" matches the default window size in tauri.conf.json. */
export const WINDOW_SIZES = [
  "1280x800",
  "1366x768",
  "1600x900",
  "1920x1080",
  "2560x1440",
  "maximized",
] as const;
export type WindowSizePreset = (typeof WINDOW_SIZES)[number];
const DEFAULT_WINDOW_SIZE: WindowSizePreset = "1280x800";

function parseWindowSize(raw: string | null): WindowSizePreset {
  return (WINDOW_SIZES as readonly string[]).includes(raw ?? "")
    ? (raw as WindowSizePreset)
    : DEFAULT_WINDOW_SIZE;
}

/** Resizes the actual OS window. No-op outside Tauri (e.g. plain browser
 * dev server) since `getCurrentWindow()` throws there. */
async function applyWindowSize(preset: WindowSizePreset): Promise<void> {
  try {
    const { getCurrentWindow, LogicalSize } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    if (preset === "maximized") {
      await win.maximize();
      return;
    }
    if (await win.isMaximized()) await win.unmaximize();
    const [w, h] = preset.split("x").map(Number);
    await win.setSize(new LogicalSize(w, h));
    await win.center();
  } catch {
    // Not running inside a Tauri window — nothing to resize.
  }
}

interface SettingsState {
  theme: Theme;
  language: SupportedLanguage;
  fontScale: FontScale;
  calendarMode: CalendarMode;
  windowSize: WindowSizePreset;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setTheme: (theme: Theme) => Promise<void>;
  setLanguage: (language: SupportedLanguage) => Promise<void>;
  setFontScale: (scale: FontScale) => Promise<void>;
  setCalendarMode: (mode: CalendarMode) => Promise<void>;
  setWindowSize: (preset: WindowSizePreset) => Promise<void>;
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
  windowSize: DEFAULT_WINDOW_SIZE,
  hydrated: false,

  hydrate: async () => {
    const [storedTheme, storedLanguage, storedFontScale, storedCalendarMode, storedWindowSize] = await Promise.all([
      getSetting("theme"),
      getSetting("language"),
      getSetting("font_scale"),
      getSetting("calendar_mode"),
      getSetting("window_size"),
    ]);
    const theme: Theme = storedTheme === "light" ? "light" : "dark";
    const language: SupportedLanguage = storedLanguage === "en" ? "en" : "cs";
    const fontScale = parseFontScale(storedFontScale);
    const calendarMode: CalendarMode = storedCalendarMode === "real" ? "real" : "fantasy";
    const windowSize = parseWindowSize(storedWindowSize);

    applyTheme(theme);
    applyFontScale(fontScale);
    await i18n.changeLanguage(language);
    // Only apply a persisted preset — an unset setting (fresh install)
    // means "keep tauri.conf.json's own default", not "force 1280x800".
    if (storedWindowSize) void applyWindowSize(windowSize);

    set({ theme, language, fontScale, calendarMode, windowSize, hydrated: true });
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

  setWindowSize: async (windowSize) => {
    await applyWindowSize(windowSize);
    set({ windowSize });
    await setSetting("window_size", windowSize);
  },
}));

// Apply a sane default immediately so the very first paint (before the DB
// hydration resolves) is already dark-themed, per the "dark by default"
// requirement.
applyTheme(useSettingsStore.getState().theme);
