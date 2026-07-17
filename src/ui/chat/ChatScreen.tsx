import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";

import type { ChronicleTheme, ChronicleFormat, ExportStatus } from "../../chat/chronicleTypes";
import { THEMES } from "../../chat/chronicleThemes";
import { branchChat } from "../../db/repositories/chatsRepo";
import { createMessage } from "../../db/repositories/messagesRepo";
import { getCalendarSetting } from "../../db/repositories/settingsRepo";
import { avatarSrc } from "../characters/avatarSrc";
import { MemoryPanel } from "../memory/MemoryPanel";
import { InventoryPanel } from "./InventoryPanel";
import { QuestPanel } from "./QuestPanel";
import { useCharactersStore } from "../../stores/charactersStore";
import { useChatListStore } from "../../stores/chatListStore";
import { useChatStore } from "../../stores/chatStore";
import { useConnectionsStore } from "../../stores/connectionsStore";
import { usePersonasStore } from "../../stores/personasStore";
import { formatDiceSystemMessage } from "../../chat/diceCommand";
import { pickNextSpeaker } from "../../chat/groupSpeaker";
import { extractInlineSuggestions } from "../../chat/inlineSuggestions";
import {
  calendarFromJSON,
  type CalendarDate,
  formatCalendarDateShort,
  SEASON_EFFECTS,
} from "../../memory/calendar";
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
  const [questsOpen, setQuestsOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [dismissedSuggestionsMsgId, setDismissedSuggestionsMsgId] = useState<string | null>(null);
  const [calendarDate, setCalendarDate] = useState<CalendarDate | null>(null);
  const [calendarExpanded, setCalendarExpanded] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportConnectionId, setExportConnectionId] = useState("");
  const [exportTheme, setExportTheme] = useState<ChronicleTheme>("fantasy");
  const [exportFormat, setExportFormat] = useState<ChronicleFormat>("html");
  const [exportIllustrations, setExportIllustrations] = useState(true);
  const [exportJobId, setExportJobId] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<ExportStatus | null>(null);

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

  // Poll export status every second while a job is running
  useEffect(() => {
    if (!exportJobId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const status: ExportStatus = await invoke("get_export_status", { jobId: exportJobId });
        if (cancelled) return;
        setExportStatus(status);
        if (status.status === "done" || status.status === "error") {
          setExportJobId(null);
        }
      } catch {
        // polling error – ignore
      }
    };
    // poll immediately, then every 1s
    void poll();
    const iv = setInterval(() => { void poll(); }, 1000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [exportJobId]);

  // Resume running export on mount
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void (async () => {
      try {
        // Check if there's a known running job stored (we store it in localStorage)
        const stored = localStorage.getItem(`export_job_${id}`);
        if (!stored) return;
        const { jobId } = JSON.parse(stored) as { jobId: string };
        const status: ExportStatus = await invoke("get_export_status", { jobId });
        if (cancelled) return;
        if (status.status === "running") {
          setExportJobId(jobId);
          setExportStatus(status);
        } else {
          // Clean up stale storage
          localStorage.removeItem(`export_job_${id}`);
        }
      } catch {
        // No running job or error – ignore
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  // Persist job id so resume works across remounts
  useEffect(() => {
    if (!id || !exportJobId) return;
    localStorage.setItem(`export_job_${id}`, JSON.stringify({ jobId: exportJobId }));
  }, [id, exportJobId]);

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

  // Load calendar date for this chat
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void (async () => {
      try {
        const raw = await getCalendarSetting(id);
        if (cancelled) return;
        setCalendarDate(raw ? calendarFromJSON(raw) : null);
      } catch {
        if (!cancelled) setCalendarDate(null);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  // Filter connections for the export dropdown: gemini provider OR purpose=chat
  const exportConnections = connections.filter(
    (c) =>
      c.provider === "gemini" || c.purposes.includes("chat"),
  );

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
          {calendarDate && (
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => setCalendarExpanded((v) => !v)}
                aria-pressed={calendarExpanded}
                className="rounded-[var(--radius-sm)] px-1.5 py-0.5 text-xs whitespace-nowrap transition-colors"
                style={{
                  color: "var(--color-text-muted)",
                  backgroundColor: calendarExpanded ? "var(--color-surface-2)" : "transparent",
                }}
                title={calendarDate.season}
              >
                {formatCalendarDateShort(calendarDate)}
              </button>
              {calendarExpanded && (
                <>
                  <div
                    className="fixed inset-0 z-30"
                    onClick={() => setCalendarExpanded(false)}
                  />
                  <div
                    className="absolute left-0 top-full z-40 mt-1 w-56 rounded-[var(--radius-md)] border p-3 text-xs shadow-lg"
                    style={{
                      borderColor: "var(--color-border-strong)",
                      backgroundColor: "var(--color-bg-elevated)",
                      color: "var(--color-text)",
                    }}
                  >
                    <div className="font-medium">
                      {calendarDate.season} — {calendarDate.day}. {calendarDate.month}, Rok {calendarDate.year}
                    </div>
                    <div className="mt-1" style={{ color: "var(--color-text-muted)" }}>
                      {SEASON_EFFECTS[calendarDate.season] ?? ""}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
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
            onClick={() => setQuestsOpen((v) => !v)}
            aria-pressed={questsOpen}
            className="rounded-[var(--radius-sm)] border px-2 py-1 text-xs transition-colors"
            style={{
              borderColor: "var(--color-border-strong)",
              backgroundColor: questsOpen ? "var(--color-accent)" : "transparent",
              color: questsOpen ? "var(--color-accent-contrast)" : "var(--color-text-muted)",
            }}
          >
            📜
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
            onClick={() => setExportOpen((v) => !v)}
            aria-pressed={exportOpen}
            className="rounded-[var(--radius-sm)] border px-2 py-1 text-xs transition-colors"
            style={{
              borderColor: "var(--color-border-strong)",
              backgroundColor: exportOpen ? "var(--color-accent)" : "transparent",
              color: exportOpen ? "var(--color-accent-contrast)" : "var(--color-text-muted)",
            }}
          >
            📖
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
              membersById={membersById}
              fallbackCharacter={fallbackCharacter}
              personaAvatarUrl={avatarSrc(persona?.avatarPath ?? null)}
              personaName={persona?.name}
              streamingSpeakerId={streamingSpeakerId}
              isGroup={isGroup}
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
        {questsOpen && (
          <>
            <div
              className="fixed inset-0 z-40 lg:hidden"
              style={{ backgroundColor: "var(--color-overlay)" }}
              onClick={() => setQuestsOpen(false)}
            />
            <aside
              className="fixed inset-y-0 right-0 z-50 w-full max-w-sm border-l lg:static lg:z-auto lg:w-72 lg:max-w-none lg:shrink-0"
              style={{ borderColor: "var(--color-border)" }}
            >
              <QuestPanel chatId={id} onClose={() => setQuestsOpen(false)} />
            </aside>
          </>
        )}

        {/* ---- Chronicle Export Dialog ---- */}
        {exportOpen && (
          <>
            <div
              className="fixed inset-0 z-50"
              style={{ backgroundColor: "var(--color-overlay)" }}
              onClick={() => setExportOpen(false)}
            />
            <div
              className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-md)] border p-6 shadow-xl"
              style={{
                borderColor: "var(--color-border-strong)",
                backgroundColor: "var(--color-bg-elevated)",
                color: "var(--color-text)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {exportJobId ? (
                /* ---- Progress ---- */
                <div className="space-y-3">
                  <h3 className="font-[var(--font-display)] text-lg">📖 Export kroniky</h3>
                  {exportStatus ? (
                    <>
                      <div
                        className="h-2 w-full rounded-full overflow-hidden"
                        style={{ backgroundColor: "var(--color-surface-2)" }}
                      >
                        <div
                          className="h-full transition-all duration-300"
                          style={{
                            width: `${exportStatus.progress}%`,
                            backgroundColor: "var(--color-accent)",
                          }}
                        />
                      </div>
                      <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                        Exportuji {exportStatus.progress}% ({exportStatus.currentChunk}/{exportStatus.totalChunks} kapitol)
                      </p>
                      {exportStatus.status === "done" && (
                        <div className="space-y-2">
                          <p className="text-sm font-medium" style={{ color: "var(--color-success, #22c55e)" }}>
                            ✅ Hotovo!
                          </p>
                          {exportStatus.outputPath && (
                            <button
                              type="button"
                              className="rounded-[var(--radius-sm)] border px-3 py-1 text-xs transition-colors"
                              style={{
                                borderColor: "var(--color-border-strong)",
                                color: "var(--color-text)",
                              }}
                              onClick={() => {
                                void invoke("open_path", { path: exportStatus.outputPath });
                              }}
                            >
                              Otevřít složku
                            </button>
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>Spouštím export…</p>
                  )}
                </div>
              ) : (
                /* ---- Export form ---- */
                <div className="space-y-4">
                  <h3 className="font-[var(--font-display)] text-lg">📖 Export kroniky</h3>

                  <label className="block text-xs" style={{ color: "var(--color-text-muted)" }}>
                    Připojení
                    <select
                      className="mt-1 block w-full rounded-[var(--radius-sm)] border px-2 py-1 text-sm"
                      style={selectStyle}
                      value={exportConnectionId}
                      onChange={(e) => setExportConnectionId(e.target.value)}
                    >
                      <option value="">-- vyberte --</option>
                      {exportConnections.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </label>

                  <label className="block text-xs" style={{ color: "var(--color-text-muted)" }}>
                    Téma
                    <select
                      className="mt-1 block w-full rounded-[var(--radius-sm)] border px-2 py-1 text-sm"
                      style={selectStyle}
                      value={exportTheme}
                      onChange={(e) => setExportTheme(e.target.value as ChronicleTheme)}
                    >
                      {THEMES.map((t) => (
                        <option key={t.key} value={t.key}>{t.label}</option>
                      ))}
                    </select>
                  </label>

                  <fieldset className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                    <legend className="mb-1">Formát</legend>
                    <label className="mr-4 inline-flex items-center gap-1">
                      <input type="radio" name="exportFormat" value="html" checked={exportFormat === "html"} onChange={() => setExportFormat("html")} />
                      HTML
                    </label>
                    <label className="inline-flex items-center gap-1">
                      <input type="radio" name="exportFormat" value="pdf" checked={exportFormat === "pdf"} onChange={() => setExportFormat("pdf")} />
                      PDF
                    </label>
                  </fieldset>

                  <label className="flex items-center gap-2 text-xs" style={{ color: "var(--color-text-muted)" }}>
                    <input type="checkbox" checked={exportIllustrations} onChange={(e) => setExportIllustrations(e.target.checked)} />
                    Ilustrace
                  </label>

                  <button
                    className="w-full rounded-[var(--radius-sm)] px-3 py-2 text-sm font-medium transition-colors"
                    onClick={async () => {
                      try {
                        const result: { jobId: string } = await invoke("start_export", {
                          chatId: id,
                          personaId: chat?.personaId ?? undefined,
                          connectionId: exportConnectionId,
                          theme: exportTheme,
                          format: exportFormat,
                          includeIllustrations: exportIllustrations,
                        });
                        setExportJobId(result.jobId);
                        setExportStatus(null);
                      } catch (err) {
                        console.warn("export start failed", err);
                      }
                    }}
                    disabled={!exportConnectionId}
                    style={{
                      backgroundColor: exportConnectionId ? "var(--color-accent)" : "var(--color-surface-2)",
                      color: exportConnectionId ? "var(--color-accent-contrast)" : "var(--color-text-faint)",
                    }}
                  >
                    Spustit export
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
