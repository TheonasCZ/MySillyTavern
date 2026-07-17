import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";

import { branchChat } from "../../db/repositories/chatsRepo";
import { createMessage } from "../../db/repositories/messagesRepo";
import { execute, newId, nowIso } from "../../db/database";
import { getCalendarSetting } from "../../db/repositories/settingsRepo";
import { listMessages } from "../../db/repositories/messagesRepo";
import { listQuests } from "../../db/repositories/questsRepo";
import { avatarSrc } from "../characters/avatarSrc";
import { toConnectionDto } from "../../providers/dto";
import { MemoryPanel } from "../memory/MemoryPanel";
import { InventoryPanel } from "./InventoryPanel";
import { QuestPanel } from "./QuestPanel";
import { useCharactersStore } from "../../stores/charactersStore";
import { useChatListStore } from "../../stores/chatListStore";
import { useChatStore } from "../../stores/chatStore";
import { useConnectionsStore } from "../../stores/connectionsStore";
import { usePersonasStore } from "../../stores/personasStore";
import { chunkMessages, chunkToExportFormat } from "../../chat/chronicleChunker";
import { THEME_LABELS } from "../../chat/chronicleThemes";
import type { ExportStatus } from "../../chat/chronicleTypes";
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
  const [exportJobId, setExportJobId] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<ExportStatus | null>(null);
  const [exportTheme, setExportTheme] = useState("fantasy");
  const [exportFormat, setExportFormat] = useState("html");
  const [exportIllustrations, setExportIllustrations] = useState(true);
  const [exportConnectionId, setExportConnectionId] = useState("");
  const exportPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  // ── Chronicle Export ──────────────────────────────────────────────
  const startExport = async () => {
    if (!id || !exportConnectionId) return;
    const conn = connections.find((c) => c.id === exportConnectionId);
    if (!conn) return;

    try {
      const allMessages = await listMessages(id);
      const quests = await listQuests(id);
      const chunks = chunkMessages(allMessages, quests);
      const chunksJson = JSON.stringify(chunks.map(chunkToExportFormat));

      const jobId = newId();
      const now = nowIso();

      // Create export_jobs row in DB
      await execute(
        `INSERT INTO export_jobs
          (id, chat_id, persona_id, status, progress, total_chunks, current_chunk,
           connection_id, theme, format, include_illustrations, chunks_json, created_at, updated_at)
         VALUES ($1, $2, $3, 'running', 0, $4, 0, $5, $6, $7, $8, $9, $10, $11)`,
        [
          jobId,
          id,
          chat?.personaId ?? null,
          chunks.length,
          exportConnectionId,
          exportTheme,
          exportFormat,
          exportIllustrations ? 1 : 0,
          chunksJson,
          now,
          now,
        ],
      );

      setExportJobId(jobId);
      setExportOpen(false);

      // Get output directory from Rust (we'll use a default)
      const outputDir = ""; // Rust will use a default path

      await invoke("start_export", {
        jobId,
        connection: toConnectionDto(conn),
        chunksJson,
        theme: exportTheme,
        format: exportFormat,
        includeIllustrations: exportIllustrations,
        outputDir,
      });

      // Start polling for status
      exportPollRef.current = setInterval(async () => {
        try {
          const status: ExportStatus = await invoke("get_export_status", { jobId });
          setExportStatus(status);
          if (status.status === "completed" || status.status === "failed") {
            if (exportPollRef.current) {
              clearInterval(exportPollRef.current);
              exportPollRef.current = null;
            }
            // Update DB
            const n = nowIso();
            await execute(
              `UPDATE export_jobs SET status = $2, progress = $3, current_chunk = $4, output_path = $5, updated_at = $6 WHERE id = $1`,
              [jobId, status.status, status.progress, status.current_chunk, status.output_path ?? null, n],
            );
          } else {
            // Update DB progress
            await execute(
              `UPDATE export_jobs SET progress = $2, current_chunk = $3, updated_at = $4 WHERE id = $1`,
              [jobId, status.progress, status.current_chunk, nowIso()],
            );
          }
        } catch {
          // Polling error - ignore
        }
      }, 2000);
    } catch (err) {
      console.error("export start failed", err);
    }
  };

  const cancelExport = async () => {
    if (!exportJobId) return;
    if (exportPollRef.current) {
      clearInterval(exportPollRef.current);
      exportPollRef.current = null;
    }
    try {
      await invoke("cancel_export", { jobId: exportJobId });
      await execute(
        `UPDATE export_jobs SET status = 'failed', output_path = 'Cancelled', updated_at = $2 WHERE id = $1`,
        [exportJobId, nowIso()],
      );
      setExportStatus(null);
      setExportJobId(null);
    } catch (err) {
      console.error("export cancel failed", err);
    }
  };

  const openExportFile = () => {
    if (exportStatus?.output_path) {
      // The Rust side writes to app data dir; open via shell
      invoke("read_text_file", { path: exportStatus.output_path }).catch(() => {});
    }
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
            {exportOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setExportOpen(false)} />
                <div
                  className="absolute right-0 top-full z-50 mt-1 w-72 rounded-[var(--radius-md)] border p-4 shadow-lg"
                  style={{
                    borderColor: "var(--color-border-strong)",
                    backgroundColor: "var(--color-bg-elevated)",
                    color: "var(--color-text)",
                  }}
                >
                  <h3 className="mb-3 font-[var(--font-display)] text-sm">Exportovat kroniku</h3>
                  <div className="flex flex-col gap-2 text-xs">
                    <label>
                      Připojení:
                      <select
                        className="ml-1 rounded-[var(--radius-sm)] border px-1 py-0.5"
                        style={selectStyle}
                        value={exportConnectionId}
                        onChange={(e) => setExportConnectionId(e.target.value)}
                      >
                        {connections.filter((c) => c.purposes.includes("chat")).map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Téma:
                      <select
                        className="ml-1 rounded-[var(--radius-sm)] border px-1 py-0.5"
                        style={selectStyle}
                        value={exportTheme}
                        onChange={(e) => setExportTheme(e.target.value)}
                      >
                        {Object.entries(THEME_LABELS).map(([k, v]) => (
                          <option key={k} value={k}>{v}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Formát:
                      <select
                        className="ml-1 rounded-[var(--radius-sm)] border px-1 py-0.5"
                        style={selectStyle}
                        value={exportFormat}
                        onChange={(e) => setExportFormat(e.target.value)}
                      >
                        <option value="html">HTML</option>
                      </select>
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={exportIllustrations}
                        onChange={(e) => setExportIllustrations(e.target.checked)}
                      />
                      Ilustrace
                    </label>
                    <button
                      type="button"
                      onClick={() => void startExport()}
                      disabled={!exportConnectionId}
                      className="mt-2 rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium transition-colors"
                      style={{
                        backgroundColor: exportConnectionId ? "var(--color-accent)" : "var(--color-surface-2)",
                        color: exportConnectionId ? "var(--color-accent-contrast)" : "var(--color-text-muted)",
                      }}
                    >
                      Spustit export
                    </button>
                  </div>
                </div>
              </>
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
            onClick={() => {
              if (exportJobId && exportStatus?.status === "running") return;
              if (exportJobId && exportStatus?.status === "completed") {
                openExportFile();
                return;
              }
              setExportOpen(true);
              setExportConnectionId(chat?.connectionId ?? connections[0]?.id ?? "");
            }}
            title={exportJobId && exportStatus?.status === "running" ? "Export běží..." : "Exportovat kroniku"}
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

      {exportJobId && exportStatus && (
        <div
          className="flex items-center gap-3 border-b px-4 py-2 sm:px-8"
          style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-elevated)" }}
        >
          <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
            📖 Export kroniky {exportStatus.status === "running" ? "běží" : exportStatus.status === "completed" ? "dokončen" : "selhal"}
            {exportStatus.status === "running" && ` (${exportStatus.currentChunk}/${exportStatus.totalChunks})`}
          </span>
          {exportStatus.status === "running" && (
            <>
              <div className="h-1.5 flex-1 rounded-full" style={{ backgroundColor: "var(--color-surface-2)" }}>
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${exportStatus.totalChunks > 0 ? (exportStatus.currentChunk / exportStatus.totalChunks) * 100 : 0}%`,
                    backgroundColor: "var(--color-accent)",
                  }}
                />
              </div>
              <button
                type="button"
                onClick={() => void cancelExport()}
                className="rounded-[var(--radius-sm)] px-2 py-0.5 text-xs"
                style={{ color: "var(--color-danger)", borderColor: "var(--color-danger)", border: "1px solid" }}
              >
                Zrušit
              </button>
            </>
          )}
          {exportStatus.status === "completed" && exportStatus.outputPath && (
            <button
              type="button"
              onClick={openExportFile}
              className="rounded-[var(--radius-sm)] border px-2 py-0.5 text-xs"
              style={{ borderColor: "var(--color-accent)", color: "var(--color-accent)" }}
            >
              Otevřít soubor
            </button>
          )}
          {(exportStatus.status === "completed" || exportStatus.status === "failed") && (
            <button
              type="button"
              onClick={() => { setExportJobId(null); setExportStatus(null); }}
              className="rounded-[var(--radius-sm)] px-2 py-0.5 text-xs"
              style={{ color: "var(--color-text-muted)" }}
            >
              ✕
            </button>
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
      </div>
    </div>
  );
}
