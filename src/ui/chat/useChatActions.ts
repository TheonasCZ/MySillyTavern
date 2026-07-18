import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";

import type { ChronicleTheme, ChronicleFormat, ExportStatus } from "../../chat/chronicleTypes";
import { showConfirm } from "../../platform";
import { branchChat } from "../../db/repositories/chatsRepo";
import { createMessage } from "../../db/repositories/messagesRepo";
import { useChatStore } from "../../stores/chatStore";
import { useTts } from "../../chat/useTts";
import { formatDiceSystemMessage } from "../../chat/diceCommand";
import { pickNextSpeaker } from "../../chat/groupSpeaker";
import { extractInlineSuggestions } from "../../chat/inlineSuggestions";
import { avatarSrc } from "../characters/avatarSrc";
import type { MemberInfo } from "./MessageList";

export interface ChatActionsParams {
  chatId: string | null;
  /** route param id */
  id: string | undefined;
  messages: ReturnType<typeof useChatStore.getState>["messages"];
  streaming: boolean;
  members: ReturnType<typeof useChatStore.getState>["members"];
  memberCharacters: ReturnType<typeof useChatStore.getState>["memberCharacters"];
  characters: ReturnType<typeof import("../../stores/charactersStore").useCharactersStore.getState>["characters"];
  connection: ReturnType<typeof import("../../stores/connectionsStore").useConnectionsStore.getState>["connections"][number] | undefined;
  autoReply: boolean;
  selectedSpeakerId: string | null;
  /** Whether this is a group chat (members.length > 1) */
  isGroup: boolean;
  /** chat.characterId for the primary character */
  chatCharacterId: string | undefined;
}

/**
 * Encapsulates chat-specific actions and derived state that live between
 * the ChatStore and the ChatScreen UI: TTS, dice rolling, message jumping,
 * branching, chronicle export, inline suggestions, context-usage estimate,
 * and predicted next speaker.
 */
