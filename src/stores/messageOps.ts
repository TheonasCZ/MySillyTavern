import type { Character } from "../db/repositories/charactersRepo";
import { getChat, touchChat, type Chat } from "../db/repositories/chatsRepo";
import {
  appendSwipe,
  createMessage,
  type Message,
} from "../db/repositories/messagesRepo";
import { listAllFacts } from "../db/repositories/ledgerRepo";
import { stripSpeakerPrefix } from "../chat/groupSpeaker";
import { applyRegexRules } from "../chat/regexTransform";
import { clearPendingCheckSkill } from "../chat/pendingCheck";
import { parseChangeSummary, serializeChangeSummary } from "../chat/changeSummary";
import { scheduleMemoryWork } from "../memory/memoryEngine";
import {
  detectFactViolations,
  prepareFactForDetection,
  violationCorrectionText,
  type FactForDetection,
} from "../memory/driftDetector";
import { CONTINUE_AS, CONTINUE_EXACT, CONTINUE_EXACT_SOLO } from "../prompt/promptTexts";

import type { ChatMessage, ConnectionConfig } from "../providers/types";
import { chatStream, type ChatStreamHandle } from "../providers/chatStream";
import { lookupItemDetailForChat } from "../chat/toolCalling";
import { processGameResponse, extractTagsWithAI } from "../chat/inventoryProcessor";
import { parseGameTags } from "../chat/inventoryTags";
import { logChatUsage, resolveChatPersona, resolveConnection, applyPreset, clearInterrupted, markInterrupted, buildApiMessages, MAX_FUNCTION_CALL_ROUND_TRIPS } from "./configOps";
import { logChatExchange } from "../chat/chatLogger";
import { useConnectionsStore } from "./connectionsStore";
import { toConnectionDto } from "../providers/dto";
import { updateMessageContent } from "../db/repositories/messagesRepo";
import { listFactions } from "../db/repositories/factionsRepo";
import { listChatRecipes } from "../db/repositories/craftingRepo";
import { getCalendarSetting } from "../db/repositories/settingsRepo";
import { listQuests } from "../db/repositories/questsRepo";
import { calendarDescription, calendarFromJSON } from "../memory/calendar";
import { useSettingsStore } from "./settingsStore";
import { resolveSpeaker, pickSpeakerId } from "./speakerOps";
import { scheduleVoiceEmbedding } from "./extractionOps";
import type { Setter, Getter } from "./chatStoreTypes";

