import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";

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
import { CalendarPanel } from "./CalendarPanel";
import { ChatInput } from "./ChatInput";
import { DirectorPopover } from "./DirectorPopover";
import { MessageList } from "./MessageList";
import { SpeakerPicker } from "./SpeakerPicker";
import { countMessages } from "../../db/repositories/messagesRepo";

import { useChatPanels } from "./useChatPanels";
import { useChatActions } from "./useChatActions";
import { ReferencePanel } from "./ReferencePanel";
import { useChatCalendar } from "./useChatCalendar";
import { useDeepseekBalance } from "./useDeepseekBalance";
import { useChatRecipes } from "./useChatRecipes";
import { PersonaSwitcher } from "./PersonaSwitcher";
import { ChatHeader } from "./ChatHeader";
import { ChatErrorBanner } from "./ChatErrorBanner";
import { ChronicleExportDialog } from "./ChronicleExportDialog";
import { ChatToolsSidebar } from "./ChatToolsSidebar";
import { GroupMembersBar } from "./GroupMembersBar";

export function ChatScreen() {
  const { id } = useParams<{ id: string }>();
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
    preparingMessage,
    streaming,
    streamingMessageId,
    streamingText,
    error,
    errorRetryable,
    retry,
    interruptedMessageIds,
    hasOlderMessages,
    loadingOlderMessages,
    gameOver,
    pendingCheckSkill,
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
    setHardcoreMode,
    setSelectedSpeaker,
  } = useChatStore();
  const calendarMode = useSettingsStore((s) => s.calendarMode);
  const { connections, loaded: connectionsLoaded, load: loadConnections } = useConnectionsStore();
  const { personas, loaded: personasLoaded, load: loadPersonas } = usePersonasStore();
  const { characters, loaded: charactersLoaded, load: loadCharacters } = useCharactersStore();
  const { setPersona } = useChatListStore();

  // ── Panel state ────────────────────────────────────────────────────
  const panels = useChatPanels();

  const { calendarDate, weather, calendarEvents, addEvent, deleteEvent } = useChatCalendar(id, messages.length);

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

  const { deepseekBalance, balanceError, chatUsage } = useDeepseekBalance(id, connection);

  // Reference panel → ChatInput insertion
  const [insertRef, setInsertRef] = useState<{ key: number; text: string } | null>(null);
  const insertKeyRef = useRef(0);
  const handleInsertRef = (text: string) => {
    insertKeyRef.current++;
    setInsertRef({ key: insertKeyRef.current, text });
  };

  const recipes = useChatRecipes(id);

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
      c.provider === "gemini" || c.purpose === "chat",
  );

  const personaSlot = (
    <PersonaSwitcher
      chatId={id}
      persona={persona}
      personas={personas}
      currentPersonaId={chat?.personaId}
      onSetPersona={setPersona}
    />
  );

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div className="relative flex h-full flex-col">
      {panels.directorOpen && id && (
        <DirectorPopover
          chatId={id}
          onClose={() => panels.setDirectorOpen(false)}
          hardcoreMode={chat?.hardcoreMode ?? false}
          onToggleHardcoreMode={(on) => void setHardcoreMode(on)}
        />
      )}
      {gameOver && (
        <div
          className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 px-6 text-center"
          style={{ backgroundColor: "var(--color-overlay)" }}
        >
          <h2
            className="font-[var(--font-display)] text-4xl tracking-wide"
            style={{ color: "var(--color-danger)" }}
          >
            {t("gameOver.title")}
          </h2>
          <p className="max-w-md text-sm" style={{ color: "var(--color-text)" }}>
            {gameOver.reason}
          </p>
          <p className="max-w-md text-xs" style={{ color: "var(--color-text-muted)" }}>
            {t("gameOver.hint")}
          </p>
        </div>
      )}
      <ChatHeader
        chat={chat}
        chatId={id}
        calendarDate={calendarDate}
        calendarMode={calendarMode}
        weather={weather}
        fallbackCharacter={actions.fallbackCharacter}
        groupOpen={panels.groupOpen}
        onToggleGroup={() => panels.setGroupOpen((v) => !v)}
        onCloseGroup={() => panels.setGroupOpen(false)}
        members={members}
        memberCharacters={memberCharacters}
        allCharacters={characters}
        autoReply={autoReply}
        promotionConnection={promotionConnection}
        onAddMember={addMember}
        onRemoveMember={removeMember}
        onSetAutoReply={setAutoReplyMode}
      />

      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col overflow-hidden">
          {error && (
            <ChatErrorBanner
              error={error}
              errorRetryable={errorRetryable}
              retry={retry}
              onDismiss={dismissError}
            />
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
                onAddEvent={addEvent}
                onDeleteEvent={deleteEvent}
              />
            </aside>
          </>
        )}

        {/* ---- Skills & Recipes Reference ---- */}
        {panels.referenceOpen && chat && (
          <>
            <div
              className="fixed inset-0 z-40 lg:hidden"
              style={{ backgroundColor: "var(--color-overlay)" }}
              onClick={() => panels.setReferenceOpen(false)}
            />
            <aside
              className="fixed inset-y-0 right-0 z-50 w-full max-w-sm border-l lg:static lg:z-auto lg:w-72 lg:max-w-none lg:shrink-0"
              style={{ borderColor: "var(--color-border)" }}
            >
              <ReferencePanel
                skills={chat.skills}
                inventory={chat.inventory}
                recipes={recipes}
                onInsert={handleInsertRef}
              />
            </aside>
          </>
        )}

        {/* ---- Chronicle Export Dialog ---- */}
        {panels.exportOpen && (
          <ChronicleExportDialog
            actions={actions}
            chatId={id}
            personaId={chat?.personaId}
            exportConnections={exportConnections}
            onClose={() => panels.setExportOpen(false)}
          />
        )}
        <ChatToolsSidebar
          panelToggles={[
            { icon: "🧍", open: panels.characterOpen, onToggle: () => panels.setCharacterOpen((v) => !v), title: t("room.characterTooltip") },
            { icon: "🎒", open: panels.inventoryOpen, onToggle: () => panels.setInventoryOpen((v) => !v), title: t("room.inventoryTooltip") },
            { icon: "📜", open: panels.questsOpen, onToggle: () => panels.setQuestsOpen((v) => !v), title: t("room.questsTooltip") },
            { icon: "📅", open: panels.calendarOpen, onToggle: () => panels.setCalendarOpen((v) => !v), title: t("room.calendarTooltip") },
            { icon: "🔧", open: panels.referenceOpen, onToggle: () => panels.setReferenceOpen((v) => !v), title: t("room.referenceTooltip") },
          ]}
          actionToggles={[
            { icon: "🧠", open: panels.memoryOpen, onToggle: () => panels.setMemoryOpen((v) => !v), title: t("room.memoryTooltip") },
            { icon: "🎬", open: panels.directorOpen, onToggle: () => panels.setDirectorOpen((v) => !v), title: t("director.title") },
            { icon: "📖", open: panels.exportOpen, onToggle: () => panels.setExportOpen((v) => !v), title: t("room.exportTooltip") },
          ]}
          connection={connection}
          deepseekBalance={deepseekBalance}
          balanceError={balanceError}
          chatUsage={chatUsage}
          contextUsage={actions.contextUsage}
        />

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
          chatId={id}
          disabled={loading || !connection || !!gameOver}
          streaming={streaming}
          preparing={preparingMessage}
          onSend={(content) => void sendMessage(content)}
          onDiceRoll={(expression) => void actions.handleDiceRoll(expression)}
          skills={chat?.skills}
          inventory={chat?.inventory}
          pendingCheckSkill={pendingCheckSkill}
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
          insertRef={insertRef}
        />
      </div>

      <GroupMembersBar
        memberCharacters={memberCharacters}
        groupOpen={panels.groupOpen}
        onToggleGroup={() => panels.setGroupOpen((v) => !v)}
      />
    </div>
  );
}