export function useChatActions(params: ChatActionsParams) {
  const {
    chatId,
    id,
    messages,
    streaming,
    members,
    memberCharacters,
    characters,
    connection,
    
    
    isGroup,
    chatCharacterId,
  } = params;

  const navigate = useNavigate();
  const { t } = useTranslation(["chat", "common", "memory"]);

  // ── TTS ────────────────────────────────────────────────────────────
  const tts = useTts();
  const [ttsSpeakingId, setTtsSpeakingId] = useState<string | null>(null);
  const lastAssistantIdRef = useRef<string | null>(null);
  const ttsInitializedRef = useRef(false);

  // Auto-read: when a new assistant message arrives and autoRead is on,
  // speak it automatically.
  useEffect(() => {
    if (!tts.autoRead) return;
    const lastAsst = [...messages].reverse().find((m) => m.role === "assistant");
    if (!lastAsst) return;
    if (!ttsInitializedRef.current) {
      lastAssistantIdRef.current = lastAsst.id;
      ttsInitializedRef.current = true;
      return;
    }
    if (lastAsst.id !== lastAssistantIdRef.current && !streaming) {
      lastAssistantIdRef.current = lastAsst.id;
      const charVoice = lastAsst.characterId
        ? characters.find((c) => c.id === lastAsst.characterId)?.ttsVoice ?? undefined
        : undefined;
      setTtsSpeakingId(lastAsst.id);
      tts.speak(lastAsst.content, charVoice);
    }
  }, [messages, streaming, tts.autoRead, tts, characters]);

  const handleSpeakMessage = useCallback(
    (messageId: string) => {
      const msg = messages.find((m) => m.id === messageId);
      if (!msg) return;
      if (ttsSpeakingId === messageId && tts.isSpeaking) {
        tts.stop();
        setTtsSpeakingId(null);
      } else {
        const charVoice = msg.characterId
          ? characters.find((c) => c.id === msg.characterId)?.ttsVoice ?? undefined
          : undefined;
        setTtsSpeakingId(messageId);
        tts.speak(msg.content, charVoice);
      }
    },
    [messages, tts, ttsSpeakingId, characters],
  );

  // Clear speaking id when speech ends
  useEffect(() => {
    if (!tts.isSpeaking && ttsSpeakingId) {
      setTtsSpeakingId(null);
    }
  }, [tts.isSpeaking, ttsSpeakingId]);

  // A new stream replaces whatever was being read aloud
  useEffect(() => {
    if (streaming && ttsSpeakingId) {
      tts.stop();
      setTtsSpeakingId(null);
    }
  }, [streaming, ttsSpeakingId, tts]);

  // ── Jump-to-message (chronicle) ────────────────────────────────────
  const [scrollToMessageId, setScrollToMessageId] = useState<string | null>(null);

  const handleJumpToMessage = useCallback(
    async (messageId: string, onClose?: () => void) => {
      const state = useChatStore.getState;
      const isLoaded = () => state().messages.some((m) => m.id === messageId);
      let guard = 0;
      while (!isLoaded() && state().hasOlderMessages && guard++ < 200) {
        await state().loadOlderMessages();
      }
      if (!isLoaded()) return;
      // Close panels before scrolling so the layout is settled
      onClose?.();
      setScrollToMessageId(null);
      requestAnimationFrame(() => setScrollToMessageId(messageId));
    },
    [],
  );

  // ── Dice roll ──────────────────────────────────────────────────────
  const handleDiceRoll = useCallback(
    async (expression: string) => {
      if (!chatId) return;
      try {
        const result: string = await invoke("eval_dice", { expression });
        const content = formatDiceSystemMessage(expression, result);
        const systemMsg = await createMessage(chatId, "system", content);
        if (useChatStore.getState().chatId === chatId) {
          useChatStore.setState((s) => ({
            messages: [...s.messages, systemMsg],
          }));
        }
      } catch (err) {
        console.error("ChatScreen: dice roll failed for expression", expression, "in chat", chatId, err);
      }
    },
    [chatId],
  );

  // ── Branch ─────────────────────────────────────────────────────────
  const handleBranch = useCallback(
    async (messageId: string) => {
      if (!(await showConfirm(t("room.branchConfirm") ?? ""))) return;
      if (!id) return;
      const branched = await branchChat(id, messageId, t("room.branchSuffix"));
      if (branched) navigate(`/chat/${branched.id}`);
    },
    [id, navigate, t],
  );

  // ── Export state & effects ─────────────────────────────────────────
  const [exportConnectionId, setExportConnectionId] = useState("");
  const [exportTheme, setExportTheme] = useState<ChronicleTheme>("fantasy");
  const [exportFormat, setExportFormat] = useState<ChronicleFormat>("html");
  const [exportIllustrations, setExportIllustrations] = useState(true);
  const [exportJobId, setExportJobId] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<ExportStatus | null>(null);

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
        const stored = localStorage.getItem(`export_job_${id}`);
        if (!stored) return;
        const { jobId } = JSON.parse(stored) as { jobId: string };
        const status: ExportStatus = await invoke("get_export_status", { jobId });
        if (cancelled) return;
        if (status.status === "running") {
          setExportJobId(jobId);
          setExportStatus(status);
        } else {
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

  // ── Inline suggestions ─────────────────────────────────────────────
  const [dismissedSuggestionsMsgId, setDismissedSuggestionsMsgId] = useState<string | null>(null);

  const lastMessage = messages[messages.length - 1];
  const inlineSuggestions =
    !streaming && lastMessage?.role === "assistant" && lastMessage.id !== dismissedSuggestionsMsgId
      ? extractInlineSuggestions(lastMessage.content)
      : [];

  // ── Derived values ─────────────────────────────────────────────────
  const membersById = new Map<string, MemberInfo>(
    memberCharacters.map((c) => [c.id, { name: c.name, avatarUrl: avatarSrc(c.avatarPath) }]),
  );

  const contextUsage = connection
    ? Math.min(1, messages.reduce((sum, m) => sum + (m.content?.length ?? 0), 0) / 3 / connection.contextBudget)
    : 0;

  const primaryCharacter = memberCharacters.find((c) => c.id === chatCharacterId);
  const fallbackCharacter: MemberInfo = {
    name: primaryCharacter?.name ?? "",
    avatarUrl: avatarSrc(primaryCharacter?.avatarPath ?? null),
  };

  const lastUserText = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const recentSpeakerIds = messages
    .filter((m) => m.role === "assistant")
    .map((m) => m.characterId ?? chatCharacterId ?? "");
  const speakerCandidates = members.map((m) => ({
    id: m.characterId,
    name: memberCharacters.find((c) => c.id === m.characterId)?.name ?? "",
    position: m.position,
  }));
  const predictedSpeakerId = isGroup
    ? pickNextSpeaker(speakerCandidates, lastUserText, recentSpeakerIds)
    : null;

  return {
    // TTS
    tts,
    ttsSpeakingId,
    setTtsSpeakingId,
    handleSpeakMessage,
    // Jump-to-message
    scrollToMessageId,
    setScrollToMessageId,
    handleJumpToMessage,
    // Dice
    handleDiceRoll,
    // Branch
    handleBranch,
    // Export
    exportConnectionId,
    setExportConnectionId,
    exportTheme,
    setExportTheme,
    exportFormat,
    setExportFormat,
    exportIllustrations,
    setExportIllustrations,
    exportJobId,
    setExportJobId,
    exportStatus,
    setExportStatus,
    // Inline suggestions
    dismissedSuggestionsMsgId,
    setDismissedSuggestionsMsgId,
    inlineSuggestions,
    // Derived
    membersById,
    contextUsage,
    fallbackCharacter,
    predictedSpeakerId,
  };
}
