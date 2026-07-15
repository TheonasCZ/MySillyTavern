import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";

import { getChat, type Chat } from "../../db/repositories/chatsRepo";
import { useChatStore } from "../../stores/chatStore";
import { useConnectionsStore } from "../../stores/connectionsStore";
import { ChatInput } from "./ChatInput";
import { MessageList } from "./MessageList";

export function ChatScreen() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation(["chat", "common"]);
  const {
    chatId,
    messages,
    loading,
    streaming,
    streamingMessageId,
    streamingText,
    error,
    openChat,
    closeChat,
    sendMessage,
    regenerate,
    editMessage,
    switchSwipe,
    stop,
    dismissError,
  } = useChatStore();
  const { connections, loaded: connectionsLoaded, load: loadConnections } = useConnectionsStore();
  const [chat, setChat] = useState<Chat | null>(null);

  useEffect(() => {
    if (!connectionsLoaded) void loadConnections();
  }, [connectionsLoaded, loadConnections]);

  useEffect(() => {
    if (!id) return;
    void openChat(id);
    void getChat(id).then(setChat);
    return () => {
      void closeChat();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!id) return null;

  const connection = chat?.connectionId
    ? connections.find((c) => c.id === chat.connectionId)
    : undefined;

  return (
    <div className="flex h-full flex-col">
      <header
        className="flex items-center justify-between gap-3 border-b px-4 py-3 sm:px-8"
        style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-elevated)" }}
      >
        <div className="flex items-center gap-3 overflow-hidden">
          <button
            type="button"
            onClick={() => navigate("/")}
            className="shrink-0 text-sm"
            style={{ color: "var(--color-text-muted)" }}
          >
            ← {t("room.backToList")}
          </button>
          <h1 className="truncate font-[var(--font-display)] text-lg">{chat?.title}</h1>
        </div>
        <span className="shrink-0 text-xs" style={{ color: "var(--color-text-faint)" }}>
          {connection ? `${t("room.connectionLabel")} ${connection.name}` : t("room.errors.noConnection")}
        </span>
      </header>

      {error && (
        <div
          className="mx-4 mt-3 flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border px-3 py-2 text-sm sm:mx-8"
          style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}
        >
          <span>
            {error === "no-connection"
              ? t("room.errors.noConnection")
              : t("room.errors.generic", { message: error })}
          </span>
          <button type="button" onClick={dismissError} className="shrink-0 opacity-80 hover:opacity-100">
            {t("actions.close", { ns: "common" })}
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <span className="text-sm" style={{ color: "var(--color-text-faint)" }}>
            {t("state.loading", { ns: "common" })}
          </span>
        </div>
      ) : (
        <MessageList
          messages={chatId === id ? messages : []}
          streaming={streaming}
          streamingMessageId={streamingMessageId}
          streamingText={streamingText}
          onEdit={(messageId, content) => void editMessage(messageId, content)}
          onRegenerate={(messageId) => void regenerate(messageId)}
          onSwipe={(messageId, offset) => void switchSwipe(messageId, offset)}
        />
      )}

      <ChatInput
        disabled={loading || !connection}
        streaming={streaming}
        onSend={(content) => void sendMessage(content)}
        onStop={() => void stop()}
      />
    </div>
  );
}
