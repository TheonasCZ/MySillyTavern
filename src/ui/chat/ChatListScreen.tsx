import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { greetingOptions, resolveGreeting } from "../../chat/systemPrompt";
import { getCharacter } from "../../db/repositories/charactersRepo";
import { createMessage } from "../../db/repositories/messagesRepo";
import { useCharactersStore } from "../../stores/charactersStore";
import { useChatListStore } from "../../stores/chatListStore";
import { useConnectionsStore } from "../../stores/connectionsStore";

const inputStyle = {
  backgroundColor: "var(--color-surface-2)",
  borderColor: "var(--color-border-strong)",
  color: "var(--color-text)",
} as const;

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function ChatListScreen() {
  const { t } = useTranslation(["chat", "common"]);
  const navigate = useNavigate();
  const { chats, loaded, load, create, rename, setConnection, remove } = useChatListStore();
  const { connections, loaded: connectionsLoaded, load: loadConnections } = useConnectionsStore();
  const {
    characters,
    loaded: charactersLoaded,
    load: loadCharacters,
  } = useCharactersStore();

  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newConnectionId, setNewConnectionId] = useState<string>("");
  const [newCharacterId, setNewCharacterId] = useState<string>("");
  const [newGreeting, setNewGreeting] = useState<string>("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  useEffect(() => {
    if (!connectionsLoaded) void loadConnections();
  }, [connectionsLoaded, loadConnections]);

  useEffect(() => {
    if (!charactersLoaded) void loadCharacters();
  }, [charactersLoaded, loadCharacters]);

  useEffect(() => {
    if (connections.length > 0 && !newConnectionId) {
      setNewConnectionId(connections[0].id);
    }
  }, [connections, newConnectionId]);

  useEffect(() => {
    if (characters.length > 0 && !newCharacterId) {
      setNewCharacterId(characters[0].id);
    }
  }, [characters, newCharacterId]);

  const selectedCharacter = useMemo(
    () => characters.find((c) => c.id === newCharacterId) ?? null,
    [characters, newCharacterId],
  );

  const greetingChoices = useMemo(() => {
    if (!selectedCharacter) return [];
    return greetingOptions(selectedCharacter);
  }, [selectedCharacter]);

  useEffect(() => {
    setNewGreeting(greetingChoices[0] ?? "");
  }, [greetingChoices]);

  const handleCreate = async () => {
    if (!newCharacterId) return;
    const title = newTitle.trim() || t("newChat.defaultTitle");
    const created = await create({
      title,
      characterId: newCharacterId,
      connectionId: newConnectionId || null,
    });

    const character = await getCharacter(newCharacterId);
    if (character) {
      const greetingText = resolveGreeting(character, newGreeting || null);
      if (greetingText) {
        await createMessage(created.id, "assistant", greetingText);
      }
    }

    setCreating(false);
    setNewTitle("");
    navigate(`/chat/${created.id}`);
  };

  const startRename = (id: string, currentTitle: string) => {
    setRenamingId(id);
    setRenameValue(currentTitle);
  };

  const commitRename = async (id: string) => {
    const title = renameValue.trim();
    setRenamingId(null);
    if (title) await rename(id, title);
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-8">
      <div className="flex items-center justify-between">
        <h1 className="font-[var(--font-display)] text-2xl">{t("title")}</h1>
        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium"
          style={{ backgroundColor: "var(--color-accent)", color: "var(--color-accent-contrast)" }}
        >
          {t("newChat.button")}
        </button>
      </div>

      {creating && (
        <div
          className="flex flex-col gap-3 rounded-[var(--radius-md)] border p-4"
          style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-elevated)" }}
        >
          <label className="flex flex-col gap-1 text-sm">
            {t("newChat.titleLabel")}
            <input
              className="rounded-[var(--radius-sm)] border px-2 py-1.5"
              style={inputStyle}
              value={newTitle}
              placeholder={t("newChat.titlePlaceholder") ?? ""}
              onChange={(e) => setNewTitle(e.target.value)}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            {t("newChat.connectionLabel")}
            <select
              className="rounded-[var(--radius-sm)] border px-2 py-1.5"
              style={inputStyle}
              value={newConnectionId}
              onChange={(e) => setNewConnectionId(e.target.value)}
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
            {t("newChat.characterLabel")}
            <select
              className="rounded-[var(--radius-sm)] border px-2 py-1.5"
              style={inputStyle}
              value={newCharacterId}
              onChange={(e) => setNewCharacterId(e.target.value)}
            >
              {characters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          {characters.length === 0 && (
            <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>
              {t("newChat.noCharactersHint")}
            </p>
          )}

          {greetingChoices.length > 1 && (
            <label className="flex flex-col gap-1 text-sm">
              {t("newChat.greetingLabel")}
              <select
                className="rounded-[var(--radius-sm)] border px-2 py-1.5"
                style={inputStyle}
                value={newGreeting}
                onChange={(e) => setNewGreeting(e.target.value)}
              >
                {greetingChoices.map((g, i) => (
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
              onClick={() => void handleCreate()}
              disabled={connections.length === 0 || characters.length === 0}
              className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
              style={{ backgroundColor: "var(--color-accent)", color: "var(--color-accent-contrast)" }}
            >
              {t("newChat.create")}
            </button>
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm"
              style={{ color: "var(--color-text-muted)" }}
            >
              {t("actions.cancel", { ns: "common" })}
            </button>
          </div>
        </div>
      )}

      {chats.length === 0 && !creating && (
        <p className="text-sm" style={{ color: "var(--color-text-faint)" }}>
          {t("empty")}
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {chats.map((chat) => (
          <li
            key={chat.id}
            className="flex flex-col gap-2 rounded-[var(--radius-md)] border px-4 py-3"
            style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-elevated)" }}
          >
            <div className="flex items-center justify-between gap-2">
              {renamingId === chat.id ? (
                <input
                  autoFocus
                  className="flex-1 rounded-[var(--radius-sm)] border px-2 py-1 text-sm"
                  style={inputStyle}
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void commitRename(chat.id);
                    if (e.key === "Escape") setRenamingId(null);
                  }}
                  onBlur={() => void commitRename(chat.id)}
                />
              ) : (
                <button
                  type="button"
                  className="flex-1 truncate text-left font-medium"
                  onClick={() => navigate(`/chat/${chat.id}`)}
                >
                  {chat.title}
                </button>
              )}

              <div className="flex shrink-0 items-center gap-1 text-xs">
                <button
                  type="button"
                  onClick={() => startRename(chat.id, chat.title)}
                  className="rounded-[var(--radius-sm)] px-2 py-1"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  {t("actions.edit", { ns: "common" })}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(t("list.deleteConfirm") ?? "")) void remove(chat.id);
                  }}
                  className="rounded-[var(--radius-sm)] px-2 py-1"
                  style={{ color: "var(--color-danger)" }}
                >
                  {t("actions.delete", { ns: "common" })}
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs" style={{ color: "var(--color-text-faint)" }}>
              <span>{t("list.updatedAt", { date: formatDate(chat.updatedAt) })}</span>
              <select
                className="rounded-[var(--radius-sm)] border px-2 py-1 text-xs"
                style={inputStyle}
                value={chat.connectionId ?? ""}
                onChange={(e) => void setConnection(chat.id, e.target.value || null)}
              >
                <option value="">{t("list.noConnection")}</option>
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
