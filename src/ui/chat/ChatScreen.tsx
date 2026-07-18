import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";

import type { ChronicleTheme } from "../../chat/chronicleTypes";
import { THEMES } from "../../chat/chronicleThemes";
import { getCalendarSetting } from "../../db/repositories/settingsRepo";
import { avatarSrc } from "../characters/avatarSrc";
import { MemoryPanel } from "../memory/MemoryPanel";
import { CharacterPanel } from "./CharacterPanel";
import { InventoryPanel } from "./InventoryPanel";
import { QuestPanel } from "./QuestPanel";
import { useCharactersStore } from "../../stores/charactersStore";
import { useChatListStore } from "../../stores/chatListStore";
import { useChatStore } from "../../stores/chatStore";
import { useConnectionsStore } from "../../stores/connectionsStore";
import { usePersonasStore } from "../../stores/personasStore";
import { useUnreadStore } from "../../stores/unreadStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { humanizeProviderError } from "../../providers/humanizeError";
import {
  calendarFromJSON,
  type CalendarDate,
  monthDisplayName,
  seasonIcon,
  weatherIcon,
} from "../../memory/calendar";
import { CalendarPanel } from "./CalendarPanel";
import type { CalendarEvent } from "../../db/repositories/calendarEventsRepo";
import {
  listCalendarEvents,
  createCalendarEvent,
  deleteCalendarEvent,
} from "../../db/repositories/calendarEventsRepo";
import { ChatInput } from "./ChatInput";
import { DirectorPopover } from "./DirectorPopover";
import { GroupMembersPopover } from "./GroupMembersPopover";
import { MessageList } from "./MessageList";
import { SpeakerPicker } from "./SpeakerPicker";
import { countMessages } from "../../db/repositories/messagesRepo";

import { useChatPanels } from "./useChatPanels";
import { useChatActions } from "./useChatActions";

const selectStyle = {
  backgroundColor: "var(--color-surface-2)",
  borderColor: "var(--color-border-strong)",
  color: "var(--color-text)",
} as const;

const MAX_VISIBLE_AVATARS = 5;

