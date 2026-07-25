import { showConfirm } from "../../platform";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { useCharactersStore } from "../../stores/charactersStore";
import { useChatListStore } from "../../stores/chatListStore";
import { useConnectionsStore } from "../../stores/connectionsStore";
import { usePersonasStore } from "../../stores/personasStore";
import { usePresetsStore } from "../../stores/presetsStore";
import { useUndoToast } from "../useUndoToast";
import { useUnreadStore } from "../../stores/unreadStore";
import { inputStyle } from "../common/inputStyle";
import { useNewChatForm } from "./useNewChatForm";
import { useChatSearch } from "./useChatSearch";
import { useChatListData } from "./useChatListData";
import { NewChatForm } from "./NewChatForm";
import { ChatSearchResults } from "./ChatSearchResults";
import { ChatListItem } from "./ChatListItem";

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
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const { getUnread } = useUnreadStore();

  const { searchTerm, setSearchTerm, searchHits } = useChatSearch();
  const { allMembers, messageCounts } = useChatListData(loaded, chats);

  const form = useNewChatForm({
    characters,
    charactersLoaded,
    personas,
    personasLoaded,
    connections,
    create,
    t,
    navigate,
  });

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
    if (!personasLoaded) void loadPersonas();
  }, [personasLoaded, loadPersonas]);

  useEffect(() => {
    if (!presetsLoaded) void loadPresets();
  }, [presetsLoaded, loadPresets]);

  const startRename = (id: string, currentTitle: string) => {
    setRenamingId(id);
    setRenameValue(currentTitle);
  };

  const commitRename = async (id: string) => {
    const title = renameValue.trim();
    setRenamingId(null);
    if (title) await rename(id, title);
  };

  const handleDelete = async (chatId: string) => {
    if (!await showConfirm(t("list.deleteConfirm") ?? "")) return;
    const deletedChat = chats.find((c) => c.id === chatId);
    await remove(chatId);
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
            hardcoreMode: deletedChat.hardcoreMode,
          });
          await load();
        },
      );
    }
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
        <NewChatForm
          form={form}
          characters={characters}
          connections={connections}
          personas={personas}
          onCreate={() => void (async () => { await form.handleCreate(); setCreating(false); })()}
          onCancel={() => setCreating(false)}
        />
      )}

      <input
        className="rounded-[var(--radius-md)] border px-3 py-2 text-sm"
        style={inputStyle}
        value={searchTerm}
        placeholder={t("list.searchPlaceholder") ?? ""}
        onChange={(e) => setSearchTerm(e.target.value)}
      />

      {searchHits !== null && (
        <ChatSearchResults searchHits={searchHits} searchTerm={searchTerm} chats={chats} />
      )}

      {chats.length === 0 && !creating && (
        <p className="text-sm" style={{ color: "var(--color-text-faint)" }}>
          {t("empty")}
        </p>
      )}

      {searchHits === null && (
      <ul className="flex flex-col gap-2">
        {chats.map((chat) => {
          const count = messageCounts[chat.id];
          const unreadCount = count === undefined ? null : getUnread(chat.id, count);
          return (
            <ChatListItem
              key={chat.id}
              chat={chat}
              characters={characters}
              connections={connections}
              personas={personas}
              presets={presets}
              allMembers={allMembers}
              unreadCount={unreadCount}
              isRenaming={renamingId === chat.id}
              renameValue={renameValue}
              onRenameValueChange={setRenameValue}
              onStartRename={() => startRename(chat.id, chat.title)}
              onCommitRename={() => void commitRename(chat.id)}
              onCancelRename={() => setRenamingId(null)}
              onDelete={() => void handleDelete(chat.id)}
              onSetConnection={(connectionId) => void setConnection(chat.id, connectionId)}
              onSetPersona={(personaId) => void setPersona(chat.id, personaId)}
              onSetPreset={(presetId) => void setPreset(chat.id, presetId)}
            />
          );
        })}
      </ul>
      )}
    </div>
  );
}
