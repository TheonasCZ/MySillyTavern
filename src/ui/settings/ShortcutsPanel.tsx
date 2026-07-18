import { useTranslation } from "react-i18next";

const shortcutStyle = {
  backgroundColor: "var(--color-surface-2)",
  color: "var(--color-accent)",
} as const;

export function ShortcutsPanel() {
  const { t } = useTranslation("settings");
  const mod = navigator.platform.includes("Mac") ? "⌘" : "Ctrl";

  return (
    <section
      className="rounded-[var(--radius-lg)] border p-5"
      style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-surface)" }}
    >
      <h2 className="mb-3 font-[var(--font-display)] text-lg">{t("shortcuts.title")}</h2>
      <ul className="flex flex-col gap-2 text-sm">
        <li className="flex items-center justify-between">
          <span>{t("shortcuts.regenerate")}</span>
          <kbd
            className="rounded-[var(--radius-sm)] px-2 py-0.5 text-xs font-mono"
            style={shortcutStyle}
          >
            {mod}+R
          </kbd>
        </li>
        <li className="flex items-center justify-between">
          <span>{t("shortcuts.send")}</span>
          <kbd
            className="rounded-[var(--radius-sm)] px-2 py-0.5 text-xs font-mono"
            style={shortcutStyle}
          >
            {mod}+Enter
          </kbd>
        </li>
        <li className="flex items-center justify-between">
          <span>{t("shortcuts.close")}</span>
          <kbd
            className="rounded-[var(--radius-sm)] px-2 py-0.5 text-xs font-mono"
            style={shortcutStyle}
          >
            Esc
          </kbd>
        </li>
      </ul>
    </section>
  );
}
