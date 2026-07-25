import { useTranslation } from "react-i18next";

import type { Character } from "../../db/repositories/charactersRepo";
import type { Persona } from "../../db/repositories/personasRepo";
import type { ConnectionConfig } from "../../providers/types";
import { avatarSrc } from "../characters/avatarSrc";
import { inputStyle } from "../common/inputStyle";
import type { useNewChatForm } from "./useNewChatForm";

export function NewChatForm({
  form,
  characters,
  connections,
  personas,
  onCreate,
  onCancel,
}: {
  form: ReturnType<typeof useNewChatForm>;
  characters: Character[];
  connections: ConnectionConfig[];
  personas: Persona[];
  onCreate: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation(["chat", "common"]);

  return (
    <div
      className="flex flex-col gap-3 rounded-[var(--radius-md)] border p-4"
      style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-elevated)" }}
    >
      <label className="flex flex-col gap-1 text-sm">
        {t("newChat.titleLabel")}
        <input
          className="rounded-[var(--radius-sm)] border px-2 py-1.5"
          style={inputStyle}
          value={form.newTitle}
          placeholder={t("newChat.titlePlaceholder") ?? ""}
          onChange={(e) => form.setNewTitle(e.target.value)}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t("newChat.connectionLabel")}
        <select
          className="rounded-[var(--radius-sm)] border px-2 py-1.5"
          style={inputStyle}
          value={form.newConnectionId}
          onChange={(e) => form.setNewConnectionId(e.target.value)}
        >
          {connections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      {connections.length === 0 && (
        <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>
          {t("newChat.noConnectionsHint")}
        </p>
      )}

      <label className="flex flex-col gap-1 text-sm">
        <span>{t("newChat.embeddingConnectionLabel")}</span>
        <select
          className="rounded-[var(--radius-sm)] border px-2 py-1.5"
          style={inputStyle}
          value={form.newEmbeddingConnectionId}
          onChange={(e) => form.setNewEmbeddingConnectionId(e.target.value)}
        >
          <option value="">{t("list.noConnection", { ns: "chat" })}</option>
          {connections.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>
          {t("newChat.embeddingConnectionHelp")}
        </span>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span>{t("newChat.imageConnectionLabel")}</span>
        <select
          className="rounded-[var(--radius-sm)] border px-2 py-1.5"
          style={inputStyle}
          value={form.newImageConnectionId}
          onChange={(e) => form.setNewImageConnectionId(e.target.value)}
        >
          <option value="">{t("list.noConnection", { ns: "chat" })}</option>
          {connections.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>
          {t("newChat.imageConnectionHelp")}
        </span>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span>{t("newChat.tagExtractionConnectionLabel")}</span>
        <select
          className="rounded-[var(--radius-sm)] border px-2 py-1.5"
          style={inputStyle}
          value={form.newTagExtractionConnectionId}
          onChange={(e) => form.setNewTagExtractionConnectionId(e.target.value)}
        >
          <option value="">{t("list.noConnection", { ns: "chat" })}</option>
          {connections.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>
          {t("newChat.tagExtractionConnectionHelp")}
        </span>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span>{t("newChat.gameLanguage")}</span>
        <select
          className="rounded-[var(--radius-sm)] border px-2 py-1.5"
          style={inputStyle}
          value={form.newGameLanguage}
          onChange={(e) => form.setNewGameLanguage(e.target.value)}
        >
          <option value="cs">Čeština</option>
          <option value="en">English</option>
        </select>
        <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>
          {t("newChat.gameLanguageHelp")}
        </span>
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.newHardcoreMode}
          onChange={(e) => form.setNewHardcoreMode(e.target.checked)}
        />
        <span className="flex flex-col">
          <span style={{ color: form.newHardcoreMode ? "var(--color-danger)" : undefined }}>
            {t("newChat.hardcoreMode")}
          </span>
          <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>
            {t("newChat.hardcoreModeHelp")}
          </span>
        </span>
      </label>

      <div className="flex flex-col gap-1 text-sm">
        {t("newChat.charactersLabel")}
        <div
          className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-[var(--radius-sm)] border p-2"
          style={inputStyle}
        >
          {characters.map((c) => (
            <label key={c.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.newCharacterIds.includes(c.id)}
                onChange={() => form.toggleCharacter(c.id)}
              />
              {avatarSrc(c.avatarPath) && (
                <img
                  src={avatarSrc(c.avatarPath)}
                  alt=""
                  className="h-5 w-5 rounded-full object-cover"
                />
              )}
              <span className="truncate">{c.name}</span>
            </label>
          ))}
        </div>
      </div>

      {characters.length === 0 && (
        <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>
          {t("newChat.noCharactersHint")}
        </p>
      )}

      {form.newCharacterIds.length > 1 && (
        <label className="flex flex-col gap-1 text-sm">
          {t("newChat.greetingCharacterLabel")}
          <select
            className="rounded-[var(--radius-sm)] border px-2 py-1.5"
            style={inputStyle}
            value={form.starterCharacterId}
            onChange={(e) => form.setStarterCharacterId(e.target.value)}
          >
            {form.newCharacterIds.map((id) => (
              <option key={id} value={id}>
                {characters.find((c) => c.id === id)?.name ?? id}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="flex flex-col gap-1 text-sm">
        {t("newChat.personaLabel")}
        <select
          className="rounded-[var(--radius-sm)] border px-2 py-1.5"
          style={inputStyle}
          value={form.newPersonaId}
          onChange={(e) => form.setNewPersonaId(e.target.value)}
        >
          <option value="">{t("newChat.noPersona")}</option>
          {personas.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.isDefault ? ` (${t("newChat.defaultPersonaTag")})` : ""}
            </option>
          ))}
        </select>
      </label>

      {form.greetingChoices.length > 1 && (
        <label className="flex flex-col gap-1 text-sm">
          {t("newChat.greetingLabel")}
          <select
            className="rounded-[var(--radius-sm)] border px-2 py-1.5"
            style={inputStyle}
            value={form.newGreeting}
            onChange={(e) => form.setNewGreeting(e.target.value)}
          >
            {form.greetingChoices.map((g, i) => (
              <option key={i} value={g}>
                {g.slice(0, 60)}
                {g.length > 60 ? "…" : ""}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCreate}
          disabled={connections.length === 0 || characters.length === 0 || form.newCharacterIds.length === 0}
          className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          style={{ backgroundColor: "var(--color-accent)", color: "var(--color-accent-contrast)" }}
        >
          {t("newChat.create")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm transition-colors"
          style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text)" }}
        >
          {t("actions.cancel", { ns: "common" })}
        </button>
      </div>
    </div>
  );
}
