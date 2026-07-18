import { showConfirm } from "../../platform";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { greetingOptions, resolveGreeting } from "../../chat/systemPrompt";
import { searchSnippet } from "../../chat/searchSnippet";
import { getCharacter } from "../../db/repositories/charactersRepo";
import { listAllChatMembers, type ChatMember } from "../../db/repositories/chatMembersRepo";
import { createMessage, searchMessages, type MessageSearchHit } from "../../db/repositories/messagesRepo";
import { avatarSrc } from "../characters/avatarSrc";
import { useCharactersStore } from "../../stores/charactersStore";
import { useChatListStore } from "../../stores/chatListStore";
import { useConnectionsStore } from "../../stores/connectionsStore";
import { usePersonasStore } from "../../stores/personasStore";
import { usePresetsStore } from "../../stores/presetsStore";
import { useUndoToast } from "../useUndoToast";
import { useUnreadStore } from "../../stores/unreadStore";
import { countMessages } from "../../db/repositories/messagesRepo";

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
  const { chats, loaded, load, create, rename, setConnection, setPersona, setPreset, remove } = useChatListStore();
  const { toastUndo } = useUndoToast();
  const { connections, loaded: connectionsLoaded, load: loadConnections } = useConnectionsStore();
  const {
    characters,
    loaded: charactersLoaded,
    load: loadCharacters,
  } = useCharactersStore();
  const { personas, loaded: personasLoaded, load: loadPersonas } = usePersonasStore();
  const { presets, loaded: presetsLoaded, load: loadPresets } = usePresetsStore();

  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newConnectionId, setNewConnectionId] = useState<string>("");
  /** Order of selection = roster position, first checked = primary member
   * (plan §7 M10 group create form). */
  const [newCharacterIds, setNewCharacterIds] = useState<string[]>([]);
  const [starterCharacterId, setStarterCharacterId] = useState<string>("");
  const [newPersonaId, setNewPersonaId] = useState<string>("");
  const [newGreeting, setNewGreeting] = useState<string>("");
  const [newGameLanguage, setNewGameLanguage] = useState<string>("cs");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [searchHits, setSearchHits] = useState<MessageSearchHit[] | null>(null);
  const [allMembers, setAllMembers] = useState<ChatMember[]>([]);
  const [messageCounts, setMessageCounts] = useState<Record<string, number>>({});
  const { getUnread } = useUnreadStore();

  // Debounced fulltext search across all chats' messages; cleared below
  // two characters so casual typing doesn't fire queries.
  useEffect(() => {
    const term = searchTerm.trim();
    if (term.length < 2) {
      setSearchHits(null);
      return;
    }
    const handle = setTimeout(() => {
      void searchMessages(term).then((hits) => setSearchHits(hits));
    }, 250);
    return () => clearTimeout(handle);
  }, [searchTerm]);

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  useEffect(() => {
    if (loaded) void listAllChatMembers().then(setAllMembers);
  }, [loaded]);

  // Load message counts for unread badges
  useEffect(() => {
    if (!loaded || chats.length === 0) return;
    void (async () => {
      const counts: Record<string, number> = {};
      await Promise.all(
        chats.map(async (c) => {
          counts[c.id] = await countMessages(c.id);
        }),
      );
      setMessageCounts(counts);
    })();
  }, [loaded, chats]);

  useEffect(() => {
    if (!connectionsLoaded) void loadConnections();
  }, [connectionsLoaded, loadConnections]);

  useEffect(() => {
    if (!charactersLoaded) void loadCharacters();
  }, [charactersLoaded, loadCharacters]);

  useEffect(() => {
    if (!personasLoaded) void loadPersonas();
  }, [personasLoaded, loadPersonas]);

  useEffect(() => {
    if (!presetsLoaded) void loadPresets();
  }, [presetsLoaded, loadPresets]);

  useEffect(() => {
    if (connections.length > 0 && !newConnectionId) {
      setNewConnectionId(connections[0].id);
    }
  }, [connections, newConnectionId]);

  useEffect(() => {
    if (characters.length > 0 && newCharacterIds.length === 0) {
      setNewCharacterIds([characters[0].id]);
    }
  }, [characters, newCharacterIds.length]);

  const toggleCharacter = (id: string) => {
    setNewCharacterIds((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    );
  };

  // The "who starts" pick must stay one of the checked characters — reset to
  // the primary (first checked) whenever it falls out of the selection.
  useEffect(() => {
    if (newCharacterIds.length === 0) {
      setStarterCharacterId("");
    } else if (!newCharacterIds.includes(starterCharacterId)) {
      setStarterCharacterId(newCharacterIds[0]);
    }
  }, [newCharacterIds, starterCharacterId]);

  useEffect(() => {
    if (personas.length > 0 && !newPersonaId) {
      const def = personas.find((p) => p.isDefault) ?? personas[0];
      setNewPersonaId(def.id);
    }
  }, [personas, newPersonaId]);

  const selectedCharacter = useMemo(
    () => characters.find((c) => c.id === starterCharacterId) ?? null,
    [characters, starterCharacterId],
  );

  const greetingChoices = useMemo(() => {
    if (!selectedCharacter) return [];
    return greetingOptions(selectedCharacter);
  }, [selectedCharacter]);

  useEffect(() => {
    setNewGreeting(greetingChoices[0] ?? "");
  }, [greetingChoices]);

  const handleCreate = async () => {
    if (newCharacterIds.length === 0) return;
    const title = newTitle.trim() || t("newChat.defaultTitle");
    // The starter picks first in the roster so it becomes the primary
    // member (`chat.characterId`) — `characterIds[0]` is the invariant.
    const orderedIds = [
      starterCharacterId,
      ...newCharacterIds.filter((id) => id !== starterCharacterId),
    ];
    const created = await create({
      title,
      characterIds: orderedIds,
      connectionId: newConnectionId || null,
      personaId: newPersonaId || null,
      gameLanguage: newGameLanguage,
    });

    const character = await getCharacter(starterCharacterId);
    if (character) {
      const persona = personas.find((p) => p.id === newPersonaId) ?? null;
      const greetingText = resolveGreeting(character, newGreeting || null, persona);
      if (greetingText) {
        await createMessage(created.id, "assistant", greetingText, character.id);
      }
    }

    setCreating(false);
    setNewTitle("");
    setNewGameLanguage("cs");
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
            <span>{t("newChat.gameLanguage")}</span>
            <select
              className="rounded-[var(--radius-sm)] border px-2 py-1.5"
              style={inputStyle}
              value={newGameLanguage}
              onChange={(e) => setNewGameLanguage(e.target.value)}
            >
              <option value="cs">Čeština</option>
              <option value="en">English</option>
            </select>
            <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>
              {t("newChat.gameLanguageHelp")}
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
                    checked={newCharacterIds.includes(c.id)}
                    onChange={() => toggleCharacter(c.id)}
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

          {newCharacterIds.length > 1 && (
            <label className="flex flex-col gap-1 text-sm">
              {t("newChat.greetingCharacterLabel")}
              <select
                className="rounded-[var(--radius-sm)] border px-2 py-1.5"
                style={inputStyle}
                value={starterCharacterId}
                onChange={(e) => setStarterCharacterId(e.target.value)}
              >
                {newCharacterIds.map((id) => (
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
              value={newPersonaId}
              onChange={(e) => setNewPersonaId(e.target.value)}
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
              disabled={connections.length === 0 || characters.length === 0 || newCharacterIds.length === 0}
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

      <input
        className="rounded-[var(--radius-md)] border px-3 py-2 text-sm"
        style={inputStyle}
        value={searchTerm}
        placeholder={t("list.searchPlaceholder") ?? ""}
        onChange={(e) => setSearchTerm(e.target.value)}
      />

      {searchHits !== null && (
        <div className="flex flex-col gap-2">
          <h2 className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>
            {t("list.searchResults", { count: searchHits.length })}
          </h2>
          {searchHits.length === 0 && (
            <p className="text-sm" style={{ color: "var(--color-text-faint)" }}>
              {t("list.searchEmpty")}
            </p>
          )}
          {searchHits.map((hit) => {
            const chat = chats.find((c) => c.id === hit.chatId);
            return (
              <button
                key={hit.messageId}
                type="button"
                onClick={() => navigate(`/chat/${hit.chatId}`)}
                className="flex flex-col gap-1 rounded-[var(--radius-md)] border px-4 py-2 text-left"
                style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-elevated)" }}
              >
                <span className="text-sm font-medium">{chat?.title ?? "…"}</span>
                <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                  {searchSnippet(hit.content, searchTerm.trim())}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {chats.length === 0 && !creating && (
        <p className="text-sm" style={{ color: "var(--color-text-faint)" }}>
          {t("empty")}
        </p>
      )}

      {searchHits === null && (
      <ul className="flex flex-col gap-2">
        {chats.map((chat) => (
          <li
            key={chat.id}
            className="flex cursor-pointer flex-col gap-2 rounded-[var(--radius-md)] border px-4 py-3 transition-colors hover:border-[var(--color-border-strong)]"
            style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-elevated)" }}
            onClick={() => {
              // The whole card opens the chat; interactive children (rename
              // input, buttons, selects) stop propagation below.
              if (renamingId !== chat.id) navigate(`/chat/${chat.id}`);
            }}
          >
            <div className="flex items-center justify-between gap-2">
              {renamingId === chat.id ? (
                <input
                  autoFocus
                  className="flex-1 rounded-[var(--radius-sm)] border px-2 py-1 text-sm"
                  style={inputStyle}
                  value={renameValue}
                  onClick={(e) => e.stopPropagation()}
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
                  {(() => {
                    const count = messageCounts[chat.id];
                    if (count === undefined) return null;
                    const unread = getUnread(chat.id, count);
                    if (!unread) return null;
                    return (
                      <span
                        className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs font-bold"
                        style={{ backgroundColor: "var(--color-accent)", color: "var(--color-accent-contrast)" }}
                      >
                        {unread}
                      </span>
                    );
                  })()}
                </button>
              )}

              <div className="flex shrink-0 items-center gap-1 text-xs">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    startRename(chat.id, chat.title);
                  }}
                  className="rounded-[var(--radius-sm)] px-2 py-1"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  {t("actions.edit", { ns: "common" })}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void (async () => {
                      if (!await showConfirm(t("list.deleteConfirm") ?? "")) return;
                      const deletedChat = chats.find((c) => c.id === chat.id);
                      await remove(chat.id);
                      if (deletedChat) {
                        toastUndo(
                          `${t("deleted", { ns: "common" })}: ${deletedChat.title}`,
                          async () => {
                            // Re-create the chat with its original properties
                            const { createChat } = await import("../../db/repositories/chatsRepo");
                            await createChat({
                              title: deletedChat.title,
                              characterIds: [deletedChat.characterId],
                              connectionId: deletedChat.connectionId,
                              personaId: deletedChat.personaId,
                              
                              gameLanguage: undefined,
                            });
                            await load();
                          },
                        );
                      }
                    })();
                  }}
                  className="rounded-[var(--radius-sm)] px-2 py-1"
                  style={{ color: "var(--color-danger)" }}
                >
                  {t("actions.delete", { ns: "common" })}
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs" style={{ color: "var(--color-text-faint)" }}>
              <span>
                {(() => {
                  const memberIds = allMembers
                    .filter((m) => m.chatId === chat.id)
                    .map((m) => m.characterId);
                  const names = memberIds
                    .map((cid) => characters.find((c) => c.id === cid)?.name)
                    .filter((n): n is string => !!n);
                  return names.length > 0
                    ? names.join(", ")
                    : characters.find((c) => c.id === chat.characterId)?.name ?? "?";
                })()}
                {" · "}
                {t("list.updatedAt", { date: formatDate(chat.updatedAt) })}
              </span>
              <select
                className="rounded-[var(--radius-sm)] border px-2 py-1 text-xs"
                style={inputStyle}
                value={chat.connectionId ?? ""}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => void setConnection(chat.id, e.target.value || null)}
              >
                <option value="">{t("list.noConnection")}</option>
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <select
                className="rounded-[var(--radius-sm)] border px-2 py-1 text-xs"
                style={inputStyle}
                value={chat.personaId ?? ""}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => void setPersona(chat.id, e.target.value || null)}
              >
                <option value="">{t("newChat.noPersona")}</option>
                {personas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <select
                className="rounded-[var(--radius-sm)] border px-2 py-1 text-xs"
                style={inputStyle}
                value={chat.presetId ?? ""}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => void setPreset(chat.id, e.target.value || null)}
              >
                <option value="">{t("presets.noPreset", { ns: "settings" }) ?? "No preset"}</option>
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </li>
        ))}
      </ul>
      )}
    </div>
  );
}
