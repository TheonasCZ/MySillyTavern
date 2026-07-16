import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { getSetting, setSetting } from "../../db/repositories/settingsRepo";
import { DEFAULT_EXTRACTION_INTERVAL } from "../../memory/memoryEngine";
import { DEFAULT_VERBATIM_WINDOW } from "../../prompt/promptBuilder";

const inputStyle = {
  backgroundColor: "var(--color-surface-2)",
  borderColor: "var(--color-border-strong)",
  color: "var(--color-text)",
} as const;

/** Global defaults for the memory engine (plan §7 M5): how often ledger
 * extraction runs, and how many recent messages stay verbatim in the
 * prompt before being folded into the summary. Per-chat overrides (the
 * extraction connection) live in the chat room header, next to the persona
 * picker, since they're tied to a specific chat rather than app-wide. */
export function MemorySettingsPanel() {
  const { t } = useTranslation(["settings", "common"]);
  const [extractionInterval, setExtractionInterval] = useState(String(DEFAULT_EXTRACTION_INTERVAL));
  const [verbatimWindow, setVerbatimWindow] = useState(String(DEFAULT_VERBATIM_WINDOW));
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void (async () => {
      const [interval, window] = await Promise.all([
        getSetting("extraction_interval"),
        getSetting("verbatim_window"),
      ]);
      if (interval) setExtractionInterval(interval);
      if (window) setVerbatimWindow(window);
    })();
  }, []);

  const handleSave = async () => {
    const interval = Math.max(1, Number(extractionInterval) || DEFAULT_EXTRACTION_INTERVAL);
    const window = Math.max(4, Number(verbatimWindow) || DEFAULT_VERBATIM_WINDOW);
    setExtractionInterval(String(interval));
    setVerbatimWindow(String(window));
    await Promise.all([
      setSetting("extraction_interval", String(interval)),
      setSetting("verbatim_window", String(window)),
    ]);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <section
      className="rounded-[var(--radius-lg)] border p-5"
      style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-surface)" }}
    >
      <h2 className="mb-1 font-[var(--font-display)] text-lg">{t("sections.memory")}</h2>
      <p className="mb-4 text-xs" style={{ color: "var(--color-text-faint)" }}>
        {t("memory.subtitle")}
      </p>

      <div className="flex flex-col gap-4 sm:flex-row sm:gap-10">
        <label className="flex flex-col gap-1 text-sm">
          {t("memory.extractionInterval")}
          <input
            type="number"
            min={1}
            className="w-32 rounded-[var(--radius-sm)] border px-2 py-1.5"
            style={inputStyle}
            value={extractionInterval}
            onChange={(e) => setExtractionInterval(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t("memory.verbatimWindow")}
          <input
            type="number"
            min={4}
            className="w-32 rounded-[var(--radius-sm)] border px-2 py-1.5"
            style={inputStyle}
            value={verbatimWindow}
            onChange={(e) => setVerbatimWindow(e.target.value)}
          />
        </label>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={() => void handleSave()}
          className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium"
          style={{ backgroundColor: "var(--color-accent)", color: "var(--color-accent-contrast)" }}
        >
          {t("actions.save", { ns: "common" })}
        </button>
        {saved && (
          <span className="text-xs" style={{ color: "var(--color-success)" }}>
            {t("memory.saved")}
          </span>
        )}
      </div>
    </section>
  );
}