export function startStream(
  connection: ConnectionConfig,
  apiMessages: ChatMessage[],
  set: Setter,
  get: Getter,
  finalize: (content: string, interrupted: boolean, changeSummary?: string | null) => Promise<void>,
  retry: () => void,
  refreshChatState: (chatId: string) => Promise<void>,
  // EXPERIMENTAL: number of `get_item_detail` round trips already spent on
  // this reply — see `MAX_FUNCTION_CALL_ROUND_TRIPS`.
  functionCallDepth = 0,
  // Number of times this reply has already been silently re-issued after
  // the model returned an empty completion (0 chars, no error) — some
  // reasoning models occasionally burn their whole token budget on
  // reasoning and return nothing. One automatic retry; a second empty
  // response in a row surfaces as a real error instead of looping forever.
  emptyRetryCount = 0,
) {
  set({
    streaming: true,
    streamingText: "",
    error: null,
    errorRetryable: false,
    retry: null,
    // Only invoked by `stop()` (manual abort) — always a partial response,
    // so it's always flagged as interrupted.
    pendingFinalize: (text) => finalize(text, true),
  });

  // EXPERIMENTAL (function-calling prototype): only Gemini connections get
  // the `get_item_detail` tool offered (see gemini.rs — the other providers
  // don't implement it), and only up to the round-trip cap.
  const offerTools = connection.provider === "gemini" && functionCallDepth < MAX_FUNCTION_CALL_ROUND_TRIPS;

  // `streaming` stays true until `finalize` has actually persisted the
  // message and updated `messages` — clearing it earlier would make the
  // streaming bubble disappear for a frame before the real message row
  // takes its place.
  const handle: ChatStreamHandle = chatStream(
    connection,
    apiMessages,
    {
      onToken: (text) => {
        set((s) => ({ streamingText: s.streamingText + text }));
      },
      onDone: () => {
        const text = get().streamingText;
        if (text.trim().length === 0) {
          set({ handle: null, pendingFinalize: null });
          if (emptyRetryCount < 1) {
            startStream(connection, apiMessages, set, get, finalize, retry, refreshChatState, functionCallDepth, emptyRetryCount + 1);
          } else {
            set({
              streaming: false,
              streamingText: "",
              streamingMessageId: null,
              streamingSpeakerId: null,
              error: "empty-response",
              errorRetryable: true,
              retry,
            });
          }
          return;
        }
        set({ handle: null, pendingFinalize: null });
        logChatUsage(connection.id, apiMessages, text, get().chatId);
        // Write the full exchange (prompt + response) to `chat.log` so
        // the user can inspect what the model actually saw vs returned.
        logChatExchange(connection.name, connection.model, get().chatId, apiMessages, text);

        // Show the message immediately — strip any inline tags the
        // storyteller may have written (habit), then persist. The AI
        // extraction + state mutations run in background so the player
        // never waits for the extractor.
        const displayText = parseGameTags(text).cleanText;
        void finalize(displayText, false, null);

        // Process game state async — AI extraction (Gemini Flash) or
        // regex tag parsing, then apply inventory/skill/time mutations.
        const chat = get().chat;
        void (async () => {
          const persona = chat ? await resolveChatPersona(chat) : null;
          let aiTags = null;
          if (chat?.tagExtractionConnectionId) {
            const conn = useConnectionsStore
              .getState()
              .connections.find((c) => c.id === chat.tagExtractionConnectionId);
            if (conn && chat) {
              // Load additional world state for the extractor context.
              // Fire-and-forget best-effort — DB failures just mean the
              // extractor works with less context, same as before.
              const [factions, recipes, quests, calRaw] = await Promise.all([
                persona ? listFactions(persona.id).catch(() => []) : Promise.resolve([]),
                listChatRecipes(chat.id).catch(() => []),
                listQuests(chat.id).catch(() => []),
                getCalendarSetting(chat.id).catch(() => null),
              ]);
              let calDesc: string | undefined;
              if (calRaw) {
                const cal = calendarFromJSON(calRaw);
                calDesc = calendarDescription(cal, useSettingsStore.getState().calendarMode);
              }
              const lastUserMsg = apiMessages.filter((m) => m.role === "user").pop();

              aiTags = await extractTagsWithAI(toConnectionDto(conn), text, {
                skills: chat.skills,
                inventory: chat.inventory,
                conditions: chat.conditions,
                modifications: chat.modifications,
                xp: chat.xp,
                level: chat.level,
                progression: persona?.progression ?? "skill",
                hardcoreMode: chat.hardcoreMode,
                factions: factions.map((f) => ({ name: f.factionName, reputation: f.reputation })),
                recipes: recipes.map((r) => ({ resultItem: r.resultItem, ingredients: r.ingredients })),
                quests: quests.filter(q => q.status === "active").map((q) => ({ name: q.name, status: q.status })),
                calendarDescription: calDesc,
                playerMessage: lastUserMsg?.content?.slice(0, 300),
              });
            }
          }
          const { changeSummary } = await processGameResponse(persona, text, chat?.id, aiTags);
          if (chat?.id) void refreshChatState(chat.id);

          // Update the changeSummary on the already-displayed message.
          // The message was persisted with null; now we fill it in.
          if (changeSummary) {
            // Guard: if the user switched chats while extraction was running,
            // the messages array no longer belongs to this chat — bail out.
            if (get().chatId !== chat?.id) return;
            const messages = get().messages;
            const lastMsg = messages[messages.length - 1];
            if (lastMsg && lastMsg.role === "assistant") {
              const updated = await updateMessageContent(lastMsg, lastMsg.content, changeSummary);
              set((s) => ({
                messages: s.messages.map((m) => (m.id === updated.id ? updated : m)),
              }));
            }
          }
        })();
      },
      onError: (err) => {
        const text = get().streamingText;
        const isOffline = typeof navigator !== "undefined" && !navigator.onLine;
        set({
          handle: null,
          pendingFinalize: null,
          error: isOffline ? "offline" : err.message,
          errorRetryable: isOffline || err.retryable,
          retry: isOffline || err.retryable ? retry : null,
        });
        // A stream that errored out mid-response still leaves useful partial
        // text — persist it (flagged as interrupted) instead of discarding it,
        // so the user can pick it up with "continue"/"regenerate" (plan §9).
        logChatUsage(connection.id, apiMessages, text, get().chatId);
        logChatExchange(connection.name, connection.model, get().chatId, apiMessages, text);
        void finalize(text, true);
      },
      // EXPERIMENTAL (function-calling prototype): the model paused to call
      // `get_item_detail`. Look the name up against the chat's live state,
      // append the call + its result to the conversation, and issue a fresh
      // `chat_stream` call to resume generation — this is the whole
      // round-trip this prototype exists to prove out.
      onFunctionCall: (name, args, thoughtSignature) => {
        const chat = get().chat;
        const startedAt = performance.now();
        if (import.meta.env.DEV) {
          console.info(`[toolCalling] model called ${name}(${JSON.stringify(args)}) — round trip ${functionCallDepth + 1}/${MAX_FUNCTION_CALL_ROUND_TRIPS}`);
        }
        void (async () => {
          const argName =
            args && typeof args === "object" && "name" in args && typeof (args as { name: unknown }).name === "string"
              ? (args as { name: string }).name
              : String(args ?? "");

          let result: string;
          if (!chat?.id) {
            result = "Nelze vyhledat — chat není načten.";
          } else {
            try {
              result = await lookupItemDetailForChat(chat.id, argName);
            } catch (err) {
              result = `Vyhledání selhalo: ${String(err)}`;
            }
          }

          if (import.meta.env.DEV) {
            console.info(`[toolCalling] lookup for "${argName}" resolved in ${(performance.now() - startedAt).toFixed(0)}ms: ${result}`);
          }

          const nextMessages: ChatMessage[] = [
            ...apiMessages,
            { role: "assistant", content: "", function_call: { name, args, thoughtSignature } },
            { role: "user", content: "", function_response: { name, response: { result } } },
          ];
          startStream(connection, nextMessages, set, get, finalize, retry, refreshChatState, functionCallDepth + 1);
        })();
      },
    },
    offerTools,
  );

  set({ handle });
}

