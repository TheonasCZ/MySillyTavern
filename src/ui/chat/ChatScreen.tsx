import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";

import { branchChat } from "../../db/repositories/chatsRepo";
import { createMessage, searchMessagesInChat } from "../../db/repositories/messagesRepo";
import { searchSnippet } from "../../chat/searchSnippet";
import { avatarSrc } from "../characters/avatarSrc";
import { MemoryPanel } from "../memory/MemoryPanel";
import { InventoryPanel } from "./InventoryPanel";
import { useCharactersStore } from "../../stores/charactersStore";
import { useChatListStore } from "../../stores/chatListStore";
import { useChatStore } from "../../stores/chatStore";
import { useConnectionsStore } from "../../stores/connectionsStore";
import { usePersonasStore } from "../../stores/personasStore";
import { formatDiceSystemMessage } from "../../chat/diceCommand";
import { pickNextSpeaker } from "../../chat/groupSpeaker";
import { extractInlineSuggestions } from "../../chat/inlineSuggestions";
import { ChatInput } from "./ChatInput";
import { GroupMembersPopover } from "./GroupMembersPopover";
import { MessageList, type MemberInfo } from "./MessageList";
import { SpeakerPicker } from "./SpeakerPicker";

const selectStyle = {
  backgroundColor: "var(--color-surface-2)",
  borderColor: "var(--color-border-strong)",
  color: "var(--color-text)",
} as const;

const MAX_VISIBLE_AVATARS = 5;

