import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";

import { getChat, type Chat } from "../../db/repositories/chatsRepo";
import { MemoryPanel } from "../memory/MemoryPanel";
import { useChatListStore } from "../../stores/chatListStore";
import { useChatStore } from "../../stores/chatStore";
import { useConnectionsStore } from "../../stores/connectionsStore";
import { usePersonasStore } from "../../stores/personasStore";
import { ChatInput } from "./ChatInput";
import { MessageList } from "./MessageList";

const selectStyle = {
  backgroundColor: "var(--color-surface-2)",
  borderColor: "var(--color-border-strong)",
  color: "var(--color-text)",
} as const;

export function ChatScreen() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation(["chat", "common", "memory"]);
  const {
    chatId,
    messages,
    loading,
    streaming,
    streamingMessageId,
    streamingText,
    error,
    errorRetryable,
    retry,
    interruptedMessageIds,
    hasOlderMessages,
    loadingOlderMessages,
    openChat,
    closeChat,
    loadOlderMessages,
    sendMessage,
    regenerate,
    continueMessage,
    editMessage,
    switchSwipe,
    stop,
    dismissError,
  } = useChatStore();
  const { connections, loaded: connectionsLoaded, load: loadConnections } = useConnectionsStore();
  const { personas, loaded: personasLoaded, load: loadPersonas } = usePersonasStore();
  const { setPersona } = useChatListStore();
  const [chat, setChat] = useState<Chat | null>(null);
  const [memoryOpen, setMemoryOpen] = useState(false);

  useEffect(() => {
    if (!connectionsLoaded) void loadConnections();
  }, [connectionsLoaded, loadConnections]);

  useEffect(() => {
    if (!personasLoaded) void loadPersonas();
  }, [personasLoaded, loadPersonas]);

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
        <div className="flex shrink-0 items-center gap-3">
          <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>
            {connection ? `${t("room.connectionLabel")} ${connection.name}` : t("room.errors.noConnection")}
          </span>
          <select
            className="rounded-[var(--radius-sm)] border px-2 py-1 text-xs"
            style={selectStyle}
            value={chat?.personaId ?? ""}
            onChange={async (e) => {
              const personaId = e.target.value || null;
              await setPersona(id, personaId);
              setChat((c) => (c ? { ...c, personaId } : c));
            }}
            title={t("room.personaLabel") ?? ""}
          >
            <option value="">{t("room.noPersona")}</option>
            {personas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setMemoryOpen((v) => !v)}
            aria-pressed={memoryOpen}
            className="rounded-[var(--radius-sm)] border px-2 py-1 text-xs transition-colors"
            style={{
              borderColor: "var(--color-border-strong)",
              backgroundColor: memoryOpen ? "var(--color-accent)" : "transparent",
              color: memoryOpen ? "var(--color-accent-contrast)" : "var(--color-text-muted)",
            }}
          >
            {t("title", { ns: "memory" })}
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col overflow-hidden">
          {error && (
            <div
              className="mx-4 mt-3 flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border px-3 py-2 text-sm sm:mx-8"
              style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}
            >
              <span>
                {error === "no-connection"
                  ? t("room.errors.noConnection")
                  : error === "offline"
                    ? t("room.errors.offline")
                    : t("room.errors.generic", { message: error })}
              </span>
              <span className="flex shrink-0 items-center gap-3">
                {errorRetryable && retry && (
                  <button
                    type="button"
                    onClick={() => {
                      dismissError();
                      retry();
                    }}
                    className="rounded-[var(--radius-sm)] px-2 py-1 text-xs font-medium"
                    style={{ backgroundColor: "var(--color-danger)", color: "var(--color-accent-contrast)" }}
                  >
                    {t("room.errors.retry")}
                  </button>
                )}
                <button type="button" onClick={dismissError} className="opacity-80 hover:opacity-100">
                  {t("actions.close", { ns: "common" })}
                </button>
              </span>
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
              interruptedMessageIds={interruptedMessageIds}
              hasOlder={hasOlderMessages}
              loadingOlder={loadingOlderMessages}
              onLoadOlder={() => void loadOlderMessages()}
              onEdit={(messageId, content) => void editMessage(messageId, content)}
              onRegenerate={(messageId) => void regenerate(messageId)}
              onContinue={(messageId) => void continueMessage(messageId)}
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

        {memoryOpen && (
          <>
            {/* Overlay on narrow widths — the panel becomes a full-height
             * slide-in instead of squeezing the chat column (plan §6.6). */}
            <div
              className="fixed inset-0 z-40 lg:hidden"
              style={{ backgroundColor: "var(--color-overlay)" }}
              onClick={() => setMemoryOpen(false)}
            />
            <aside
              className="fixed inset-y-0 right-0 z-50 w-full max-w-sm border-l lg:static lg:z-auto lg:w-96 lg:max-w-none lg:shrink-0"
              style={{ borderColor: "var(--color-border)" }}
            >
              <MemoryPanel chatId={id} onClose={() => setMemoryOpen(false)} />
            </aside>
          </>
        )}
      </div>
    </div>
  );
}
