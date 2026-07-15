import { useState } from "react";
import { useTranslation } from "react-i18next";

import { chatComplete } from "../../providers/chatComplete";
import { deleteApiKey, hasApiKey, saveApiKey } from "../../providers/keyring";
import type { ConnectionConfig, ConnectionDraft, Provider } from "../../providers/types";

const PROVIDERS: Provider[] = ["gemini", "openai", "claude"];

const DEFAULT_DRAFT: ConnectionDraft = {
  name: "",
  provider: "gemini",
  baseUrl: null,
  model: "",
  temperature: 0.8,
  topP: 0.95,
  maxTokens: 1024,
  contextBudget: 8000,
};

interface Props {
  initial: ConnectionConfig | null;
  onSave: (draft: ConnectionDraft) => Promise<ConnectionConfig>;
  onDelete?: () => Promise<void>;
  onCancel: () => void;
  onCreated?: (created: ConnectionConfig) => void;
}

type TestState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "success"; reply: string }
  | { status: "error"; message: string };

export function ConnectionForm({ initial, onSave, onDelete, onCancel, onCreated }: Props) {
  const { t } = useTranslation("settings");
  const [draft, setDraft] = useState<ConnectionDraft>(
    initial
      ? {
          name: initial.name,
          provider: initial.provider,
          baseUrl: initial.baseUrl,
          model: initial.model,
          temperature: initial.temperature,
          topP: initial.topP,
          maxTokens: initial.maxTokens,
          contextBudget: initial.contextBudget,
        }
      : DEFAULT_DRAFT,
  );
  const [savedId, setSavedId] = useState<string | null>(initial?.id ?? null);
  const [keySaved, setKeySaved] = useState<boolean | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [testState, setTestState] = useState<TestState>({ status: "idle" });
  const [saving, setSaving] = useState(false);

  const refreshKeyStatus = async (connectionId: string) => {
    const has = await hasApiKey(connectionId);
    setKeySaved(has);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const saved = await onSave(draft);
      setSavedId(saved.id);
      if (!initial) {
        await refreshKeyStatus(saved.id);
        onCreated?.(saved);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSaveKey = async () => {
    if (!savedId || !apiKeyInput.trim()) return;
    await saveApiKey(savedId, apiKeyInput.trim());
    setApiKeyInput("");
    await refreshKeyStatus(savedId);
  };

  const handleDeleteKey = async () => {
    if (!savedId) return;
    await deleteApiKey(savedId);
    await refreshKeyStatus(savedId);
  };

  const handleTest = async () => {
    if (!savedId) return;
    setTestState({ status: "running" });
    try {
      const reply = await chatComplete(
        { id: savedId, ...draft, createdAt: "", updatedAt: "" },
        [{ role: "user", content: "ping" }],
      );
      setTestState({ status: "success", reply });
    } catch (err) {
      setTestState({ status: "error", message: String(err) });
    }
  };

  const inputStyle = {
    backgroundColor: "var(--color-surface-2)",
    borderColor: "var(--color-border-strong)",
    color: "var(--color-text)",
  } as const;

  return (
    <div
      className="flex flex-col gap-4 rounded-[var(--radius-md)] border p-4"
      style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-elevated)" }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          {t("connections.fields.name")}
          <input
            className="rounded-[var(--radius-sm)] border px-2 py-1.5"
            style={inputStyle}
            value={draft.name}
            placeholder={t("connections.fields.namePlaceholder") ?? ""}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          {t("connections.fields.provider")}
          <select
            className="rounded-[var(--radius-sm)] border px-2 py-1.5"
            style={inputStyle}
            value={draft.provider}
            onChange={(e) => setDraft({ ...draft, provider: e.target.value as Provider })}
          >
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {t(`connections.providers.${p}`)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          {t("connections.fields.model")}
          <input
            className="rounded-[var(--radius-sm)] border px-2 py-1.5"
            style={inputStyle}
            value={draft.model}
            placeholder={t("connections.fields.modelPlaceholder") ?? ""}
            onChange={(e) => setDraft({ ...draft, model: e.target.value })}
          />
        </label>

        {draft.provider === "openai" && (
          <label className="flex flex-col gap-1 text-sm">
            {t("connections.fields.baseUrl")}
            <input
              className="rounded-[var(--radius-sm)] border px-2 py-1.5"
              style={inputStyle}
              value={draft.baseUrl ?? ""}
              placeholder={t("connections.fields.baseUrlPlaceholder") ?? ""}
              onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value || null })}
            />
            <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>
              {t("connections.fields.baseUrlHint")}
            </span>
          </label>
        )}

        <label className="flex flex-col gap-1 text-sm">
          {t("connections.fields.temperature")}
          <input
            type="number"
            step="0.05"
            min="0"
            max="2"
            className="rounded-[var(--radius-sm)] border px-2 py-1.5"
            style={inputStyle}
            value={draft.temperature}
            onChange={(e) => setDraft({ ...draft, temperature: Number(e.target.value) })}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          {t("connections.fields.topP")}
          <input
            type="number"
            step="0.05"
            min="0"
            max="1"
            className="rounded-[var(--radius-sm)] border px-2 py-1.5"
            style={inputStyle}
            value={draft.topP}
            onChange={(e) => setDraft({ ...draft, topP: Number(e.target.value) })}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          {t("connections.fields.maxTokens")}
          <input
            type="number"
            min="1"
            className="rounded-[var(--radius-sm)] border px-2 py-1.5"
            style={inputStyle}
            value={draft.maxTokens}
            onChange={(e) => setDraft({ ...draft, maxTokens: Number(e.target.value) })}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          {t("connections.fields.contextBudget")}
          <input
            type="number"
            min="1"
            className="rounded-[var(--radius-sm)] border px-2 py-1.5"
            style={inputStyle}
            value={draft.contextBudget}
            onChange={(e) => setDraft({ ...draft, contextBudget: Number(e.target.value) })}
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t pt-3" style={{ borderColor: "var(--color-border)" }}>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || !draft.name || !draft.model}
          className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          style={{ backgroundColor: "var(--color-accent)", color: "var(--color-accent-contrast)" }}
        >
          {t("actions.save", { ns: "common" })}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm"
          style={{ color: "var(--color-text-muted)" }}
        >
          {t("actions.cancel", { ns: "common" })}
        </button>
        {onDelete && (
          <button
            type="button"
            onClick={() => {
              if (confirm(t("connections.deleteConfirm") ?? "")) void onDelete();
            }}
            className="ml-auto rounded-[var(--radius-sm)] px-3 py-1.5 text-sm"
            style={{ color: "var(--color-danger)" }}
          >
            {t("actions.delete", { ns: "common" })}
          </button>
        )}
      </div>

      {savedId && (
        <div className="flex flex-col gap-2 border-t pt-3" style={{ borderColor: "var(--color-border)" }}>
          <span className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>
            {t("connections.fields.apiKey")}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="password"
              className="min-w-[14rem] flex-1 rounded-[var(--radius-sm)] border px-2 py-1.5 text-sm"
              style={inputStyle}
              value={apiKeyInput}
              placeholder={t("connections.apiKey.placeholder") ?? ""}
              onChange={(e) => setApiKeyInput(e.target.value)}
            />
            <button
              type="button"
              onClick={() => void handleSaveKey()}
              disabled={!apiKeyInput.trim()}
              className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm disabled:opacity-50"
              style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text)" }}
            >
              {t("connections.apiKey.save")}
            </button>
            {keySaved && (
              <button
                type="button"
                onClick={() => void handleDeleteKey()}
                className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm"
                style={{ color: "var(--color-danger)" }}
              >
                {t("connections.apiKey.delete")}
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: keySaved ? "var(--color-success)" : "var(--color-text-faint)" }}
            />
            <span style={{ color: "var(--color-text-muted)" }}>
              {keySaved ? t("connections.apiKey.saved") : t("connections.apiKey.notSaved")}
            </span>
          </div>
          <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>
            {t("connections.apiKey.neverShown")}
          </span>

          <div className="mt-1 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void handleTest()}
              disabled={!keySaved || testState.status === "running"}
              className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm disabled:opacity-50"
              style={{ backgroundColor: "var(--color-brass)", color: "var(--color-accent-contrast)" }}
            >
              {testState.status === "running"
                ? t("connections.test.running")
                : t("connections.test.button")}
            </button>
            {testState.status === "success" && (
              <span className="text-xs" style={{ color: "var(--color-success)" }}>
                {t("connections.test.success", { reply: testState.reply.slice(0, 120) })}
              </span>
            )}
            {testState.status === "error" && (
              <span className="text-xs" style={{ color: "var(--color-danger)" }}>
                {t("connections.test.failure", { message: testState.message })}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