export function ChatScreen() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation(["chat", "common", "memory"]);
  const {
    chatId,
    chat,
    members,
    memberCharacters,
    selectedSpeakerId,
    autoReply,
    streamingSpeakerId,
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
    triggerSpeaker,
    regenerate,
    continueMessage,
    editMessage,
    switchSwipe,
    stop,
    dismissError,
    suggestions,
    suggesting,
    suggestReplies,
    clearSuggestions,
    addMember,
    removeMember,
    setAutoReplyMode,
    setSelectedSpeaker,
  } = useChatStore();
  const { connections, loaded: connectionsLoaded, load: loadConnections } = useConnectionsStore();
  const { personas, loaded: personasLoaded, load: loadPersonas } = usePersonasStore();
  const { characters, loaded: charactersLoaded, load: loadCharacters } = useCharactersStore();
  const { setPersona } = useChatListStore();
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [dismissedSuggestionsMsgId, setDismissedSuggestionsMsgId] = useState<string | null>(null);
  // Search state
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{ messageId: string; content: string; createdAt: string }[]>([]);
  const [scrollToMessageId, setScrollToMessageId] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const handleDiceRoll = useCallback(
    async (expression: string) => {
      if (!chatId) return;
      try {
        const result: string = await invoke("eval_dice", { expression });
        const content = formatDiceSystemMessage(expression, result);
        const systemMsg = await createMessage(chatId, "system", content);
        // Check we're still on the same chat before inserting
        if (useChatStore.getState().chatId === chatId) {
          useChatStore.setState((s) => ({
            messages: [...s.messages, systemMsg],
          }));
        }
      } catch (err) {
        console.warn("dice roll failed", err);
      }
    },
    [chatId],
  );

  useEffect(() => {
    if (!connectionsLoaded) void loadConnections();
  }, [connectionsLoaded, loadConnections]);

  useEffect(() => {
    if (!personasLoaded) void loadPersonas();
  }, [personasLoaded, loadPersonas]);

  useEffect(() => {
    if (!charactersLoaded) void loadCharacters();
  }, [charactersLoaded, loadCharacters]);

  useEffect(() => {
    if (!id) return;
    void openChat(id);
    return () => {
      void closeChat();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Debounced search: wait 300ms after the user stops typing before hitting
  // the database.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Execute search when debounced query changes or chat changes.
  useEffect(() => {
    if (!debouncedQuery || !id) {
      setSearchResults([]);
      return;
    }
    let cancelled = false;
    void searchMessagesInChat(id, debouncedQuery, 20).then((hits) => {
      if (cancelled) return;
      setSearchResults(hits.map((h) => ({ messageId: h.messageId, content: h.content, createdAt: h.createdAt })));
    });
    return () => { cancelled = true; };
  }, [debouncedQuery, id]);

  // Ctrl+F opens search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        setSearchOpen(true);
        // Focus the input on the next tick so it's mounted
        requestAnimationFrame(() => searchInputRef.current?.focus());
      }
      // Escape closes search
      if (e.key === "Escape" && searchOpen) {
        setSearchOpen(false);
        setSearchQuery("");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [searchOpen]);

  // Focus search input when bar opens
  useEffect(() => {
    if (searchOpen) {
      requestAnimationFrame(() => searchInputRef.current?.focus());
    } else {
      setSearchQuery("");
      setDebouncedQuery("");
      setSearchResults([]);
    }
  }, [searchOpen]);

  if (!id) return null;

  const connection = chat?.connectionId
    ? connections.find((c) => c.id === chat.connectionId)
    : undefined;
  const promotionConnectionId = chat?.extractionConnectionId ?? chat?.connectionId ?? null;
  const promotionConnection = promotionConnectionId
    ? (connections.find((c) => c.id === promotionConnectionId) ?? null)
    : null;
  const persona = chat?.personaId ? personas.find((p) => p.id === chat.personaId) : undefined;
  const isGroup = members.length > 1;

  const membersById = new Map<string, MemberInfo>(
    memberCharacters.map((c) => [c.id, { name: c.name, avatarUrl: avatarSrc(c.avatarPath) }]),
  );

  // Rough context usage estimate: total chars in messages / 3 chars-per-token / budget
  const contextUsage = connection
    ? Math.min(1, messages.reduce((sum, m) => sum + (m.content?.length ?? 0), 0) / 3 / connection.contextBudget)
    : 0;

  const primaryCharacter = chat ? memberCharacters.find((c) => c.id === chat.characterId) : undefined;
  const fallbackCharacter: MemberInfo = {
    name: primaryCharacter?.name ?? "",
    avatarUrl: avatarSrc(primaryCharacter?.avatarPath ?? null),
  };

  const lastUserText = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const recentSpeakerIds = messages
    .filter((m) => m.role === "assistant")
    .map((m) => m.characterId ?? chat?.characterId ?? "");
  const speakerCandidates = members.map((m) => ({
    id: m.characterId,
    name: memberCharacters.find((c) => c.id === m.characterId)?.name ?? "",
    position: m.position,
  }));
  const predictedSpeakerId = isGroup ? pickNextSpeaker(speakerCandidates, lastUserText, recentSpeakerIds) : null;

  // Options the model itself appended to its last reply ("Co uděláš? 1) …")
  // replace the extra suggest-replies LLM call; the button stays only as a
  // fallback for replies without a trailing option block.
  const lastMessage = messages[messages.length - 1];
  const inlineSuggestions =
    !streaming && lastMessage?.role === "assistant" && lastMessage.id !== dismissedSuggestionsMsgId
      ? extractInlineSuggestions(lastMessage.content)
      : [];
  const combinedSuggestions =
    suggestions && suggestions.length > 0 ? suggestions : inlineSuggestions.length > 0 ? inlineSuggestions : null;

  const handleBranch = async (messageId: string) => {
    if (!confirm(t("room.branchConfirm") ?? "")) return;
    const branched = await branchChat(id, messageId, t("room.branchSuffix"));
    if (branched) navigate(`/chat/${branched.id}`);
  };

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
          <div className="relative">
            <button
              type="button"
              onClick={() => setGroupOpen((v) => !v)}
              aria-pressed={groupOpen}
              title={t("room.groupMembers") ?? ""}
              className="flex items-center rounded-[var(--radius-sm)] border px-1.5 py-1 transition-colors"
              style={{
                borderColor: "var(--color-border-strong)",
                backgroundColor: groupOpen ? "var(--color-accent)" : "transparent",
              }}
            >
              {memberCharacters.slice(0, MAX_VISIBLE_AVATARS).map((c, i) => {
                const url = avatarSrc(c.avatarPath);
                return url ? (
                  <img
                    key={c.id}
                    src={url}
                    alt={c.name}
                    title={c.name}
                    className="h-6 w-6 rounded-full border object-cover"
                    style={{ borderColor: "var(--color-border-strong)", marginLeft: i === 0 ? 0 : "-0.4rem" }}
                  />
                ) : (
                  <span
                    key={c.id}
                    title={c.name}
                    aria-hidden
                    className="flex h-6 w-6 items-center justify-center rounded-full border text-[0.6rem] font-medium"
                    style={{
                      borderColor: "var(--color-border-strong)",
                      backgroundColor: "var(--color-surface-2)",
                      color: "var(--color-text-muted)",
                      marginLeft: i === 0 ? 0 : "-0.4rem",
                    }}
                  >
                    {(c.name || "?").trim().charAt(0).toUpperCase() || "?"}
                  </span>
                );
              })}
              {memberCharacters.length > MAX_VISIBLE_AVATARS && (
                <span
                  className="flex h-6 w-6 items-center justify-center rounded-full border text-[0.6rem] font-medium"
                  style={{
                    borderColor: "var(--color-border-strong)",
                    backgroundColor: "var(--color-surface-2)",
                    color: "var(--color-text-muted)",
                    marginLeft: "-0.4rem",
                  }}
                >
                  +{memberCharacters.length - MAX_VISIBLE_AVATARS}
                </span>
              )}
            </button>
            {groupOpen && chat && (
              <GroupMembersPopover
                chatId={id}
                chatCharacterId={chat.characterId}
                members={members}
                memberCharacters={memberCharacters}
                allCharacters={characters}
                autoReply={autoReply}
                promotionConnection={promotionConnection}
                onAddMember={addMember}
                onRemoveMember={removeMember}
                onSetAutoReply={setAutoReplyMode}
                onClose={() => setGroupOpen(false)}
              />
            )}
          </div>
          <button
            type="button"
            onClick={() => setInventoryOpen((v) => !v)}
            aria-pressed={inventoryOpen}
            className="rounded-[var(--radius-sm)] border px-2 py-1 text-xs transition-colors"
            style={{
              borderColor: "var(--color-border-strong)",
              backgroundColor: inventoryOpen ? "var(--color-accent)" : "transparent",
              color: inventoryOpen ? "var(--color-accent-contrast)" : "var(--color-text-muted)",
            }}
          >
            🎒
          </button>
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
          <button
            type="button"
            onClick={() => setSearchOpen((v) => !v)}
            aria-pressed={searchOpen}
            title={t("room.search") ?? "Search messages"}
            className="rounded-[var(--radius-sm)] border px-2 py-1 text-xs transition-colors"
            style={{
              borderColor: "var(--color-border-strong)",
              backgroundColor: searchOpen ? "var(--color-accent)" : "transparent",
              color: searchOpen ? "var(--color-accent-contrast)" : "var(--color-text-muted)",
            }}
          >
            🔍
          </button>
        </div>
      </header>

      {/* Search bar */}
      {searchOpen && (
        <div
          className="border-b px-4 py-2 sm:px-8"
          style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-surface-1)" }}
        >
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("room.searchPlaceholder") ?? "Search in conversation…"}
            className="w-full rounded-[var(--radius-sm)] border px-3 py-1.5 text-sm outline-none"
            style={{
              borderColor: "var(--color-border-strong)",
              backgroundColor: "var(--color-surface-2)",
              color: "var(--color-text)",
            }}
          />
          {searchResults.length > 0 && (
            <div className="mt-2 max-h-64 overflow-y-auto rounded-[var(--radius-sm)] border" style={{ borderColor: "var(--color-border)" }}>
              {searchResults.map((hit) => (
                <button
                  key={hit.messageId}
                  type="button"
                  onClick={() => {
                    setScrollToMessageId(hit.messageId);
                    // Re-trigger if same id clicked twice
                    setScrollToMessageId(null);
                    requestAnimationFrame(() => setScrollToMessageId(hit.messageId));
                  }}
                  className="w-full border-b px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--color-surface-3)] last:border-b-0"
                  style={{ borderColor: "var(--color-border)" }}
                >
                  <div className="truncate" style={{ color: "var(--color-text)" }}>
                    {searchSnippet(hit.content, debouncedQuery, 50)}
                  </div>
                  <div className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                    {new Date(hit.createdAt).toLocaleString()}
                  </div>
                </button>
              ))}
            </div>
          )}
          {debouncedQuery && searchResults.length === 0 && (
            <p className="mt-2 text-xs" style={{ color: "var(--color-text-faint)" }}>
              {t("room.searchNoResults") ?? "No matches found."}
            </p>
          )}
        </div>
      )}

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
              membersById={membersById}
              fallbackCharacter={fallbackCharacter}
              personaAvatarUrl={avatarSrc(persona?.avatarPath ?? null)}
              personaName={persona?.name}
              streamingSpeakerId={streamingSpeakerId}
              isGroup={isGroup}
              scrollToMessageId={scrollToMessageId}
              onBranch={(messageId) => void handleBranch(messageId)}
              hasOlder={hasOlderMessages}
              loadingOlder={loadingOlderMessages}
              onLoadOlder={() => void loadOlderMessages()}
              onEdit={(messageId, content) => void editMessage(messageId, content)}
              onRegenerate={(messageId) => void regenerate(messageId)}
              onContinue={(messageId) => void continueMessage(messageId)}
              onSwipe={(messageId, offset) => void switchSwipe(messageId, offset)}
            />
          )}

          {isGroup && (
            <SpeakerPicker
              members={memberCharacters}
              selectedSpeakerId={selectedSpeakerId}
              predictedSpeakerId={predictedSpeakerId}
              autoReply={autoReply}
              streaming={streaming}
              onSelect={setSelectedSpeaker}
              onReplyNow={(speakerId) => void triggerSpeaker(speakerId)}
            />
          )}

          <ChatInput
            disabled={loading || !connection}
            streaming={streaming}
            onSend={(content) => void sendMessage(content)}
            onDiceRoll={(expression) => void handleDiceRoll(expression)}
            onStop={() => void stop()}
            suggestions={combinedSuggestions}
            suggesting={suggesting}
            showSuggestButton={inlineSuggestions.length === 0}
            onSuggest={() => void suggestReplies()}
            onClearSuggestions={() => {
              clearSuggestions();
              if (lastMessage?.role === "assistant") setDismissedSuggestionsMsgId(lastMessage.id);
            }}
            contextUsage={contextUsage}
          />
        </div>

        {memoryOpen && (
          <>
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
        {inventoryOpen && persona && (
          <>
            <div
              className="fixed inset-0 z-40 lg:hidden"
              style={{ backgroundColor: "var(--color-overlay)" }}
              onClick={() => setInventoryOpen(false)}
            />
            <aside
              className="fixed inset-y-0 right-0 z-50 w-full max-w-sm border-l lg:static lg:z-auto lg:w-72 lg:max-w-none lg:shrink-0"
              style={{ borderColor: "var(--color-border)" }}
            >
              <InventoryPanel persona={persona} onClose={() => setInventoryOpen(false)} />
            </aside>
          </>
        )}
      </div>
    </div>
  );
}
