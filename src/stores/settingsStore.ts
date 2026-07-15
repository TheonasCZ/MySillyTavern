import { create } from "zustand";

import i18n, { type SupportedLanguage } from "../i18n";
import { getSetting, setSetting } from "../db/repositories/settingsRepo";

export type Theme = "dark" | "light";

interface SettingsState {
  theme: Theme;
  language: SupportedLanguage;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setTheme: (theme: Theme) => Promise<void>;
  setLanguage: (language: SupportedLanguage) => Promise<void>;
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.remove("dark", "light");
  root.classList.add(theme);
}

export const useSettingsStore = create<SettingsState>((set) => ({
  theme: "dark",
  language: "cs",
  hydrated: false,

  hydrate: async () => {
    const [storedTheme, storedLanguage] = await Promise.all([
      getSetting("theme"),
      getSetting("language"),
    ]);
    const theme: Theme = storedTheme === "light" ? "light" : "dark";
    const language: SupportedLanguage = storedLanguage === "en" ? "en" : "cs";

    applyTheme(theme);
    await i18n.changeLanguage(language);

    set({ theme, language, hydrated: true });
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
}));

// Apply a sane default immediately so the very first paint (before the DB
// hydration resolves) is already dark-themed, per the "dark by default"
// requirement.
applyTheme(useSettingsStore.getState().theme);
