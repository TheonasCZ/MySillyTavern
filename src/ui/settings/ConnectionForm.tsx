import { showConfirm } from "../../platform";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { invoke } from "@tauri-apps/api/core";

import { getConnection } from "../../db/repositories/connectionsRepo";
import { chatComplete } from "../../providers/chatComplete";
import { toConnectionDto } from "../../providers/dto";
import { embedTexts } from "../../providers/embeddings";
import { deleteApiKey, hasApiKey, saveApiKey } from "../../providers/keyring";
import { listModels } from "../../providers/models";
import type { ConnectionConfig, ConnectionDraft, ConnectionPurpose, Provider } from "../../providers/types";
import { FieldHelp } from "../common/FieldHelp";
import { inputStyle } from "../common/inputStyle";

/** Embedding and image models don't support chat completion, so testing
 * them via `chatComplete` fails regardless of which valid model is picked
 * (embedding: 404s; image-only models like gemini-2.5-flash-image: 400
 * "Thinking is not enabled for this model", since chatComplete's request
 * shape assumes a reasoning-capable chat model). Ping each purpose's
 * actual endpoint instead. */
async function pingConnection(cfg: ConnectionConfig): Promise<string> {
  if (cfg.purpose === "embedding") {
    const { model, vectors } = await embedTexts(cfg, ["ping"], cfg.model);
    return `OK (${model}, ${vectors[0]?.length ?? 0}d)`;
  }
  if (cfg.purpose === "image") {
    await invoke<string>("generate_illustration", {
      connection: toConnectionDto(cfg),
      prompt: "a small red circle on white background",
    });
    return "OK";
  }
  return chatComplete(cfg, [{ role: "user", content: "ping" }]);
}

const PROVIDERS: Provider[] = ["gemini", "openai", "claude"];

/** Detect provider from API key format. */
function detectProvider(key: string): Provider | null {
  const k = key.trim();
  if (k.startsWith("AIza")) return "gemini";
  if (k.startsWith("sk-ant-")) return "claude";
  if (k.startsWith("sk-")) return "openai";
  return null;
}

