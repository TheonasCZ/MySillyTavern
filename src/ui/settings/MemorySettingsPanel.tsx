import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { getSetting, setSetting } from "../../db/repositories/settingsRepo";
import {
  DEFAULT_MEMORY_MIN_SCORE,
  DEFAULT_MEMORY_TOP_K,
} from "../../memory/embeddingsEngine";
import { DEFAULT_EXTRACTION_INTERVAL } from "../../memory/memoryEngine";
import { DEFAULT_VERBATIM_WINDOW } from "../../prompt/promptBuilder";
import { FieldHelp } from "../common/FieldHelp";

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
  const [embeddingModel, setEmbeddingModel] = useState("");
  const [topK, setTopK] = useState(String(DEFAULT_MEMORY_TOP_K));
  const [minScore, setMinScore] = useState(String(DEFAULT_MEMORY_MIN_SCORE));
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void (async () => {
      const [interval, window, model, k, score] = await Promise.all([
        getSetting("extraction_interval"),
        getSetting("verbatim_window"),
        getSetting("embedding_model"),
        getSetting("memory_top_k"),
        getSetting("memory_min_score"),
      ]);
      if (interval) setExtractionInterval(interval);
      if (window) setVerbatimWindow(window);
      if (model) setEmbeddingModel(model);
      if (k) setTopK(k);
      if (score) setMinScore(score);
    })();
  }, []);

  const handleSave = async () => {
    const interval = Math.max(1, Number(extractionInterval) || DEFAULT_EXTRACTION_INTERVAL);
    const window = Math.max(4, Number(verbatimWindow) || DEFAULT_VERBATIM_WINDOW);
    const k = Math.max(1, Number(topK) || DEFAULT_MEMORY_TOP_K);
    const scoreNum = Number(minScore);
    const score =
      Number.isFinite(scoreNum) && scoreNum >= 0 && scoreNum <= 1
        ? scoreNum
        : DEFAULT_MEMORY_MIN_SCORE;
    setExtractionInterval(String(interval));
    setVerbatimWindow(String(window));
    setTopK(String(k));
    setMinScore(String(score));
    await Promise.all([
      setSetting("extraction_interval", String(interval)),
      setSetting("verbatim_window", String(window)),
      setSetting("embedding_model", embeddingModel.trim()),
      setSetting("memory_top_k", String(k)),
      setSetting("memory_min_score", String(score)),
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
          <span className="flex items-center gap-1">
            {t("memory.extractionInterval")}
            <FieldHelp text={t("memory.help.extractionInterval")} />
          </span>
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
          <span className="flex items-center gap-1">
            {t("memory.verbatimWindow")}
            <FieldHelp text={t("memory.help.verbatimWindow")} />
          </span>
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

      <h3 className="mb-1 mt-6 text-sm font-medium">{t("memory.embedding.title")}</h3>
      <p className="mb-3 text-xs" style={{ color: "var(--color-text-faint)" }}>
        {t("memory.embedding.subtitle")}
      </p>
      <div className="flex flex-col gap-4 sm:flex-row sm:gap-10">
        <label className="flex flex-col gap-1 text-sm">
          <span className="flex items-center gap-1">
            {t("memory.embedding.model")}
            <FieldHelp text={t("memory.help.embeddingModel")} />
          </span>
          <input
            className="w-56 rounded-[var(--radius-sm)] border px-2 py-1.5"
            style={inputStyle}
            value={embeddingModel}
            placeholder={t("memory.embedding.modelPlaceholder") ?? ""}
            onChange={(e) => setEmbeddingModel(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="flex items-center gap-1">
            {t("memory.embedding.topK")}
            <FieldHelp text={t("memory.help.topK")} />
          </span>
          <input
            type="number"
            min={1}
            className="w-32 rounded-[var(--radius-sm)] border px-2 py-1.5"
            style={inputStyle}
            value={topK}
            onChange={(e) => setTopK(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="flex items-center gap-1">
            {t("memory.embedding.minScore")}
            <FieldHelp text={t("memory.help.minScore")} />
          </span>
          <input
            type="number"
            min={0}
            max={1}
            step={0.05}
            className="w-32 rounded-[var(--radius-sm)] border px-2 py-1.5"
            style={inputStyle}
            value={minScore}
            onChange={(e) => setMinScore(e.target.value)}
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
