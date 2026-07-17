import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { applyRegexRules } from "../../chat/regexTransform";
import { usePresetsStore } from "../../stores/presetsStore";
import type { Preset, PresetDraft, PresetUpdate } from "../../db/repositories/presetsRepo";

const inputStyle = {
  backgroundColor: "var(--color-surface-2)",
  borderColor: "var(--color-border-strong)",
  color: "var(--color-text)",
} as const;

function PresetEditor({
  preset,
  onSave,
  onDelete,
  onCancel,
}: {
  preset: Preset | null;
  onSave: (draft: PresetDraft) => Promise<void>;
  onDelete?: () => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation("settings");
  const [name, setName] = useState(preset?.name ?? "");
  const [extraSystemPrompt, setExtraSystemPrompt] = useState(preset?.extraSystemPrompt ?? "");
  const [authorNote, setAuthorNote] = useState(preset?.authorNote ?? "");
  const [regexRules, setRegexRules] = useState(preset?.regexRules ?? "[]");
  const [regexTestInput, setRegexTestInput] = useState("");
  const [regexTestResult, setRegexTestResult] = useState("");
  const [temperature, setTemperature] = useState(preset?.temperature?.toString() ?? "");
  const [topP, setTopP] = useState(preset?.topP?.toString() ?? "");
  const [topK, setTopK] = useState(preset?.topK?.toString() ?? "");
  const [minP, setMinP] = useState(preset?.minP?.toString() ?? "");
  const [frequencyPenalty, setFrequencyPenalty] = useState(preset?.frequencyPenalty?.toString() ?? "");
  const [presencePenalty, setPresencePenalty] = useState(preset?.presencePenalty?.toString() ?? "");
  const [maxTokens, setMaxTokens] = useState(preset?.maxTokens?.toString() ?? "");
  const [isDefault, setIsDefault] = useState(preset?.isDefault ?? false);
  const [saving, setSaving] = useState(false);

  const parseNum = (v: string): number | null => {
    const n = Number(v);
    return v.trim() === "" ? null : Number.isNaN(n) ? null : n;
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        extraSystemPrompt,
        authorNote,
        regexRules,
        temperature: parseNum(temperature),
        topP: parseNum(topP),
        topK: parseNum(topK),
        minP: parseNum(minP),
        frequencyPenalty: parseNum(frequencyPenalty),
        presencePenalty: parseNum(presencePenalty),
        maxTokens: parseNum(maxTokens),
        isDefault,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="flex flex-col gap-3 rounded-[var(--radius-md)] border p-4"
      style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-elevated)" }}
    >
      <label className="flex flex-col gap-1 text-sm">
        {t("presets.fields.name")}
        <input
          className="rounded-[var(--radius-sm)] border px-2 py-1.5"
          style={inputStyle}
          value={name}
          placeholder={t("presets.fields.namePlaceholder") ?? ""}
          onChange={(e) => setName(e.target.value)}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t("presets.fields.extraSystemPrompt")}
        <textarea
          className="min-h-[4rem] rounded-[var(--radius-sm)] border px-2 py-1.5 text-sm"
          style={inputStyle}
          value={extraSystemPrompt}
          placeholder={t("presets.fields.extraSystemPromptPlaceholder") ?? ""}
          onChange={(e) => setExtraSystemPrompt(e.target.value)}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t("presets.fields.authorNote")}
        <textarea
          className="min-h-[6rem] rounded-[var(--radius-sm)] border px-2 py-1.5 text-sm"
          style={inputStyle}
          value={authorNote}
          placeholder={t("presets.fields.authorNotePlaceholder") ?? ""}
          onChange={(e) => setAuthorNote(e.target.value)}
          rows={5}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t("presets.fields.regexRules")}
        <textarea
          className="min-h-[4rem] rounded-[var(--radius-sm)] border px-2 py-1.5 text-sm font-mono"
          style={inputStyle}
          value={regexRules}
          placeholder={t("presets.fields.regexRulesHelp") ?? ""}
          onChange={(e) => setRegexRules(e.target.value)}
          rows={4}
        />
      </label>

      <div className="flex flex-col gap-1 rounded-[var(--radius-sm)] border p-3" style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-elevated)" }}>
        <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>{t("presets.regexTest")}</span>
        <textarea
          className="min-h-[3rem] rounded-[var(--radius-sm)] border px-2 py-1.5 text-sm"
          style={inputStyle}
          value={regexTestInput}
          placeholder={t("presets.regexTestPlaceholder") ?? ""}
          onChange={(e) => setRegexTestInput(e.target.value)}
          rows={3}
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setRegexTestResult(applyRegexRules(regexTestInput, regexRules))}
            className="rounded-[var(--radius-sm)] px-2 py-1 text-xs"
            style={{ backgroundColor: "var(--color-accent)", color: "var(--color-accent-contrast)" }}
          >
            {t("presets.regexTest")}
          </button>
          <button
            type="button"
            onClick={() => { setRegexTestInput(""); setRegexTestResult(""); }}
            className="rounded-[var(--radius-sm)] px-2 py-1 text-xs"
            style={{ color: "var(--color-text-muted)" }}
          >
            {t("actions.clear", { ns: "common" })}
          </button>
        </div>
        {regexTestResult && (
          <div className="rounded-[var(--radius-sm)] border p-2 text-sm" style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-surface)" }}>
            <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>{t("presets.regexTestResult")}:</span>
            <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-sm">{regexTestResult}</pre>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm">
          {t("presets.fields.temperature")}
          <input
            className="rounded-[var(--radius-sm)] border px-2 py-1.5"
            style={inputStyle}
            type="number"
            step="0.01"
            min="0"
            max="2"
            value={temperature}
            placeholder="0.8"
            onChange={(e) => setTemperature(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t("presets.fields.topP")}
          <input
            className="rounded-[var(--radius-sm)] border px-2 py-1.5"
            style={inputStyle}
            type="number"
            step="0.01"
            min="0"
            max="1"
            value={topP}
            placeholder="0.95"
            onChange={(e) => setTopP(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t("presets.fields.topK")}
          <input
            className="rounded-[var(--radius-sm)] border px-2 py-1.5"
            style={inputStyle}
            type="number"
            step="1"
            min="1"
            max="100"
            value={topK}
            placeholder="40"
            onChange={(e) => setTopK(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t("presets.fields.minP")}
          <input
            className="rounded-[var(--radius-sm)] border px-2 py-1.5"
            style={inputStyle}
            type="number"
            step="0.01"
            min="0"
            max="1"
            value={minP}
            placeholder="0.05"
            onChange={(e) => setMinP(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t("presets.fields.frequencyPenalty")}
          <input
            className="rounded-[var(--radius-sm)] border px-2 py-1.5"
            style={inputStyle}
            type="number"
            step="0.01"
            min="-2"
            max="2"
            value={frequencyPenalty}
            placeholder="0"
            onChange={(e) => setFrequencyPenalty(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t("presets.fields.presencePenalty")}
          <input
            className="rounded-[var(--radius-sm)] border px-2 py-1.5"
            style={inputStyle}
            type="number"
            step="0.01"
            min="-2"
            max="2"
            value={presencePenalty}
            placeholder="0"
            onChange={(e) => setPresencePenalty(e.target.value)}
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        {t("presets.fields.maxTokens")}
        <input
          className="rounded-[var(--radius-sm)] border px-2 py-1.5"
          style={inputStyle}
          type="number"
          step="1"
          min="1"
          value={maxTokens}
          placeholder="1024"
          onChange={(e) => setMaxTokens(e.target.value)}
        />
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={isDefault}
          onChange={(e) => setIsDefault(e.target.checked)}
        />
        {t("presets.fields.isDefault")}
      </label>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || !name.trim()}
          className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          style={{ backgroundColor: "var(--color-accent)", color: "var(--color-accent-contrast)" }}
        >
          {t("connections.saved")}
        </button>
        {onDelete && (
          <button
            type="button"
            onClick={() => {
              if (confirm(t("presets.deleteConfirm") ?? "")) void onDelete();
            }}
            className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm"
            style={{ color: "var(--color-danger)" }}
          >
            {t("presets.deleteConfirm")}
          </button>
        )}
        <button
          type="button"
          onClick={onCancel}
          className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm"
          style={{ color: "var(--color-text-muted)" }}
        >
          {t("actions.cancel", { ns: "common" })}
        </button>
      </div>
    </div>
  );
}

export function PresetsPanel() {
  const { t } = useTranslation(["settings", "personas"]);
  const { presets, loaded, load, create, update, remove } = usePresetsStore();
  const [editingId, setEditingId] = useState<string | "new" | null>(null);

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  return (
    <section
      className="rounded-[var(--radius-lg)] border p-5"
      style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-surface)" }}
    >
      <div className="mb-1 flex items-center justify-between">
        <h2 className="font-[var(--font-display)] text-lg">{t("presets.title")}</h2>
        <button
          type="button"
          onClick={() => setEditingId("new")}
          className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium"
          style={{ backgroundColor: "var(--color-accent)", color: "var(--color-accent-contrast)" }}
        >
          {t("presets.newButton")}
        </button>
      </div>
      <p className="mb-4 text-sm" style={{ color: "var(--color-text-muted)" }}>
        {t("presets.subtitle")}
      </p>

      {presets.length === 0 && editingId === null && (
        <p className="text-sm" style={{ color: "var(--color-text-faint)" }}>
          {t("presets.empty")}
        </p>
      )}

      {editingId === "new" && (
        <PresetEditor
          preset={null}
          onSave={async (draft) => {
            await create(draft);
            setEditingId(null);
          }}
          onCancel={() => setEditingId(null)}
        />
      )}

      <ul className="flex flex-col gap-2">
        {presets.map((preset) =>
          editingId === preset.id ? (
            <li key={preset.id}>
              <PresetEditor
                preset={preset}
                onSave={async (draft) => {
                  const patch: PresetUpdate = {};
                  if (draft.name !== preset.name) patch.name = draft.name;
                  if (draft.extraSystemPrompt !== preset.extraSystemPrompt) patch.extraSystemPrompt = draft.extraSystemPrompt;
                  if (draft.temperature !== preset.temperature) patch.temperature = draft.temperature ?? null;
                  if (draft.topP !== preset.topP) patch.topP = draft.topP ?? null;
                  if (draft.frequencyPenalty !== preset.frequencyPenalty) patch.frequencyPenalty = draft.frequencyPenalty ?? null;
                  if (draft.presencePenalty !== preset.presencePenalty) patch.presencePenalty = draft.presencePenalty ?? null;
                  if (draft.maxTokens !== preset.maxTokens) patch.maxTokens = draft.maxTokens ?? null;
                  if (draft.regexRules !== preset.regexRules) patch.regexRules = draft.regexRules;
                  if (draft.isDefault !== preset.isDefault) patch.isDefault = draft.isDefault;
                  await update(preset.id, patch);
                  setEditingId(null);
                }}
                onDelete={async () => {
                  if (confirm(t("presets.deleteConfirm") ?? "")) {
                    await remove(preset.id);
                    setEditingId(null);
                  }
                }}
                onCancel={() => setEditingId(null)}
              />
            </li>
          ) : (
            <li key={preset.id}>
              <button
                type="button"
                onClick={() => setEditingId(preset.id)}
                className="flex w-full items-center justify-between rounded-[var(--radius-md)] border px-4 py-3 text-left transition-colors hover:opacity-90"
                style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-elevated)" }}
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">
                    {preset.name}
                    {preset.isDefault ? ` (${t("personas.defaultBadge")})` : ""}
                  </span>
                  <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                    {[
                      preset.temperature !== null && `T=${preset.temperature}`,
                      preset.maxTokens !== null && `max=${preset.maxTokens}`,
                      preset.extraSystemPrompt && `+${preset.extraSystemPrompt.slice(0, 40)}${preset.extraSystemPrompt.length > 40 ? "…" : ""}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
              </button>
            </li>
          ),
        )}
      </ul>
    </section>
  );
}