/** Maps a raw provider error to a friendly, actionable banner message. */
function formatProviderError(
  raw: string,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const err = humanizeProviderError(raw);
  switch (err.kind) {
    case "rateLimit":
      return err.retrySeconds
        ? t("room.errors.rateLimitRetry", { seconds: err.retrySeconds })
        : t("room.errors.rateLimit");
    case "badKey":
      return t("room.errors.badKey");
    case "overloaded":
      return t("room.errors.overloaded");
    case "modelNotFound":
      return err.model
        ? t("room.errors.modelNotFound", { model: err.model })
        : t("room.errors.modelNotFoundGeneric");
    default:
      return t("room.errors.generic", { message: err.message });
  }
}

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
  const calendarMode = useSettingsStore((s) => s.calendarMode);
  const { connections, loaded: connectionsLoaded, load: loadConnections } = useConnectionsStore();
  const { personas, loaded: personasLoaded, load: loadPersonas } = usePersonasStore();
  const { characters, loaded: charactersLoaded, load: loadCharacters } = useCharactersStore();
  const { setPersona } = useChatListStore();

  // ── Panel state ────────────────────────────────────────────────────
  const panels = useChatPanels();
  const [personaSwitcherOpen, setPersonaSwitcherOpen] = useState(false);

  // Calendar state
  const [calendarDate, setCalendarDate] = useState<CalendarDate | null>(null);
  const [weather, setWeather] = useState<string>("jasno");
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);

  // ── Store-driven derived values ────────────────────────────────────
  const connection = chat?.connectionId
    ? connections.find((c) => c.id === chat.connectionId)
    : undefined;
  const promotionConnectionId = chat?.extractionConnectionId ?? chat?.connectionId ?? null;
  const promotionConnection = promotionConnectionId
    ? (connections.find((c) => c.id === promotionConnectionId) ?? null)
    : null;
  const persona = chat?.personaId ? personas.find((p) => p.id === chat.personaId) : undefined;
  const isGroup = members.length > 1;

  // ── Chat actions & derived state ───────────────────────────────────
  const actions = useChatActions({
    chatId,
    id,
    messages,
    streaming,
    members,
    memberCharacters,
    characters,
    connection,
    autoReply,
    selectedSpeakerId,
    isGroup,
    chatCharacterId: chat?.characterId,
  });

  if (!id) return null;

  // Combined suggestions: store suggestions take priority; fall back to
  // inline suggestions extracted from the last assistant message.
  const combinedSuggestions =
    suggestions && suggestions.length > 0
      ? suggestions
      : actions.inlineSuggestions.length > 0
        ? actions.inlineSuggestions
        : null;
  const lastMessage = messages[messages.length - 1];

  // ── Effects ────────────────────────────────────────────────────────
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
    void (async () => {
      const count = await countMessages(id);
      useUnreadStore.getState().markRead(id, count);
    })();
    return () => {
      void closeChat();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Load calendar date, weather, and events for this chat
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void (async () => {
      let loadedDate: CalendarDate | null = null;
      try {
        const raw = await getCalendarSetting(id);
        if (cancelled) return;
        loadedDate = raw ? calendarFromJSON(raw) : null;
        setCalendarDate(loadedDate);
      } catch {
        if (!cancelled) setCalendarDate(null);
      }
      // Load weather from localStorage, initialize if missing
      try {
        const storedWeather = localStorage.getItem(`weather_${id}`);
        if (!cancelled && storedWeather) {
          setWeather(storedWeather);
        } else if (!cancelled && loadedDate) {
          // Initialize weather based on season
          const seasonMap: Record<string, string> = {
            "Jaro": "polojasno", "Léto": "jasno", "Podzim": "zataženo", "Zima": "zataženo",
          };
          const initial = seasonMap[loadedDate.season] ?? "jasno";
          setWeather(initial);
          localStorage.setItem(`weather_${id}`, initial);
        }
      } catch { /* noop */ }
      // Load calendar events
      try {
        const evts = await listCalendarEvents(id);
        if (!cancelled) setCalendarEvents(evts);
      } catch { /* noop */ }
    })();
    return () => { cancelled = true; };
  }, [id]);

  // One-shot backfill: generate illustrations for inventory items that
  // predate the auto-illustration trigger (e.g. imported/restored chats).
  useEffect(() => {
    if (!chat?.id) return;
    const currentChat = chat;
    void (async () => {
      try {
        const { backfillMissingInventoryImages } = await import("../../memory/imageGenQueue");
        await backfillMissingInventoryImages(currentChat);
      } catch {
        // Non-critical
      }
    })();
  }, [chat?.id]);

  // Filter connections for the export dropdown: gemini provider OR purpose=chat
  const exportConnections = connections.filter(
    (c) =>
      c.provider === "gemini" || c.purposes.includes("chat"),
  );

  // Persona avatar + switcher, rendered as the first item in ChatInput's
  // row so it's clear whose voice is being typed. Popover opens upward
  // (this trigger sits at the very bottom of the window).
  const personaSlot = (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setPersonaSwitcherOpen((v) => !v)}
        title={persona ? `${t("room.personaLabel")} ${persona.name}` : t("room.noPersona")}
        aria-pressed={personaSwitcherOpen}
        className="flex"
      >
        {persona && avatarSrc(persona.avatarPath) ? (
          <img
            src={avatarSrc(persona.avatarPath) ?? undefined}
            alt={persona.name}
            className="h-10 w-10 rounded-full border object-cover object-top"
            style={{ borderColor: "var(--color-border-strong)" }}
          />
        ) : (
          <span
            className="flex h-10 w-10 items-center justify-center rounded-full border text-sm font-medium"
            style={{ borderColor: "var(--color-border-strong)", backgroundColor: "var(--color-surface-2)", color: "var(--color-text-muted)" }}
          >
            {(persona?.name ?? "?").trim().charAt(0).toUpperCase() || "?"}
          </span>
        )}
      </button>
      {personaSwitcherOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setPersonaSwitcherOpen(false)} />
          <div
            className="absolute bottom-full left-0 z-50 mb-2 w-64 rounded-[var(--radius-md)] border p-1 shadow-lg"
            style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-surface)" }}
          >
            <button
              type="button"
              className="block w-full rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-sm transition-colors hover:opacity-90"
              style={{
                backgroundColor: !chat?.personaId ? "var(--color-surface-2)" : "transparent",
                color: "var(--color-text)",
              }}
              onClick={async () => {
                await setPersona(id, null);
                setPersonaSwitcherOpen(false);
              }}
            >
              {t("room.noPersona")}
            </button>
            {personas.map((p) => (
              <button
                key={p.id}
                type="button"
                className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-sm transition-colors hover:opacity-90"
                style={{
                  backgroundColor: chat?.personaId === p.id ? "var(--color-surface-2)" : "transparent",
                  color: "var(--color-text)",
                }}
                onClick={async () => {
                  await setPersona(id, p.id);
                  setPersonaSwitcherOpen(false);
                }}
              >
                {avatarSrc(p.avatarPath) ? (
                  <img src={avatarSrc(p.avatarPath) ?? undefined} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover object-top" />
                ) : (
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm"
                    style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text-muted)" }}
                  >
                    {p.name.trim().charAt(0).toUpperCase() || "?"}
                  </span>
                )}
                <span className="flex flex-col overflow-hidden">
                  <span className="truncate">{p.name}</span>
                  <span className="truncate text-xs" style={{ color: "var(--color-text-muted)" }}>
                    {[p.age ? t("room.ageYears", { age: p.age }) : null, p.race || null].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div className="relative flex h-full flex-col">
      {panels.directorOpen && id && (
        <DirectorPopover chatId={id} onClose={() => panels.setDirectorOpen(false)} />
      )}
      <header
        className="grid grid-cols-3 items-center gap-3 border-b px-4 py-3 sm:px-8"
        style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-elevated)" }}
      >
        <div className="flex items-center gap-3 overflow-hidden">
          <button
            type="button"
            onClick={() => navigate("/")}
            className="shrink-0 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-sm"
            style={{ color: "var(--color-text-muted)", backgroundColor: "var(--color-surface-2)" }}
            title={t("room.backToList")}
          >
            ←
          </button>
          <h1 className="truncate font-[var(--font-display)] text-lg">{chat?.title}</h1>
        </div>
        {calendarDate ? (
          <div className="flex flex-col items-center text-center leading-tight">
            <span className="text-xs whitespace-nowrap" style={{ color: "var(--color-text-muted)" }}>
              {calendarDate.day}. {monthDisplayName(calendarDate.month, calendarMode)}, {calendarDate.year} {seasonIcon(calendarDate.season)}
            </span>
            <span className="text-xs whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>
              {String(calendarDate.hourOfDay ?? 6).padStart(2, "0")}:00 · {weatherIcon(weather)} {weather}
            </span>
          </div>
        ) : (
          <div />
        )}
        <div className="flex items-center justify-end gap-2">
          {actions.fallbackCharacter && (
            <div className="relative">
              <button
                type="button"
                onClick={() => panels.setGroupOpen((v) => !v)}
                title={`${t("room.gmLabel")} ${actions.fallbackCharacter.name}`}
                aria-pressed={panels.groupOpen}
                className="flex"
              >
                {actions.fallbackCharacter.avatarUrl ? (
                  <img
                    src={actions.fallbackCharacter.avatarUrl}
                    alt={actions.fallbackCharacter.name}
                    className="h-10 w-10 rounded-[var(--radius-md)] border object-cover object-top"
                    style={{ borderColor: panels.groupOpen ? "var(--color-accent)" : "var(--color-border-strong)" }}
                  />
                ) : (
                  <span
                    className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] border text-sm font-medium"
                    style={{ borderColor: "var(--color-border-strong)", backgroundColor: "var(--color-surface-2)", color: "var(--color-text-muted)" }}
                  >
                    {(actions.fallbackCharacter.name || "?").trim().charAt(0).toUpperCase() || "?"}
                  </span>
                )}
              </button>
              {panels.groupOpen && chat && (
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
                  onClose={() => panels.setGroupOpen(false)}
                />
              )}
            </div>
          )}
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
                    : formatProviderError(error, t)}
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
              membersById={actions.membersById}
              fallbackCharacter={actions.fallbackCharacter}
              personaAvatarUrl={avatarSrc(persona?.avatarPath ?? null)}
              personaName={persona?.name}
              streamingSpeakerId={streamingSpeakerId}
              isGroup={isGroup}
              onBranch={(messageId) => void actions.handleBranch(messageId)}
              onSpeakMessage={actions.handleSpeakMessage}
              speakingMessageId={actions.ttsSpeakingId}
              scrollToMessageId={actions.scrollToMessageId}
              hasOlder={hasOlderMessages}
              loadingOlder={loadingOlderMessages}
              onLoadOlder={() => void loadOlderMessages()}
              onEdit={(messageId, content) => void editMessage(messageId, content)}
              onRegenerate={(messageId) => void regenerate(messageId)}
              onContinue={(messageId) => void continueMessage(messageId)}
              onSwipe={(messageId, offset) => void switchSwipe(messageId, offset)}
            />
          )}

        </div>

        {panels.memoryOpen && (
          <>
            <div
              className="fixed inset-0 z-40 lg:hidden"
              style={{ backgroundColor: "var(--color-overlay)" }}
              onClick={() => panels.setMemoryOpen(false)}
            />
            <aside
              className="fixed inset-y-0 right-0 z-50 w-full max-w-sm border-l lg:static lg:z-auto lg:w-96 lg:max-w-none lg:shrink-0"
              style={{ borderColor: "var(--color-border)" }}
            >
              <MemoryPanel
                chatId={id}
                onClose={() => panels.setMemoryOpen(false)}
                onJumpToMessage={(messageId) =>
                  void actions.handleJumpToMessage(messageId, () => panels.setMemoryOpen(false))
                }
              />
            </aside>
          </>
        )}
        {panels.inventoryOpen && chat && (
          <>
            <div
              className="fixed inset-0 z-40 lg:hidden"
              style={{ backgroundColor: "var(--color-overlay)" }}
              onClick={() => panels.setInventoryOpen(false)}
            />
            <aside
              className="fixed inset-y-0 right-0 z-50 w-full max-w-sm border-l lg:static lg:z-auto lg:w-72 lg:max-w-none lg:shrink-0"
              style={{ borderColor: "var(--color-border)" }}
            >
              <InventoryPanel inventory={chat.inventory} race={persona?.race} onClose={() => panels.setInventoryOpen(false)} />
            </aside>
          </>
        )}
        {panels.questsOpen && (
          <>
            <div
              className="fixed inset-0 z-40 lg:hidden"
              style={{ backgroundColor: "var(--color-overlay)" }}
              onClick={() => panels.setQuestsOpen(false)}
            />
            <aside
              className="fixed inset-y-0 right-0 z-50 w-full max-w-sm border-l lg:static lg:z-auto lg:w-72 lg:max-w-none lg:shrink-0"
              style={{ borderColor: "var(--color-border)" }}
            >
              <QuestPanel chatId={id} onClose={() => panels.setQuestsOpen(false)} />
            </aside>
          </>
        )}
        {panels.characterOpen && chat && (
          <>
            <div
              className="fixed inset-0 z-40 lg:hidden"
              style={{ backgroundColor: "var(--color-overlay)" }}
              onClick={() => panels.setCharacterOpen(false)}
            />
            <aside
              className="fixed inset-y-0 right-0 z-50 w-full max-w-sm border-l lg:static lg:z-auto lg:w-72 lg:max-w-none lg:shrink-0"
              style={{ borderColor: "var(--color-border)" }}
            >
              <CharacterPanel
                age={persona?.age ?? null}
                level={chat.level}
                xp={chat.xp}
                conditions={chat.conditions}
                modifications={chat.modifications}
                skills={chat.skills}
                onClose={() => panels.setCharacterOpen(false)}
              />
            </aside>
          </>
        )}
        {panels.calendarOpen && calendarDate && (
          <>
            <div
              className="fixed inset-0 z-40 lg:hidden"
              style={{ backgroundColor: "var(--color-overlay)" }}
              onClick={() => panels.setCalendarOpen(false)}
            />
            <aside
              className="fixed inset-y-0 right-0 z-50 w-full max-w-sm border-l lg:static lg:z-auto lg:w-72 lg:max-w-none lg:shrink-0"
              style={{ borderColor: "var(--color-border)" }}
            >
              <CalendarPanel
                calendarDate={calendarDate}
                calendarMode={calendarMode}
                weather={weather}
                events={calendarEvents}
                onClose={() => panels.setCalendarOpen(false)}
                onAddEvent={(draft) => {
                  void (async () => {
                    const ev = {
                      id: crypto.randomUUID(),
                      chatId: id,
                      day: draft.day,
                      monthName: draft.monthName,
                      year: calendarDate.year,
                      title: draft.title,
                      description: draft.description,
                      icon: "📅",
                    };
                    await createCalendarEvent(ev);
                    const updated = await listCalendarEvents(id);
                    setCalendarEvents(updated);
                  })();
                }}
                onDeleteEvent={(eventId) => {
                  void (async () => {
                    await deleteCalendarEvent(eventId);
                    setCalendarEvents((prev) => prev.filter((e) => e.id !== eventId));
                  })();
                }}
              />
            </aside>
          </>
        )}

        {/* ---- Chronicle Export Dialog ---- */}
        {panels.exportOpen && (
          <>
            <div
              className="fixed inset-0 z-50"
              style={{ backgroundColor: "var(--color-overlay)" }}
              onClick={() => panels.setExportOpen(false)}
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
              {actions.exportJobId ? (
                /* ---- Progress ---- */
                <div className="space-y-3">
                  <h3 className="font-[var(--font-display)] text-lg">📖 Export kroniky</h3>
                  {actions.exportStatus ? (
                    <>
                      <div
                        className="h-2 w-full rounded-full overflow-hidden"
                        style={{ backgroundColor: "var(--color-surface-2)" }}
                      >
                        <div
                          className="h-full transition-all duration-300"
                          style={{
                            width: `${actions.exportStatus.progress}%`,
                            backgroundColor: "var(--color-accent)",
                          }}
                        />
                      </div>
                      <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                        Exportuji {actions.exportStatus.progress}% ({actions.exportStatus.currentChunk}/{actions.exportStatus.totalChunks} kapitol)
                      </p>
                      {actions.exportStatus.status === "done" && (
                        <div className="space-y-2">
                          <p className="text-sm font-medium" style={{ color: "var(--color-success, #22c55e)" }}>
                            ✅ Hotovo!
                          </p>
                          {actions.exportStatus.outputPath && (
                            <button
                              type="button"
                              className="rounded-[var(--radius-sm)] border px-3 py-1 text-xs transition-colors"
                              style={{
                                borderColor: "var(--color-border-strong)",
                                color: "var(--color-text)",
                              }}
                              onClick={() => {
                                void invoke("open_path", { path: actions.exportStatus!.outputPath });
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
                      value={actions.exportConnectionId}
                      onChange={(e) => actions.setExportConnectionId(e.target.value)}
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
                      value={actions.exportTheme}
                      onChange={(e) => actions.setExportTheme(e.target.value as ChronicleTheme)}
                    >
                      {THEMES.map((theme) => (
                        <option key={theme.key} value={theme.key}>{theme.label}</option>
                      ))}
                    </select>
                  </label>

                  <fieldset className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                    <legend className="mb-1">Formát</legend>
                    <label className="mr-4 inline-flex items-center gap-1">
                      <input type="radio" name="exportFormat" value="html" checked={actions.exportFormat === "html"} onChange={() => actions.setExportFormat("html")} />
                      HTML
                    </label>
                    <label className="inline-flex items-center gap-1">
                      <input type="radio" name="exportFormat" value="pdf" checked={actions.exportFormat === "pdf"} onChange={() => actions.setExportFormat("pdf")} />
                      PDF
                    </label>
                  </fieldset>

                  <label className="flex items-center gap-2 text-xs" style={{ color: "var(--color-text-muted)" }}>
                    <input type="checkbox" checked={actions.exportIllustrations} onChange={(e) => actions.setExportIllustrations(e.target.checked)} />
                    Ilustrace
                  </label>

                  <button
                    className="w-full rounded-[var(--radius-sm)] px-3 py-2 text-sm font-medium transition-colors"
                    onClick={async () => {
                      try {
                        const result: { jobId: string } = await invoke("start_export", {
                          chatId: id,
                          personaId: chat?.personaId ?? undefined,
                          connectionId: actions.exportConnectionId,
                          theme: actions.exportTheme,
                          format: actions.exportFormat,
                          includeIllustrations: actions.exportIllustrations,
                        });
                        actions.setExportJobId(result.jobId);
                        actions.setExportStatus(null);
                      } catch (err) {
                        console.error("ChatScreen: chronicle export start failed for chat", id, err);
                      }
                    }}
                    disabled={!actions.exportConnectionId}
                    style={{
                      backgroundColor: actions.exportConnectionId ? "var(--color-accent)" : "var(--color-surface-2)",
                      color: actions.exportConnectionId ? "var(--color-accent-contrast)" : "var(--color-text-faint)",
                    }}
                  >
                    Spustit export
                  </button>
                </div>
              )}
            </div>
          </>
        )}
        {/* Right chat-tools sidebar — mirrors the app's main Sidebar.tsx language */}
        <nav
          className="flex w-14 shrink-0 flex-col items-center gap-1 border-l p-2"
          style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-elevated)" }}
          aria-label={t("room.toolsSidebar")}
        >
          {(
            [
              { icon: "🧍", open: panels.characterOpen, onToggle: () => panels.setCharacterOpen((v) => !v), title: t("room.characterTooltip") },
              { icon: "🎒", open: panels.inventoryOpen, onToggle: () => panels.setInventoryOpen((v) => !v), title: t("room.inventoryTooltip") },
              { icon: "📜", open: panels.questsOpen, onToggle: () => panels.setQuestsOpen((v) => !v), title: t("room.questsTooltip") },
              { icon: "📅", open: panels.calendarOpen, onToggle: () => panels.setCalendarOpen((v) => !v), title: t("room.calendarTooltip") },
            ] satisfies { icon: string; open: boolean; onToggle: () => void; title: string }[]
          ).map(({ icon, open, onToggle, title }) => (
            <button
              key={icon}
              type="button"
              onClick={onToggle}
              title={title}
              aria-pressed={open}
              className="flex w-full items-center justify-center rounded-[var(--radius-sm)] py-2 text-base transition-colors"
              style={{
                backgroundColor: open ? "var(--color-accent)" : "var(--color-surface)",
                color: open ? "var(--color-accent-contrast)" : "var(--color-text-muted)",
              }}
            >
              {icon}
            </button>
          ))}

          <div className="my-1 w-8 border-t" style={{ borderColor: "var(--color-border)" }} />

          {(
            [
              { icon: "🧠", open: panels.memoryOpen, onToggle: () => panels.setMemoryOpen((v) => !v), title: t("room.memoryTooltip") },
              { icon: "🎬", open: panels.directorOpen, onToggle: () => panels.setDirectorOpen((v) => !v), title: t("director.title") },
              { icon: "📖", open: panels.exportOpen, onToggle: () => panels.setExportOpen((v) => !v), title: t("room.exportTooltip") },
            ] satisfies { icon: string; open: boolean; onToggle: () => void; title: string }[]
          ).map(({ icon, open, onToggle, title }) => (
            <button
              key={icon}
              type="button"
              onClick={onToggle}
              title={title}
              aria-pressed={open}
              className="flex w-full items-center justify-center rounded-[var(--radius-sm)] py-2 text-base transition-colors"
              style={{
                backgroundColor: open ? "var(--color-accent)" : "var(--color-surface)",
                color: open ? "var(--color-accent-contrast)" : "var(--color-text-muted)",
              }}
            >
              {icon}
            </button>
          ))}

          <div className="mt-auto flex flex-col items-center pt-2">
            <div
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-sm"
              style={{
                borderColor: connection ? "var(--color-success)" : "var(--color-danger)",
                backgroundColor: "var(--color-surface-2)",
              }}
              title={
                connection
                  ? `${t("room.connectionLabel")} ${connection.name}\n${t("room.contextLabel")}: ${Math.round(actions.contextUsage * 100)}%`
                  : t("room.errors.noConnection")
              }
            >
              {connection ? "🔌" : "⚠️"}
            </div>
          </div>
        </nav>

      </div>

      {/* Full-width footer input — sibling of <header>, spans the whole
          window like it does, instead of stopping at the right sidebar. */}
      <div className="shrink-0 border-t px-4 sm:px-8" style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-elevated)" }}>
        {isGroup && (
          <SpeakerPicker
            members={memberCharacters}
            selectedSpeakerId={selectedSpeakerId}
            predictedSpeakerId={actions.predictedSpeakerId}
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
          onDiceRoll={(expression) => void actions.handleDiceRoll(expression)}
          onStop={() => void stop()}
          suggestions={combinedSuggestions}
          suggesting={suggesting}
          showSuggestButton={actions.inlineSuggestions.length === 0}
          onSuggest={() => void suggestReplies()}
          onClearSuggestions={() => {
            clearSuggestions();
            if (lastMessage?.role === "assistant") actions.setDismissedSuggestionsMsgId(lastMessage.id);
          }}
          personaSlot={personaSlot}
        />
      </div>

      {/* Bottom bar: group members */}
      {memberCharacters.length > 1 && (
      <div className="flex shrink-0 items-center gap-3 border-t px-4 py-1.5" style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-elevated)" }}>
        <div className="relative">
          <button
            type="button"
            onClick={() => panels.setGroupOpen((v) => !v)}
            aria-pressed={panels.groupOpen}
            title={t("room.groupMembers") ?? ""}
            className="flex items-center rounded-[var(--radius-sm)] border px-1.5 py-1 transition-colors"
            style={{
              borderColor: "var(--color-border-strong)",
              backgroundColor: panels.groupOpen ? "var(--color-accent)" : "transparent",
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
                  className="h-6 w-6 rounded-full border object-cover object-top"
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
        </div>
      </div>
      )}
    </div>
  );
}
