import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";

import { pickAndExportCharacter } from "../../cards/cardExport";
import {
  getCharacter,
  updateCharacter,
  type Character,
  type CharacterUpdate,
} from "../../db/repositories/charactersRepo";
import { useCharactersStore } from "../../stores/charactersStore";
import { FieldHelp } from "../common/FieldHelp";
import { avatarSrc } from "./avatarSrc";
import type { TtsVoice } from "../../chat/ttsBackend";
import { WebSpeechTts } from "../../chat/webSpeechTts";
import { EdgeTts } from "../../chat/edgeTts";
import { TtsManager } from "../../chat/ttsManager";

const inputStyle = {
  backgroundColor: "var(--color-surface-2)",
  borderColor: "var(--color-border-strong)",
  color: "var(--color-text)",
} as const;

// Singleton manager for voice listing (lightweight — just for getVoices)
let voiceManagerInstance: TtsManager | null = null;
function getVoiceManager(): TtsManager {
  if (!voiceManagerInstance) {
    voiceManagerInstance = new TtsManager(new WebSpeechTts(), new EdgeTts());
  }
  return voiceManagerInstance;
}

function VoiceSelector({
  value,
  onChange,
}: {
  value: string;
  onChange: (voiceUri: string) => void;
}) {
  const { t } = useTranslation("characters");
  const [voices, setVoices] = useState<TtsVoice[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const list = await getVoiceManager().listVoices();
      if (!cancelled) setVoices(list);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="flex items-center gap-1">
        {t("editor.fields.ttsVoice")}
      </span>
      <select
        className="rounded-[var(--radius-sm)] border px-2 py-1.5"
        style={inputStyle}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{t("editor.ttsVoiceDefault")}</option>
        {voices.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name} ({v.lang})
          </option>
        ))}
      </select>
    </label>
  );
}

function toDraft(character: Character): CharacterUpdate {
  return {
    name: character.name,
    description: character.description,
    personality: character.personality,
    scenario: character.scenario,
    firstMes: character.firstMes,
    mesExample: character.mesExample,
    alternateGreetings: character.alternateGreetings,
    systemPrompt: character.systemPrompt,
    postHistoryInstructions: character.postHistoryInstructions,
    creatorNotes: character.creatorNotes,
    tags: character.tags,
    ttsVoice: character.ttsVoice,
  };
}

function ListEditor({
  label,
  help,
  values,
  onChange,
  addLabel,
  multiline,
}: {
  label: string;
  help?: string;
  values: string[];
  onChange: (values: string[]) => void;
  addLabel: string;
  multiline?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span
        className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide"
        style={{ color: "var(--color-text-faint)" }}
      >
        {label}
        {help && <FieldHelp text={help} />}
      </span>
      {values.map((value, i) => (
        <div key={i} className="flex items-start gap-2">
          {multiline ? (
            <textarea
              className="min-h-[3rem] flex-1 rounded-[var(--radius-sm)] border px-2 py-1.5 text-sm"
              style={inputStyle}
              value={value}
              onChange={(e) => {
                const next = [...values];
                next[i] = e.target.value;
                onChange(next);
              }}
            />
          ) : (
            <input
              className="flex-1 rounded-[var(--radius-sm)] border px-2 py-1.5 text-sm"
              style={inputStyle}
              value={value}
              onChange={(e) => {
                const next = [...values];
                next[i] = e.target.value;
                onChange(next);
              }}
            />
          )}
          <button
            type="button"
            onClick={() => onChange(values.filter((_, idx) => idx !== i))}
            className="mt-1 shrink-0 text-xs"
            style={{ color: "var(--color-danger)" }}
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...values, ""])}
        className="self-start rounded-[var(--radius-sm)] px-2 py-1 text-xs"
        style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text-muted)" }}
      >
        + {addLabel}
      </button>
    </div>
  );
}

