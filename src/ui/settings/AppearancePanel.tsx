import { useTranslation } from "react-i18next";

import { FONT_SCALES, useSettingsStore, type Theme } from "../../stores/settingsStore";
import type { SupportedLanguage } from "../../i18n";

export function AppearancePanel() {
  const { t } = useTranslation("settings");
  const { theme, language, fontScale, setTheme, setLanguage, setFontScale } = useSettingsStore();

  return (
    <section
      className="rounded-[var(--radius-lg)] border p-5"
      style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-surface)" }}
    >
      <h2 className="mb-4 font-[var(--font-display)] text-lg">{t("sections.appearance")}</h2>

      <div className="flex flex-col gap-4 sm:flex-row sm:gap-10">
        <div>
          <span className="mb-2 block text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>
            {t("appearance.language")}
          </span>
          <div className="inline-flex overflow-hidden rounded-[var(--radius-sm)] border" style={{ borderColor: "var(--color-border-strong)" }}>
            {(["cs", "en"] as SupportedLanguage[]).map((lang) => (
              <button
                key={lang}
                type="button"
                onClick={() => void setLanguage(lang)}
                aria-pressed={language === lang}
                className="px-3 py-1.5 text-sm transition-colors"
                style={{
                  backgroundColor: language === lang ? "var(--color-accent)" : "transparent",
                  color: language === lang ? "var(--color-accent-contrast)" : "var(--color-text-muted)",
                }}
              >
                {lang === "cs" ? t("appearance.languageCs") : t("appearance.languageEn")}
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className="mb-2 block text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>
            {t("appearance.theme")}
          </span>
          <div className="inline-flex overflow-hidden rounded-[var(--radius-sm)] border" style={{ borderColor: "var(--color-border-strong)" }}>
            {(["dark", "light"] as Theme[]).map((th) => (
              <button
                key={th}
                type="button"
                onClick={() => void setTheme(th)}
                aria-pressed={theme === th}
                className="px-3 py-1.5 text-sm transition-colors"
                style={{
                  backgroundColor: theme === th ? "var(--color-accent)" : "transparent",
                  color: theme === th ? "var(--color-accent-contrast)" : "var(--color-text-muted)",
                }}
              >
                {th === "dark" ? t("appearance.themeDark") : t("appearance.themeLight")}
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className="mb-2 block text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>
            {t("appearance.fontSize")}
          </span>
          <div className="inline-flex overflow-hidden rounded-[var(--radius-sm)] border" style={{ borderColor: "var(--color-border-strong)" }}>
            {FONT_SCALES.map((scale) => (
              <button
                key={scale}
                type="button"
                onClick={() => void setFontScale(scale)}
                aria-pressed={fontScale === scale}
                title={`${scale} %`}
                className="px-3 py-1.5 transition-colors"
                style={{
                  // Preview each step at its own size; sized in px on purpose
                  // so the labels don't rescale when the root font changes.
                  fontSize: `${(14 * scale) / 100}px`,
                  backgroundColor: fontScale === scale ? "var(--color-accent)" : "transparent",
                  color: fontScale === scale ? "var(--color-accent-contrast)" : "var(--color-text-muted)",
                }}
              >
                A
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