/** Extracts up to 3 suggestion strings from the model's reply. Prefers the
 *  requested JSON array (tolerating markdown fences / surrounding prose);
 *  falls back to numbered or bulleted lines when the model ignores the
 *  format, so the button still works with weaker models. */
export function parseSuggestions(reply: string): string[] {
  const jsonMatch = reply.match(/\[[\s\S]*\]/);
  if (jsonMatch) {
    try {
      const parsed: unknown = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed)) {
        const items = parsed.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
        if (items.length > 0) return items.slice(0, 3).map((s) => s.trim());
      }
    } catch {
      // fall through to line-based parsing
    }
  }
  return reply
    .split("\n")
    .map((line) => line.replace(/^\s*(?:\d+[.)]\s*|[-*•]\s*)/, "").trim())
    .filter((line) => line.length > 0 && !/^```/.test(line))
    .slice(0, 3);
}

/** M28c fast rule-based drift check, shared by `sendMessage`/`regenerate`/
 * `continueMessage`'s `finalize` closures — runs before a response is
 * persisted, against active world/player facts. On a severe (>= 0.7) hit,
 * queues a correction (picked up by the next `buildApiMessages` call via
 * `consumeDriftCorrections`) and returns `true` so the caller discards the
 * response and retries. Degrades gracefully (`false`) on any failure — a
 * broken check must never block saving a reply. */
async function runPrePersistCheck(chatId: string, finalText: string): Promise<boolean> {
  try {
    const activeFacts = (await listAllFacts(chatId))
      .filter((f) => f.status === "active" && (f.category === "world" || f.category === "player"));
    const detectionFacts: FactForDetection[] = activeFacts.map(prepareFactForDetection);
    const violations = detectFactViolations(finalText, detectionFacts);
    const severe = violations.filter((v) => v.severity >= 0.7);
    if (severe.length === 0) return false;
    const correctionLines = severe.map(violationCorrectionText);
    const { mergeCorrections, getDriftState } = await import("../memory/driftDetector");
    const { setSetting } = await import("../db/repositories/settingsRepo");
    const driftKey = `drift_state_${chatId}`;
    const state = await getDriftState(chatId);
    state.corrections = mergeCorrections(state.corrections, correctionLines);
    await setSetting(driftKey, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

/** Shared M28c gate used by `sendMessage`/`triggerSpeaker`/`regenerate`/
 * `continueMessage`'s `finalize` closures: runs `runPrePersistCheck` against
 * `text` (unless already interrupted or the auto-retry budget is spent),
 * and on a violation clears the streaming state and calls `retry()`.
 * Returns `true` when the caller should bump its own `autoRetryCount` and
 * bail out of `finalize` (the response was discarded and a retry started),
 * `false` when it's safe to proceed with persisting `text`. */
async function checkPrePersistAndMaybeRetry(
  chatId: string,
  text: string,
  interrupted: boolean,
  autoRetryCount: number,
  maxAutoRetries: number,
  set: Setter,
  retry: () => void,
): Promise<boolean> {
  if (!text || interrupted || autoRetryCount >= maxAutoRetries) return false;
  const violated = await runPrePersistCheck(chatId, text);
  if (!violated) return false;
  set({ streaming: false, streamingText: "", streamingMessageId: null, streamingSpeakerId: null });
  retry();
  return true;
}

const MAX_AUTO_RETRIES = 2;

export async function sendMessage(
  content: string,
  set: Setter,
  get: Getter,
  refreshChatState: (chatId: string) => Promise<void>,
): Promise<void> {
  const trimmed = content.trim();
  const { chatId, messages, streaming, members, memberCharacters, autoReply, selectedSpeakerId, gameOver } = get();
  if (!chatId || !trimmed || streaming || gameOver) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    set({ error: "offline", errorRetryable: true, retry: () => void get().sendMessage(content) });
    return;
  }

  const chat = await getChat(chatId);
  if (!chat) return;
  const connection = resolveConnection(chat.connectionId);
  if (!connection) {
    set({ error: "no-connection", errorRetryable: false, retry: null });
    return;
  }

  // A [CHECK:...] hint only applies to the very next message, used or not
  // — clear it now so a stale skill name from several turns ago can't
  // attach itself to some unrelated later roll.
  if (get().pendingCheckSkill) {
    set({ pendingCheckSkill: null });
    void clearPendingCheckSkill(chatId);
  }

  const speakerId = pickSpeakerId(chat, members, memberCharacters, autoReply, selectedSpeakerId, trimmed, messages);
  const speaker = await resolveSpeaker(chat, memberCharacters, speakerId);
  if (!speaker) return;

  const userMessage = await createMessage(chatId, "user", trimmed);
  set((s) => ({ messages: [...s.messages, userMessage], suggestions: null }));
  void touchChat(chatId);

  const { messages: apiMessages, report, regexRules, presetParams } = await buildApiMessages(
    chat,
    [...messages, userMessage],
    speaker,
    memberCharacters,
  );
  set({ lastPromptReport: report, streamingSpeakerId: speaker.id });

  const effectiveConnection = applyPreset(connection, presetParams);

  // Auto-retry guard: prevent infinite regeneration loops on drift violations.
  let autoRetryCount = 0;

  const finalize = async (text: string, interrupted: boolean, changeSummary: string | null = null) => {
    let finalText = stripSpeakerPrefix(text.trim(), speaker.name).trim();
    finalText = applyRegexRules(finalText, regexRules ?? "");

    // M28c: fast rule-based drift check before saving the message.
    if (await checkPrePersistAndMaybeRetry(chatId, finalText, interrupted, autoRetryCount, MAX_AUTO_RETRIES, set, retry)) {
      autoRetryCount++;
      return;
    }

    if (finalText) {
      const assistantMessage = await createMessage(chatId, "assistant", finalText, speaker.id, changeSummary);
      // Guard (M11 bug sweep): the user may have switched/closed the chat
      // while this stream was finalizing (abort + persist is async) — only
      // splice the new message into `messages`/`selectedSpeakerId` if this
      // is still the chat that's open, so a stale reply can't land in
      // whatever chat is now showing. The DB write above is unconditional
      // (it's addressed by `chatId`, always correct regardless of what's
      // on screen).
      if (get().chatId === chatId) {
        set((s) => ({ messages: [...s.messages, assistantMessage], selectedSpeakerId: speaker.id }));
        if (interrupted) markInterrupted(set, assistantMessage.id);
      }
      void touchChat(chatId);
      // Fire-and-forget: decides on its own whether extraction/summary is
      // actually due, never throws, never blocks the chat (plan §6.3).
      if (!interrupted) scheduleMemoryWork(chatId);
      // Store voice embedding for style-consistency lookups (every 3rd
      // assistant message). Fire-and-forget, never blocks.
      const embConn = resolveConnection(chat.extractionConnectionId) ?? connection;
      void scheduleVoiceEmbedding(chatId, assistantMessage.id, finalText, embConn);
    }
    set({ streaming: false, streamingText: "", streamingMessageId: null, streamingSpeakerId: null });
  };

  // Retrying re-sends the exact same already-persisted user message
  // rather than calling `sendMessage` again (which would duplicate it) —
  // it re-resolves the connection/prompt in case anything changed and
  // restarts the stream from scratch. The chosen speaker stays the same.
  const retry = () => {
    void (async () => {
      const freshChat = await getChat(chatId);
      const freshConnection = freshChat ? resolveConnection(freshChat.connectionId) : null;
      if (!freshChat || !freshConnection) {
        set({ error: "no-connection", errorRetryable: false, retry: null });
        return;
      }
      const { messages: retryApiMessages, report: retryReport, regexRules: _retryRegexRules, presetParams: retryPresetParams } = await buildApiMessages(
        freshChat,
        get().messages,
        speaker,
        get().memberCharacters,
      );
      const retryConn = applyPreset(freshConnection, retryPresetParams);
      set({ lastPromptReport: retryReport, streamingSpeakerId: speaker.id });
      startStream(retryConn, retryApiMessages, set, get, finalize, retry, refreshChatState);
    })();
  };

  startStream(effectiveConnection, apiMessages, set, get, finalize, retry, refreshChatState);
}

/** "Reply now" for a group chat — the picked member reacts without a new
 * player message. Reuses `buildApiMessages` for the current history, then
 * appends a nudge asking that member specifically to continue the scene
 * (plan §5). */
export async function triggerSpeaker(
  speakerId: string,
  set: Setter,
  get: Getter,
  refreshChatState: (chatId: string) => Promise<void>,
): Promise<void> {
  const { chatId, messages, streaming, memberCharacters, gameOver } = get();
  if (!chatId || streaming || gameOver) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    set({ error: "offline", errorRetryable: true, retry: () => void get().triggerSpeaker(speakerId) });
    return;
  }

  const chat = await getChat(chatId);
  if (!chat) return;
  const connection = resolveConnection(chat.connectionId);
  if (!connection) {
    set({ error: "no-connection", errorRetryable: false, retry: null });
    return;
  }

  const speaker = await resolveSpeaker(chat, memberCharacters, speakerId);
  if (!speaker) return;

  const buildTriggerMessages = async (freshChat: Chat, history: Message[], members: Character[]) => {
    const { messages: baseApiMessages, report, regexRules: rr, presetParams: pp } = await buildApiMessages(freshChat, history, speaker, members);
    const apiMessages: ChatMessage[] = [
      ...baseApiMessages,
      { role: "user", content: CONTINUE_AS(speaker.name) },
    ];
    return { apiMessages, report, regexRules: rr, presetParams: pp };
  };

  const { apiMessages, report, regexRules, presetParams } = await buildTriggerMessages(chat, messages, memberCharacters);
  const effectiveConnection = applyPreset(connection, presetParams);
  set({ lastPromptReport: report, streamingSpeakerId: speaker.id });

  const finalize = async (text: string, interrupted: boolean, changeSummary: string | null = null) => {
    let finalText = stripSpeakerPrefix(text.trim(), speaker.name).trim();
    finalText = applyRegexRules(finalText, regexRules ?? "");
    if (finalText) {
      const assistantMessage = await createMessage(chatId, "assistant", finalText, speaker.id, changeSummary);
      // Guard (M11 bug sweep) — see sendMessage's `finalize` for rationale.
      if (get().chatId === chatId) {
        set((s) => ({ messages: [...s.messages, assistantMessage], selectedSpeakerId: speaker.id }));
        if (interrupted) markInterrupted(set, assistantMessage.id);
      }
      void touchChat(chatId);
      if (!interrupted) scheduleMemoryWork(chatId);
      const embConn2 = resolveConnection(chat.extractionConnectionId) ?? connection;
      void scheduleVoiceEmbedding(chatId, assistantMessage.id, finalText, embConn2);
    }
    set({ streaming: false, streamingText: "", streamingMessageId: null, streamingSpeakerId: null });
  };

  const retry = () => {
    void (async () => {
      const freshChat = await getChat(chatId);
      const freshConnection = freshChat ? resolveConnection(freshChat.connectionId) : null;
      if (!freshChat || !freshConnection) {
        set({ error: "no-connection", errorRetryable: false, retry: null });
        return;
      }
      const { apiMessages: retryApiMessages, report: retryReport, regexRules: _retryRegexRules, presetParams: retryPresetParams } = await buildTriggerMessages(
        freshChat,
        get().messages,
        get().memberCharacters,
      );
      const retryConn = applyPreset(freshConnection, retryPresetParams);
      set({ lastPromptReport: retryReport, streamingSpeakerId: speaker.id });
      startStream(retryConn, retryApiMessages, set, get, finalize, retry, refreshChatState);
    })();
  };

  startStream(effectiveConnection, apiMessages, set, get, finalize, retry, refreshChatState);
}

export async function regenerate(
  messageId: string,
  set: Setter,
  get: Getter,
  refreshChatState: (chatId: string) => Promise<void>,
): Promise<void> {
  const { chatId, messages, streaming, memberCharacters, gameOver } = get();
  if (!chatId || streaming || gameOver) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    set({ error: "offline", errorRetryable: true, retry: () => void get().regenerate(messageId) });
    return;
  }

  const chat = await getChat(chatId);
  if (!chat) return;
  const connection = resolveConnection(chat.connectionId);
  if (!connection) {
    set({ error: "no-connection", errorRetryable: false, retry: null });
    return;
  }

  const idx = messages.findIndex((m) => m.id === messageId);
  if (idx === -1) return;
  const target = messages[idx];
  // The message's own author (falling back to the primary member) speaks
  // again — regenerating never reassigns authorship (plan §5).
  const speaker = await resolveSpeaker(chat, memberCharacters, target.characterId);
  if (!speaker) return;

  const { messages: apiMessages, report, regexRules, presetParams } = await buildApiMessages(
    chat,
    messages.slice(0, idx),
    speaker,
    memberCharacters,
  );
  const effectiveConnection = applyPreset(connection, presetParams);
  set({ lastPromptReport: report, streamingMessageId: messageId, streamingSpeakerId: speaker.id });
  clearInterrupted(set, messageId);

  // Auto-retry guard, same reasoning as sendMessage's (M28c gap fix).
  let autoRetryCount = 0;

  const finalize = async (text: string, interrupted: boolean, changeSummary: string | null = null) => {
    let finalText = stripSpeakerPrefix(text.trim(), speaker.name).trim();
    finalText = applyRegexRules(finalText, regexRules ?? "");

    if (await checkPrePersistAndMaybeRetry(chatId, finalText, interrupted, autoRetryCount, MAX_AUTO_RETRIES, set, retry)) {
      autoRetryCount++;
      return;
    }

    if (finalText) {
      const updated = await appendSwipe(target, finalText, changeSummary);
      // Guard (M11 bug sweep) — see sendMessage's `finalize` for rationale;
      // `messages` here belongs to whatever chat is currently open, so
      // mapping over it after a chat switch would touch the wrong list.
      if (get().chatId === chatId) {
        set((s) => ({ messages: s.messages.map((m) => (m.id === messageId ? updated : m)) }));
        if (interrupted) markInterrupted(set, messageId);
      }
      void touchChat(chatId);
      if (!interrupted) scheduleMemoryWork(chatId);
      const embConn3 = resolveConnection(chat.extractionConnectionId) ?? connection;
      void scheduleVoiceEmbedding(chatId, messageId, finalText, embConn3);
    }
    set({ streaming: false, streamingText: "", streamingMessageId: null, streamingSpeakerId: null });
  };

  const retry = () => {
    set({ streamingMessageId: messageId, streamingSpeakerId: speaker.id });
    startStream(effectiveConnection, apiMessages, set, get, finalize, retry, refreshChatState);
  };

  startStream(effectiveConnection, apiMessages, set, get, finalize, retry, refreshChatState);
}

/** Resumes an interrupted assistant message: sends the history up to and
 * including its current (partial) content, asks the model to continue
 * exactly where it left off, and appends the result to the existing
 * swipe content (rather than creating a new variant) — the "continue"
 * half of the "continue/regenerate" pair required by plan §9. Authorship
 * never changes (plan §5). */
export async function continueMessage(
  messageId: string,
  set: Setter,
  get: Getter,
  refreshChatState: (chatId: string) => Promise<void>,
): Promise<void> {
  const { chatId, messages, streaming, memberCharacters, gameOver } = get();
  if (!chatId || streaming || gameOver) return;
  const chat = await getChat(chatId);
  if (!chat) return;
  const connection = resolveConnection(chat.connectionId);
  if (!connection) {
    set({ error: "no-connection", errorRetryable: false, retry: null });
    return;
  }

  const idx = messages.findIndex((m) => m.id === messageId);
  if (idx === -1) return;
  const target = messages[idx];
  const speaker = await resolveSpeaker(chat, memberCharacters, target.characterId);
  if (!speaker) return;
  const isGroup = memberCharacters.length > 1;

  const priorHistory = messages.slice(0, idx);
  const { messages: baseApiMessages, regexRules, presetParams } = await buildApiMessages(chat, priorHistory, speaker, memberCharacters);
  const effectiveConnection = applyPreset(connection, presetParams);
  const continueInstruction = isGroup
    ? CONTINUE_EXACT(speaker.name)
    : CONTINUE_EXACT_SOLO;
  const apiMessages: ChatMessage[] = [
    ...baseApiMessages,
    { role: "assistant", content: target.content },
    { role: "user", content: continueInstruction },
  ];

  set({ streamingMessageId: messageId, streamingText: "", streamingSpeakerId: speaker.id });

  // Auto-retry guard, same reasoning as sendMessage's (M28c gap fix).
  let autoRetryCount = 0;

  const finalize = async (text: string, interrupted: boolean, changeSummary: string | null = null) => {
    let addition = stripSpeakerPrefix(text.trim(), speaker.name).trim();
    addition = applyRegexRules(addition, regexRules ?? "");
    const combined = addition ? `${target.content}${/\s$/.test(target.content) ? "" : " "}${addition}` : target.content;

    if (await checkPrePersistAndMaybeRetry(chatId, combined, !addition || interrupted, autoRetryCount, MAX_AUTO_RETRIES, set, retry)) {
      autoRetryCount++;
      return;
    }

    // Guard (M11 bug sweep) — see sendMessage's `finalize` for rationale.
    const stillCurrentChat = get().chatId === chatId;
    if (addition) {
      // Continuing picks up wherever the original reply's tags left off —
      // merge rather than replace, so the footer still reflects the part
      // that was already there.
      const mergedSummary = serializeChangeSummary([
        ...parseChangeSummary(target.changeSummary),
        ...parseChangeSummary(changeSummary),
      ]);
      const updated = await updateMessageContent(target, combined, mergedSummary);
      if (stillCurrentChat) {
        set((s) => ({ messages: s.messages.map((m) => (m.id === messageId ? updated : m)) }));
      }
    }
    if (stillCurrentChat) {
      if (interrupted) {
        markInterrupted(set, messageId);
      } else {
        clearInterrupted(set, messageId);
      }
    }
    if (!interrupted) scheduleMemoryWork(chatId);
    void touchChat(chatId);
    const embConn4 = resolveConnection(chat.extractionConnectionId) ?? connection;
    void scheduleVoiceEmbedding(chatId, messageId, combined, embConn4);
    set({ streaming: false, streamingText: "", streamingMessageId: null, streamingSpeakerId: null });
  };

  const retry = () => {
    set({ streamingMessageId: messageId, streamingText: "", streamingSpeakerId: speaker.id });
    startStream(effectiveConnection, apiMessages, set, get, finalize, retry, refreshChatState);
  };

  startStream(effectiveConnection, apiMessages, set, get, finalize, retry, refreshChatState);
}