export function CardEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation(["characters", "common"]);
  const { remove } = useCharactersStore();

  const [character, setCharacter] = useState<Character | null>(null);
  const [draft, setDraft] = useState<CharacterUpdate | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [exportState, setExportState] = useState<"idle" | "running" | "error">("idle");
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    void getCharacter(id).then((c) => {
      setCharacter(c);
      if (c) setDraft(toDraft(c));
    });
  }, [id]);

  if (!id) return null;
  if (!character || !draft) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="text-sm" style={{ color: "var(--color-text-faint)" }}>
          {t("state.loading", { ns: "common" })}
        </span>
      </div>
    );
  }

  const patch = (partial: Partial<CharacterUpdate>) => setDraft({ ...draft, ...partial });

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateCharacter(id, draft);
      setCharacter({ ...character, ...draft });
      setSavedAt(Date.now());
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(t("editor.deleteConfirm") ?? "")) return;
    await remove(id);
    navigate("/characters");
  };

  const handleExport = async () => {
    setExportState("running");
    setExportError(null);
    try {
      const merged = { ...character, ...draft };
      await pickAndExportCharacter(merged);
      setExportState("idle");
    } catch (err) {
      setExportState("error");
      setExportError(String(err));
    }
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-8">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => navigate("/characters")}
          className="text-sm"
          style={{ color: "var(--color-text-muted)" }}
        >
          ← {t("editor.backToGallery")}
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={exportState === "running"}
            className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm disabled:opacity-50"
            style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text)" }}
          >
            {exportState === "running" ? t("editor.exporting") : t("editor.exportPng")}
          </button>
          <button
            type="button"
            onClick={handleDelete}
            className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm"
            style={{ color: "var(--color-danger)" }}
          >
            {t("actions.delete", { ns: "common" })}
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            style={{ backgroundColor: "var(--color-accent)", color: "var(--color-accent-contrast)" }}
          >
            {saving ? t("state.saving", { ns: "common" }) : t("actions.save", { ns: "common" })}
          </button>
        </div>
      </div>

      {exportError && (
        <div
          className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border px-3 py-2 text-sm"
          style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}
        >
          <span>{t("editor.exportError", { message: exportError })}</span>
          <button type="button" onClick={() => setExportError(null)} className="shrink-0 opacity-80 hover:opacity-100">
            {t("actions.close", { ns: "common" })}
          </button>
        </div>
      )}
      {savedAt && (
        <span className="text-xs" style={{ color: "var(--color-success)" }}>
          {t("editor.saved")}
        </span>
      )}

      <div className="flex items-start gap-4">
        <div
          className="h-32 w-24 shrink-0 overflow-hidden rounded-[var(--radius-md)]"
          style={{ backgroundColor: "var(--color-surface-2)" }}
        >
          {avatarSrc(character.avatarPath) ? (
            <img src={avatarSrc(character.avatarPath)} alt={draft.name} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <span className="font-[var(--font-display)] text-2xl" style={{ color: "var(--color-text-faint)" }}>
                {draft.name.slice(0, 1).toUpperCase()}
              </span>
            </div>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="flex items-center gap-1">
              {t("editor.fields.name")}
              <FieldHelp text={t("editor.help.name")} />
            </span>
            <input
              className="rounded-[var(--radius-sm)] border px-2 py-1.5"
              style={inputStyle}
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </label>

          <div className="flex flex-wrap gap-1 text-xs" style={{ color: "var(--color-text-faint)" }}>
            {t("editor.specVersion", { version: character.specVersion.toUpperCase() })}
          </div>
        </div>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="flex items-center gap-1">
          {t("editor.fields.description")}
          <FieldHelp text={t("editor.help.description")} />
        </span>
        <textarea
          className="min-h-[6rem] rounded-[var(--radius-sm)] border px-2 py-1.5 text-sm"
          style={inputStyle}
          value={draft.description}
          onChange={(e) => patch({ description: e.target.value })}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="flex items-center gap-1">
          {t("editor.fields.personality")}
          <FieldHelp text={t("editor.help.personality")} />
        </span>
        <textarea
          className="min-h-[4rem] rounded-[var(--radius-sm)] border px-2 py-1.5 text-sm"
          style={inputStyle}
          value={draft.personality}
          onChange={(e) => patch({ personality: e.target.value })}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="flex items-center gap-1">
          {t("editor.fields.scenario")}
          <FieldHelp text={t("editor.help.scenario")} />
        </span>
        <textarea
          className="min-h-[4rem] rounded-[var(--radius-sm)] border px-2 py-1.5 text-sm"
          style={inputStyle}
          value={draft.scenario}
          onChange={(e) => patch({ scenario: e.target.value })}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="flex items-center gap-1">
          {t("editor.fields.firstMes")}
          <FieldHelp text={t("editor.help.firstMes")} />
        </span>
        <textarea
          className="min-h-[5rem] rounded-[var(--radius-sm)] border px-2 py-1.5 text-sm"
          style={inputStyle}
          value={draft.firstMes}
          onChange={(e) => patch({ firstMes: e.target.value })}
        />
      </label>

      <ListEditor
        label={t("editor.fields.alternateGreetings")}
        help={t("editor.help.alternateGreetings")}
        values={draft.alternateGreetings}
        onChange={(alternateGreetings) => patch({ alternateGreetings })}
        addLabel={t("editor.addGreeting")}
        multiline
      />

      <label className="flex flex-col gap-1 text-sm">
        <span className="flex items-center gap-1">
          {t("editor.fields.mesExample")}
          <FieldHelp text={t("editor.help.mesExample")} />
        </span>
        <textarea
          className="min-h-[5rem] rounded-[var(--radius-sm)] border px-2 py-1.5 text-sm font-[var(--font-mono)]"
          style={inputStyle}
          value={draft.mesExample}
          onChange={(e) => patch({ mesExample: e.target.value })}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="flex items-center gap-1">
          {t("editor.fields.systemPrompt")}
          <FieldHelp text={t("editor.help.systemPrompt")} />
        </span>
        <textarea
          className="min-h-[4rem] rounded-[var(--radius-sm)] border px-2 py-1.5 text-sm"
          style={inputStyle}
          value={draft.systemPrompt}
          onChange={(e) => patch({ systemPrompt: e.target.value })}
        />
        <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>
          {t("editor.systemPromptHint")}
        </span>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="flex items-center gap-1">
          {t("editor.fields.postHistoryInstructions")}
          <FieldHelp text={t("editor.help.postHistoryInstructions")} />
        </span>
        <textarea
          className="min-h-[3rem] rounded-[var(--radius-sm)] border px-2 py-1.5 text-sm"
          style={inputStyle}
          value={draft.postHistoryInstructions}
          onChange={(e) => patch({ postHistoryInstructions: e.target.value })}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="flex items-center gap-1">
          {t("editor.fields.creatorNotes")}
          <FieldHelp text={t("editor.help.creatorNotes")} />
        </span>
        <textarea
          className="min-h-[3rem] rounded-[var(--radius-sm)] border px-2 py-1.5 text-sm"
          style={inputStyle}
          value={draft.creatorNotes}
          onChange={(e) => patch({ creatorNotes: e.target.value })}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="flex items-center gap-1">
          {t("editor.fields.tags")}
          <FieldHelp text={t("editor.help.tags")} />
        </span>
        <input
          className="rounded-[var(--radius-sm)] border px-2 py-1.5"
          style={inputStyle}
          value={draft.tags.join(", ")}
          placeholder={t("editor.tagsPlaceholder") ?? ""}
          onChange={(e) =>
            patch({
              tags: e.target.value
                .split(",")
                .map((t2) => t2.trim())
                .filter(Boolean),
            })
          }
        />
      </label>

      {/* TTS voice selector */}
      <VoiceSelector
        value={draft.ttsVoice ?? ""}
        onChange={(v) => patch({ ttsVoice: v || null })}
      />
    </div>
  );
}