const DEFAULT_DRAFT: ConnectionDraft = {
  name: "",
  provider: "gemini",
  purpose: "chat",
  baseUrl: null,
  model: "",
  temperature: 1.0,
  topP: 0.95,
  maxTokens: 4096,
  contextBudget: 22000,
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
          purpose: initial.purpose,
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
  const [models, setModels] = useState<string[] | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [manualModel, setManualModel] = useState(false);

  const refreshKeyStatus = async (connectionId: string) => {
    const has = await hasApiKey(connectionId);
    setKeySaved(has);
  };

  useEffect(() => {
    if (savedId) void refreshKeyStatus(savedId);
  }, [savedId]);

  // Helper: save connection + key, then test + load models
  const setupAndTest = useCallback(async () => {
    if (!apiKeyInput.trim()) return;
    setSaving(true);
    setTestState({ status: "running" });
    try {
      // Save connection first (if not yet saved)
      let id = savedId;
      if (!id) {
        const saved = await onSave(draft);
        id = saved.id;
        setSavedId(id);
      }
      // Save API key
      await saveApiKey(id, apiKeyInput.trim());
      setApiKeyInput("");
      await refreshKeyStatus(id);
      const cfg = await getConnection(id);
      if (!cfg) throw new Error("Připojení nenalezeno po uložení.");
      // Load models first — this only needs a valid key, not a model, so it
      // works even on a brand-new connection with no model picked yet. Doing
      // the real ping test first (as this used to) meant a fresh connection
      // could never get past step one: chatComplete/embedTexts need a model
      // to build the request URL, which doesn't exist until this list loads.
      setModelsLoading(true);
      setModelsError(null);
      const list = await listModels(id, draft.provider, draft.baseUrl, draft.purpose);
      setModels(list);
      setManualModel(false);
      setModelsLoading(false);
      // Only attempt the real test once there's a model to test with.
      if (cfg.model.trim()) {
        const reply = await pingConnection(cfg);
        setTestState({ status: "success", reply });
      } else {
        setTestState({ status: "idle" });
      }
      onCreated?.(cfg);
    } catch (err) {
      setTestState({ status: "error", message: String(err) });
    } finally {
      setSaving(false);
    }
  }, [apiKeyInput, savedId, draft, onSave, onCreated]);

  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const saved = await onSave(draft);
      setSavedId(saved.id);
      if (!initial) {
        await refreshKeyStatus(saved.id);
        onCreated?.(saved);
      }
      setSaveMsg("✅ " + t("connections.saved"));
      setTimeout(() => setSaveMsg(null), 2000);
    } catch (err) {
      setTestState({ status: "error", message: String(err) });
    } finally {
      setSaving(false);
    }
  };

  const handleTestAndLoad = async () => {
    if (!savedId) return;
    setTestState({ status: "running" });
    try {
      const cfg = await getConnection(savedId);
      if (!cfg) throw new Error("Připojení nenalezeno.");
      // Same ordering as setupAndTest: load models first (needs only the
      // key), only ping if a model is actually picked.
      setModelsLoading(true);
      const list = await listModels(savedId, draft.provider, draft.baseUrl, draft.purpose);
      setModels(list);
      setManualModel(false);
      if (cfg.model.trim()) {
        await pingConnection(cfg);
        setTestState({ status: "success", reply: "OK" });
      } else {
        setTestState({ status: "idle" });
      }
    } catch (err) {
      setTestState({ status: "error", message: String(err) });
    } finally {
      setModelsLoading(false);
    }
  };

  // Detect provider from API key format on input change
  const handleApiKeyChange = (val: string) => {
    setApiKeyInput(val);
    const detected = detectProvider(val);
    if (detected && draft.provider !== detected) {
      setDraft((d) => ({ ...d, provider: detected }));
    }
  };

  return (
    <div
      className="flex flex-col gap-4 rounded-[var(--radius-md)] border p-4"
      style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-elevated)" }}
    >
      {/* Row 1: Name + Provider + Purpose */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="flex items-center gap-1">
            {t("connections.fields.name")}
            <FieldHelp text={t("connections.help.name")} />
          </span>
          <input
            className="rounded-[var(--radius-sm)] border px-2 py-1.5"
            style={inputStyle}
            value={draft.name}
            placeholder={t("connections.fields.namePlaceholder") ?? ""}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="flex items-center gap-1">
            {t("connections.fields.provider")}
            <FieldHelp text={t("connections.help.provider")} />
          </span>
          <select
            className="rounded-[var(--radius-sm)] border px-2 py-1.5"
            style={inputStyle}
            value={draft.provider}
            onChange={(e) => {
              setDraft({ ...draft, provider: e.target.value as Provider });
              setModels(null);
              setModelsError(null);
            }}
          >
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {t(`connections.providers.${p}`)}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-col gap-1 text-sm">
          <span className="flex items-center gap-1">
            {t("connections.fields.purpose")}
            <FieldHelp text={t("connections.help.purpose")} />
          </span>
          <select
            value={draft.purpose}
            onChange={(e) => setDraft({ ...draft, purpose: e.target.value as ConnectionPurpose })}
            className="rounded-[var(--radius-sm)] border px-2 py-1.5"
            style={inputStyle}
          >
            {(["chat", "image", "embedding"] as ConnectionPurpose[]).map((p) => (
              <option key={p} value={p}>{t(`connections.purposes.${p}`)}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Row 2: API Key + auto-detect */}
      <label className="flex flex-col gap-1 text-sm">
        <span className="flex items-center gap-1">
          {t("connections.fields.apiKey")}
          <FieldHelp text={t("connections.help.apiKey")} />
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="password"
            className="min-w-[14rem] flex-1 rounded-[var(--radius-sm)] border px-2 py-1.5 text-sm"
            style={inputStyle}
            value={apiKeyInput}
            placeholder={t("connections.apiKey.placeholder") ?? ""}
            onChange={(e) => handleApiKeyChange(e.target.value)}
          />
          {!savedId ? (
            <button
              type="button"
              onClick={() => void setupAndTest()}
              disabled={saving || !draft.name || !apiKeyInput.trim()}
              className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
              style={{ backgroundColor: "var(--color-accent)", color: "var(--color-accent-contrast)" }}
            >
              {saving ? "⏳" : ""} {t("connections.createAndTest")}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void setupAndTest()}
                disabled={!apiKeyInput.trim()}
                className="rounded-[var(--radius-sm)] px-2 py-1.5 text-xs disabled:opacity-50"
                style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text)" }}
              >
                {t("connections.apiKey.save")}
              </button>
              {keySaved && (
                <button
                  type="button"
                  onClick={async () => {
                    await deleteApiKey(savedId);
                    await refreshKeyStatus(savedId);
                  }}
                  className="rounded-[var(--radius-sm)] px-2 py-1.5 text-xs"
                  style={{ color: "var(--color-danger)" }}
                >
                  {t("connections.apiKey.delete")}
                </button>
              )}
            </>
          )}
        </div>
        {savedId && (
          <div className="flex items-center gap-2 text-xs mt-1">
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: keySaved ? "var(--color-success)" : "var(--color-text-faint)" }}
            />
            <span style={{ color: "var(--color-text-muted)" }}>
              {keySaved ? t("connections.apiKey.saved") : t("connections.apiKey.notSaved")}
            </span>
          </div>
        )}
      </label>

      {/* Row 3: Model */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="flex items-center gap-1">
            {t("connections.fields.model")}
            <FieldHelp text={t("connections.help.model")} />
          </span>
          {models && models.length > 0 && !manualModel ? (
            <select
              className="rounded-[var(--radius-sm)] border px-2 py-1.5"
              style={inputStyle}
              value={draft.model}
              onChange={(e) => setDraft({ ...draft, model: e.target.value })}
            >
              {!models.includes(draft.model) && (
                <option value={draft.model}>
                  {draft.model || t("connections.models.choose")}
                </option>
              )}
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="rounded-[var(--radius-sm)] border px-2 py-1.5"
              style={inputStyle}
              value={draft.model}
              placeholder={t("connections.fields.modelPlaceholder") ?? ""}
              onChange={(e) => setDraft({ ...draft, model: e.target.value })}
            />
          )}
          <span className="flex flex-wrap items-center gap-2 text-xs mt-1">
            {models && models.length > 0 && (
              <button
                type="button"
                onClick={() => setManualModel(!manualModel)}
                className="underline"
                style={{ color: "var(--color-text-muted)" }}
              >
                {manualModel ? t("connections.models.pick") : t("connections.models.manual")}
              </button>
            )}
            {modelsLoading && <span style={{ color: "var(--color-text-faint)" }}>{t("connections.models.loading")}</span>}
            {modelsError && <span style={{ color: "var(--color-danger)" }}>{modelsError}</span>}
          </span>
        </label>

        {draft.provider === "openai" && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="flex items-center gap-1">
              {t("connections.fields.baseUrl")}
              <FieldHelp text={t("connections.help.baseUrl")} />
            </span>
            <input
              className="rounded-[var(--radius-sm)] border px-2 py-1.5"
              style={inputStyle}
              value={draft.baseUrl ?? ""}
              placeholder={t("connections.fields.baseUrlPlaceholder") ?? ""}
              onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value || null })}
            />
          </label>
        )}
      </div>

      {/* Row 4: Temperature + Top P + Max Tokens + Context Budget — only
          chat completion uses any of these. Embedding is model + text in,
          vector out; image generation (image_gen.rs) hardcodes its own
          generationConfig (responseModalities/aspectRatio/imageSize) and
          never touches temperature/topP/maxTokens/contextBudget either. */}
      {draft.purpose === "chat" && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="flex items-center gap-1">
              {t("connections.fields.temperature")}
              <FieldHelp text={t("connections.help.temperature")} />
            </span>
            <input
              type="number" min={0} max={2} step={0.1}
              className="rounded-[var(--radius-sm)] border px-2 py-1.5"
              style={inputStyle}
              value={draft.temperature}
              onChange={(e) => setDraft({ ...draft, temperature: parseFloat(e.target.value) || 0 })}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="flex items-center gap-1">
              {t("connections.fields.topP")}
              <FieldHelp text={t("connections.help.topP")} />
            </span>
            <input
              type="number" min={0} max={1} step={0.05}
              className="rounded-[var(--radius-sm)] border px-2 py-1.5"
              style={inputStyle}
              value={draft.topP}
              onChange={(e) => setDraft({ ...draft, topP: parseFloat(e.target.value) || 0 })}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="flex items-center gap-1">
              {t("connections.fields.maxTokens")}
              <FieldHelp text={t("connections.help.maxTokens")} />
            </span>
            <input
              type="number" min={1}
              className="rounded-[var(--radius-sm)] border px-2 py-1.5"
              style={inputStyle}
              value={draft.maxTokens}
              onChange={(e) => setDraft({ ...draft, maxTokens: Number(e.target.value) })}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="flex items-center gap-1">
              {t("connections.fields.contextBudget")}
              <FieldHelp text={t("connections.help.contextBudget")} />
            </span>
            <input
              type="number" min={1}
              className="rounded-[var(--radius-sm)] border px-2 py-1.5"
              style={inputStyle}
              value={draft.contextBudget}
              onChange={(e) => setDraft({ ...draft, contextBudget: Number(e.target.value) })}
            />
          </label>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-col gap-2 border-t pt-3" style={{ borderColor: "var(--color-border)" }}>
        <div className="flex flex-wrap items-center gap-2">
          {savedId && (
            <>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving || !draft.name}
                className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                style={{ backgroundColor: "var(--color-accent)", color: "var(--color-accent-contrast)" }}
              >
                {t("actions.save", { ns: "common" })}
              </button>
              <button
                type="button"
                onClick={() => void handleTestAndLoad()}
                className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm"
                style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text)" }}
              >
                {t("connections.testAndLoad")}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={onCancel}
            className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm"
            style={{ color: "var(--color-text-muted)" }}
          >
            {t("actions.close", { ns: "common" })}
          </button>
          {onDelete && savedId && (
            <button
              type="button"
              onClick={() => {
                void (async () => { if (await showConfirm(t("connections.deleteConfirm") ?? "")) void onDelete(); })();
              }}
              className="ml-auto rounded-[var(--radius-sm)] px-3 py-1.5 text-sm"
              style={{ color: "var(--color-danger)" }}
            >
              {t("actions.delete", { ns: "common" })}
            </button>
          )}
        </div>
        {testState.status === "success" && (
          <span className="text-xs" style={{ color: "var(--color-success)" }}>
            {t("connections.test.success", { reply: String(testState.reply).slice(0, 120) })}
          </span>
        )}
        {testState.status === "error" && (
          <span className="text-xs" style={{ color: "var(--color-danger)" }}>
            {t("connections.test.failure", { message: testState.message })}
          </span>
        )}
        {saveMsg && (
          <span className="text-xs" style={{ color: "var(--color-success)" }}>
            {saveMsg}
          </span>
        )}
      </div>
    </div>
  );
}
