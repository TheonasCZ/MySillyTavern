import { create } from "zustand";

import { getCharacter, type Character } from "../db/repositories/charactersRepo";
import {
  addChatMember,
  listChatMembers,
  removeChatMember,
  type ChatMember,
} from "../db/repositories/chatMembersRepo";
import {
  getChat,
  setAutoReply,
  setPrimaryCharacter,
  touchChat,
  type Chat,
} from "../db/repositories/chatsRepo";
import { listActiveFacts } from "../db/repositories/ledgerRepo";
import { listActivatableEntriesForMembers } from "../db/repositories/lorebooksRepo";
import {
  appendSwipe,
  countMessages,
  createMessage,
  hasMoreMessages,
  listRecentMessages,
  loadOlderMessages as loadOlderMessagesFromRepo,
  MESSAGE_PAGE_SIZE,
  shiftActiveSwipe,
  updateMessageContent,
  type Message,
} from "../db/repositories/messagesRepo";
import { getDefaultPersona, getPersona, type Persona } from "../db/repositories/personasRepo";
import { getDefaultPreset, getPreset, type Preset } from "../db/repositories/presetsRepo";
import { getSetting, setSetting } from "../db/repositories/settingsRepo";
import { getSummary } from "../db/repositories/summariesRepo";
import {
  mergeConsecutiveRoles,
  pickNextSpeaker,
  stripSpeakerPrefix,
  type SpeakerCandidate,
} from "../chat/groupSpeaker";
import { loadTimedState, saveTimedState, selectActiveEntries, type LoreEntryLike } from "../lorebooks/activation";
import { buildDirectorNote, getDirectorSettings } from "../chat/director";
import { canEmbed, getEmbeddingSettings, retrieveSemanticContext, type RetrievedMemoryDetail } from "../memory/embeddingsEngine";
import { encodeVector } from "../memory/vector";
import { storeVoiceEmbedding } from "../db/repositories/embeddingsRepo";
import { embedTexts } from "../providers/embeddings";
import { findRelevantReplies } from "../prompt/replyExamples";
import { runCanonSeed } from "../memory/canonSeed";
import { consumeDriftCorrections } from "../memory/driftDetector";
import { scheduleMemoryWork, ensureCalendarInitialized } from "../memory/memoryEngine";
import { processGameResponse } from "../chat/inventoryProcessor";
import { setOnInventoryImageWritten } from "../memory/imageGenQueue";
import { applyRegexRules } from "../chat/regexTransform";
import { buildPrompt, DEFAULT_VERBATIM_WINDOW, type PromptReport } from "../prompt/promptBuilder";
import { CONTINUE_AS, CONTINUE_EXACT, CONTINUE_EXACT_SOLO, SUGGEST_PROMPT } from "../prompt/promptTexts";
import { calendarDescription } from "../memory/calendar";
import { estimateTokens } from "../prompt/tokenEstimate";
import { chatComplete } from "../providers/chatComplete";
import { chatStream, type ChatStreamHandle } from "../providers/chatStream";
import { lookupItemDetailForChat } from "../chat/toolCalling";
import type { ChatMessage, ConnectionConfig } from "../providers/types";
import { logUsage } from "../db/repositories/usageRepo";
import { useConnectionsStore } from "./connectionsStore";
import i18n from "../i18n";
import { useSamplerToastStore } from "../ui/useSamplerToast";
import { appendLog } from "../logging";

/** Fire-and-forget usage logging (M12 §3) — must never throw into a chat
 * flow, hence the empty catch (an empty catch is deliberate here, not a
 * logging gap: a usage_log write failure has nothing useful to report and
 * an M11-style console.error would spam the console on every message). */
function logChatUsage(connectionId: string | null, apiMessages: ChatMessage[], outputText: string) {
  const inputTokens = apiMessages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
  void logUsage("chat", connectionId, inputTokens, estimateTokens(outputText)).catch(() => {});
}

/** The chat's own persona if it has one selected, otherwise the app-wide
 * default persona (if any) — same fallback as the plan describes for
 * "persona per chat" (§7 M4). */
async function resolveChatPersona(chat: Chat): Promise<Persona | null> {
  if (chat.personaId) {
    const persona = await getPersona(chat.personaId);
    if (persona) return persona;
  }
  return getDefaultPersona();
}

/** Loads a chat's roster (`chat_members`) and the corresponding character
 * cards, in roster order — characters that failed to load (deleted card)
 * are skipped rather than breaking the whole load (plan §5). */
async function loadMembers(chatId: string): Promise<{ members: ChatMember[]; memberCharacters: Character[] }> {
  const members = await listChatMembers(chatId);
  const loaded = await Promise.all(members.map((m) => getCharacter(m.characterId)));
  const memberCharacters = loaded.filter((c): c is Character => !!c);
  return { members, memberCharacters };
}

/** Resolves a speaker id (may be null/stale/not-yet-a-member) to a full
 * `Character`, falling back to the chat's primary member, and — as a last
 * resort, e.g. a cold `memberCharacters` cache — to a direct DB lookup
 * (mirrors the pre-M10 "character couldn't load" degrade path). */
async function resolveSpeaker(
  chat: Chat,
  memberCharacters: Character[],
  speakerId: string | null,
): Promise<Character | null> {
  const wantedId = speakerId ?? chat.characterId;
  const found = memberCharacters.find((c) => c.id === wantedId)
    ?? memberCharacters.find((c) => c.id === chat.characterId);
  if (found) return found;
  return getCharacter(wantedId);
}

/** Builds `{id, name, position}` candidates for `pickNextSpeaker` from the
 * roster + loaded character cards (a member whose card failed to load gets
 * an empty name — it simply can't be mention-matched by name). */
function speakerCandidates(members: ChatMember[], memberCharacters: Character[]): SpeakerCandidate[] {
  const nameById = new Map(memberCharacters.map((c) => [c.id, c.name]));
  return members.map((m) => ({ id: m.characterId, name: nameById.get(m.characterId) ?? "", position: m.position }));
}

/** Chronological (oldest -> newest) authorship of assistant messages, with
 * legacy/solo rows (`characterId === null`) attributed to the chat's
 * primary member — the "recently spoken" signal for auto mode. */
function recentSpeakerIds(chat: Chat, history: Message[]): string[] {
  return history.filter((m) => m.role === "assistant").map((m) => m.characterId ?? chat.characterId);
}

/** Picks who replies next: explicit selection in manual mode, or
 * `pickNextSpeaker` (name mention / least-recently-spoken) in auto mode
 * (plan §5). Always falls back to the chat's primary member. */
function pickSpeakerId(
  chat: Chat,
  members: ChatMember[],
  memberCharacters: Character[],
  autoReply: boolean,
  selectedSpeakerId: string | null,
  lastUserText: string,
  history: Message[],
): string {
  if (!autoReply) return selectedSpeakerId ?? chat.characterId;
  const picked = pickNextSpeaker(
    speakerCandidates(members, memberCharacters),
    lastUserText,
    recentSpeakerIds(chat, history),
  );
  return picked ?? selectedSpeakerId ?? chat.characterId;
}

/** Builds the full API message array via PromptBuilder: `speaker` +
 * persona + ledger facts + summary + activated lore (unioned across every
 * roster member, plan §5) + a trimmed verbatim window of `history`, cut to
 * the connection's `context_budget` (plan §6.2). In group chats (more than
 * one loaded member), every assistant message in the verbatim window gets
 * prefixed with its author's name, the *other* members are passed to
 * PromptBuilder as `groupMembers`, and the rendered output is passed
 * through `mergeConsecutiveRoles` so back-to-back assistant turns don't
 * break providers with strict role alternation. Solo chats (one member)
 * behave exactly as before. Returns the report alongside so the memory
 * panel's "Prompt" tab can show exactly what the last request contained. */
async function buildApiMessages(
  chat: Chat,
  history: Message[],
  speaker: Character,
  memberCharacters: Character[],
): Promise<{ messages: ChatMessage[]; report: PromptReport | null; regexRules?: string; presetParams?: { temperature?: number; topP?: number; frequencyPenalty?: number; presencePenalty?: number; maxTokens?: number } }> {
  const isGroup = memberCharacters.length > 1;
  const resolvedPersona = await resolveChatPersona(chat);
  // The prompt must reflect the chat's live gameplay state, not the
  // persona's template — inventory/skills/xp/level/conditions are all
  // chat-scoped now.
  const persona = resolvedPersona
    ? {
        ...resolvedPersona,
        inventory: chat.inventory ?? [],
        skills: chat.skills ?? [],
        xp: chat.xp ?? 0,
        level: chat.level ?? 1,
        conditions: chat.conditions ?? [],
        modifications: chat.modifications ?? [],
      }
    : null;

  // Resolve the preset: chat's selected preset first, then the default preset
  let activePreset: Preset | null = null;
  try {
    if (chat.presetId) {
      activePreset = await getPreset(chat.presetId);
    }
    if (!activePreset) {
      activePreset = await getDefaultPreset();
    }
  } catch {
    // preset lookup failing should not block the prompt build
  }

  let loreEntries: LoreEntryLike[] = [];
  let activatableLore: LoreEntryLike[] = [];
  try {
    const memberIds = memberCharacters.length > 0 ? memberCharacters.map((c) => c.id) : [chat.characterId];
    const [activatable, scanDepthSetting, tokenBudgetSetting] = await Promise.all([
      listActivatableEntriesForMembers(memberIds, chat.id),
      getSetting("lore_scan_depth"),
      getSetting("lore_token_budget"),
    ]);
    activatableLore = activatable;
    const timedState = loadTimedState(chat.id);
    const activationResult = selectActiveEntries(
      activatable,
      history.map((m) => m.content),
      {
        scanDepth: scanDepthSetting ? Number(scanDepthSetting) : undefined,
        tokenBudget: tokenBudgetSetting ? Number(tokenBudgetSetting) : undefined,
      },
      timedState,
      history.length,
    );
    saveTimedState(chat.id, timedState);
    loreEntries = activationResult.entries;
  } catch (err) {
    console.warn("chatStore: lorebook activation failed for chat", chat.id, err);
  }

  let ledgerFacts: Awaited<ReturnType<typeof listActiveFacts>> = [];
  let summaryText: string | null = null;
  try {
    const [facts, summary] = await Promise.all([listActiveFacts(chat.id), getSummary(chat.id)]);
    ledgerFacts = facts;
    summaryText = summary?.text ?? null;
  } catch (err) {
    console.warn("chatStore: loading ledger/summary failed for chat", chat.id, err);
  }

  const connection = resolveConnection(chat.connectionId);
  const verbatimWindowSetting = await getSetting("verbatim_window").catch(() => null);
  const verbatimWindow = verbatimWindowSetting ? Number(verbatimWindowSetting) : DEFAULT_VERBATIM_WINDOW;

  // Calendar: ensure initialized and build the description for the prompt
  let calendarDateDescription: string | undefined;
  try {
    const cal = await ensureCalendarInitialized(chat.id);
    calendarDateDescription = calendarDescription(cal);
  } catch (err) {
    console.warn("chatStore: calendar loading failed for chat", chat.id, err);
  }

  // Semantic retrieval (M7/M8): one embedding call over the conversation
  // tail scores everything stored — facts get a relevance-aware trim order,
  // the top-K older scenes come back as `[RELEVANTNÍ VZPOMÍNKY]`, and lore
  // entries can activate semantically on top of keyword hits. Any failure
  // (offline, Claude connection, nothing embedded yet) silently degrades to
  // the non-semantic behavior.
  let factRelevance: Record<string, number> | undefined;
  let retrievedMemories: string[] = [];
  let retrievedMemoriesDetail: RetrievedMemoryDetail[] = [];
  let voiceExamples: string[] = [];
  let queryEmbedding: number[] | undefined;
  const embeddingConnection = resolveConnection(chat.extractionConnectionId) ?? connection;
  if (canEmbed(embeddingConnection)) {
    try {
      const selectedIds = new Set(loreEntries.map((e) => e.id));
      const context = await retrieveSemanticContext({
        chatId: chat.id,
        connection: embeddingConnection,
        queryTexts: history.slice(-3).map((m) => m.content),
        candidateLoreIds: activatableLore.filter((e) => !selectedIds.has(e.id)).map((e) => e.id),
      });
      factRelevance = context.factRelevance;
      retrievedMemories = context.memories;
      retrievedMemoriesDetail = context.memoriesDetail;
      queryEmbedding = context.queryEmbedding;
      if (context.loreEntryIds.length > 0) {
        const byId = new Map(activatableLore.map((e) => [e.id, e]));
        loreEntries = [
          ...loreEntries,
          ...context.loreEntryIds
            .map((id) => byId.get(id))
            .filter((e): e is LoreEntryLike => !!e),
        ];
      }
    } catch (err) {
      // Deliberately degrades to non-semantic behavior on any failure
      // (offline, no embeddings yet, embedding-incapable connection) — see
      // the comment above. Not warn-worthy on its own; useful when actively
      // debugging why "relevant memories" aren't showing up.
      console.debug("chatStore: semantic retrieval failed for chat", chat.id, err);
    }
  }

  // Voice-consistency examples: reuse the query embedding from semantic
  // retrieval to find historically similar replies from this character.
  // Respects the `voice_examples_enabled` setting toggle.
  if (queryEmbedding) {
    try {
      const enabled = await getSetting("voice_examples_enabled");
      if (enabled !== "0") {
        voiceExamples = await findRelevantReplies(chat.id, speaker.id, queryEmbedding);
      }
    } catch {
      // Degrades silently — voice examples are a bonus, never a blocker.
    }
  }

  // Group chats: prefix every assistant turn with its author's name so the
  // model (and, if it echoes back, `stripSpeakerPrefix`) can tell speakers
  // apart in the verbatim window (plan §M10 — mapping to `role: user` would
  // break alternation and the "don't speak for the player" instruction).
  const nameById = new Map(memberCharacters.map((c) => [c.id, c.name]));
  const primaryName = nameById.get(chat.characterId) ?? speaker.name;
  const mappedHistory: ChatMessage[] = history.map((m) => {
    if (isGroup && m.role === "assistant") {
      const authorName = (m.characterId && nameById.get(m.characterId)) || primaryName;
      return { role: m.role, content: `${authorName}: ${m.content}` };
    }
    return { role: m.role, content: m.content };
  });

  const groupMembers = isGroup
    ? memberCharacters
        .filter((c) => c.id !== speaker.id)
        .map((c) => ({ name: c.name, description: c.description }))
    : undefined;

  // M25.2/M25.3: silent drift corrections (consumes one TTL tick) and the
  // per-chat director note — both resolved in the background, never block.
  let driftCorrections: string[] = [];
  let directorNote: string | undefined;
  try {
    const [corrections, director] = await Promise.all([
      consumeDriftCorrections(chat.id),
      getDirectorSettings(chat.id),
    ]);
    driftCorrections = corrections;
    directorNote = buildDirectorNote(director) || undefined;
  } catch {
    // both are steering aids — a failure must never block the prompt build
  }

  const { messages, report } = buildPrompt({
    character: speaker,
    persona,
    ledgerFacts,
    summary: summaryText,
    loreEntries,
    history: mappedHistory,
    // Kept in sync with ConnectionForm's DEFAULT_DRAFT.contextBudget — this
    // only applies when a chat has no connection configured at all.
    contextBudget: connection?.contextBudget ?? 12000,
    verbatimWindow,
    factRelevance,
    retrievedMemories,
    retrievedMemoriesDetail,
    groupMembers,
    calendarDateDescription,
    presetExtraSystemPrompt: activePreset?.extraSystemPrompt || undefined,
    presetAuthorNote: activePreset?.authorNote || undefined,
    driftCorrections,
    directorNote,
    gameLanguage: chat.gameLanguage ?? "cs",
    voiceExamples: voiceExamples.length > 0 ? voiceExamples : undefined,
  });

  const presetParams = activePreset ? {
    temperature: activePreset.temperature ?? undefined,
    topP: activePreset.topP ?? undefined,
    topK: activePreset.topK ?? undefined,
    minP: activePreset.minP ?? undefined,
    frequencyPenalty: activePreset.frequencyPenalty ?? undefined,
    presencePenalty: activePreset.presencePenalty ?? undefined,
    maxTokens: activePreset.maxTokens ?? undefined,
  } : undefined;

  const regexRules = activePreset?.regexRules;

  return { messages: isGroup ? mergeConsecutiveRoles(messages) : messages, report, regexRules, presetParams };
}

type Setter = (
  partial:
    | Partial<ChatState>
    | ((state: ChatState) => Partial<ChatState>),
) => void;
type Getter = () => ChatState;

// EXPERIMENTAL (function-calling prototype): caps how many `get_item_detail`
// round trips a single reply may spend, purely as a safety valve against a
// model that calls the tool repeatedly (e.g. once per referenced item) —
// after this many calls, the follow-up request no longer offers the tool at
// all, forcing the model to finish with whatever it already has. Loose
// enough not to bite normal single-lookup usage, tight enough to bound
// worst-case latency/cost for this prototype.
const MAX_FUNCTION_CALL_ROUND_TRIPS = 3;

function startStream(
  connection: ConnectionConfig,
  apiMessages: ChatMessage[],
  set: Setter,
  get: Getter,
  finalize: (content: string, interrupted: boolean) => Promise<void>,
  retry: () => void,
  // EXPERIMENTAL: number of `get_item_detail` round trips already spent on
  // this reply — see `MAX_FUNCTION_CALL_ROUND_TRIPS`.
  functionCallDepth = 0,
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
        set({ handle: null, pendingFinalize: null });
        logChatUsage(connection.id, apiMessages, text);
        // Process inventory tags — resolve persona and clean text
        const chat = get().chat;
        void (async () => {
          const persona = chat ? await resolveChatPersona(chat) : null;
          const finalText = await processGameResponse(persona, text, chat?.id);
          // processGameResponse may have mutated the chat's inventory/skills/
          // conditions/xp/level in the DB directly (bypassing this store) —
          // refresh so InventoryPanel and any other live-state UI re-render
          // instead of showing a stale snapshot.
          if (chat?.id) void refreshChatState(chat.id);
          void finalize(finalText, false);
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
        logChatUsage(connection.id, apiMessages, text);
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
          startStream(connection, nextMessages, set, get, finalize, retry, functionCallDepth + 1);
        })();
      },
    },
    offerTools,
  );

  set({ handle });
}

interface ChatState {
  chatId: string | null;
  /** The chat row itself, loaded by `openChat` — components used to load
   * this on their own; the store now owns it so speaker resolution has
   * fresh-enough data without a round trip per action (plan §5). */
  chat: Chat | null;
  /** Roster (`chat_members`), ordered by position — the source of truth
   * for who's in the chat. */
  members: ChatMember[];
  /** Character cards for `members`, in the same order; entries whose card
   * failed to load are skipped. */
  memberCharacters: Character[];
  /** Manually-picked speaker for the next `sendMessage`/used by
   * `suggestReplies` — ignored while `autoReply` is on. */
  selectedSpeakerId: string | null;
  /** Automatic speaker selection (mirrors `chat.autoReply`, kept in sync by
   * `setAutoReplyMode`). */
  autoReply: boolean;
  /** Which member is currently streaming a reply — drives the streaming
   * bubble's avatar/name in group chats. Set at the start of every stream,
   * cleared once `finalize` has persisted the message. */
  streamingSpeakerId: string | null;
  messages: Message[];
  loading: boolean;
  streaming: boolean;
  /** Set while regenerating an existing assistant message; null while
   * streaming a brand new message. */
  streamingMessageId: string | null;
  streamingText: string;
  error: string | null;
  /** Whether `error` came from a retryable failure (429/5xx from the
   * provider, or the app being offline) — drives the "Try again" button in
   * the chat error banner (plan §9). */
  errorRetryable: boolean;
  /** Re-runs whatever request just failed, when `errorRetryable` is true. */
  retry: (() => void) | null;
  handle: ChatStreamHandle | null;
  pendingFinalize: ((content: string) => Promise<void>) | null;
  /** Ids of assistant messages whose stored content is a partial response
   * (stream was aborted or errored mid-way) — surfaces a "continue" action
   * in the UI instead of silently presenting a truncated reply as final
   * (plan §9). Cleared once the message is edited, regenerated, or
   * continued. Session-only (not persisted), since it only matters for the
   * chat currently open. */
  interruptedMessageIds: Set<string>;
  /** Report from the last PromptBuilder call for this chat — what exactly
   * went to the model, token counts, what got trimmed. Shown in the memory
   * panel's "Prompt" tab (plan §7 M5). Null until a message has been sent
   * (or if the character couldn't be loaded). */
  lastPromptReport: PromptReport | null;
  /** Whether there are older messages in the DB beyond what's currently
   * loaded — drives MessageList's "load older" affordance for long chats
   * (plan §9: paginate, load last 100, scroll-up fetches more). */
  hasOlderMessages: boolean;
  loadingOlderMessages: boolean;
  /** On-demand reply suggestions ("what could {{user}} do next") — filled by
   * `suggestReplies`, cleared when a message is sent or the chat changes.
   * Opt-in per press so it never burns tokens unasked (plan follow-up). */
  suggestions: string[] | null;
  suggesting: boolean;

  openChat: (chatId: string) => Promise<void>;
  closeChat: () => Promise<void>;
  loadOlderMessages: () => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  /** Group chats: makes `speakerId` reply without a new player message —
   * "reply now" (plan §5/§7). */
  triggerSpeaker: (speakerId: string) => Promise<void>;
  regenerate: (messageId: string) => Promise<void>;
  continueMessage: (messageId: string) => Promise<void>;
  editMessage: (messageId: string, content: string) => Promise<void>;
  switchSwipe: (messageId: string, offset: number) => Promise<void>;
  stop: () => Promise<void>;
  dismissError: () => void;
  suggestReplies: () => Promise<void>;
  clearSuggestions: () => void;
  /** Adds a character to the roster (converts a solo chat into a group the
   * first time it's called) and reloads `members`/`memberCharacters`. */
  addMember: (characterId: string) => Promise<void>;
  /** Removes a member; refuses (returns `false`) to empty the roster. When
   * removing the current primary member, promotes the next member first so
   * the chat always has a valid `chats.character_id`. */
  removeMember: (characterId: string) => Promise<boolean>;
  setAutoReplyMode: (on: boolean) => Promise<void>;
  setSelectedSpeaker: (id: string) => void;
}

function resolveConnection(connectionId: string | null): ConnectionConfig | null {
  if (!connectionId) return null;
  return useConnectionsStore.getState().connections.find((c) => c.id === connectionId) ?? null;
}

/** Fire-and-forget: embeds the assistant message text and stores it as a
 * voice example for future style-consistency lookups. Skips when embeddings
 * are disabled, the provider doesn't support them, or the voice-examples
 * feature is toggled off. Stores only every 3rd assistant message (tracked
 * via the `voice_example_counter_<chatId>` setting). */
async function scheduleVoiceEmbedding(
  chatId: string,
  messageId: string,
  text: string,
  connection: ConnectionConfig | null,
): Promise<void> {
  if (!connection || !canEmbed(connection)) return;
  // Respect the feature toggle.
  try {
    const enabled = await getSetting("voice_examples_enabled");
    if (enabled === "0") return;
  } catch {
    return;
  }
  // Only embed every 3rd assistant message.
  const counterKey = `voice_example_counter_${chatId}`;
  try {
    const raw = await getSetting(counterKey);
    let counter = Number(raw) || 0;
    counter++;
    if (counter < 3) {
      await setSetting(counterKey, String(counter));
      return;
    }
    // Reset counter and proceed.
    await setSetting(counterKey, "0");
  } catch {
    return;
  }
  // Compute and store the embedding.
  try {
    const settings = await getEmbeddingSettings();
    const { model: usedModel, vectors } = await embedTexts(connection, [text], settings.model);
    const vec = Float32Array.from(vectors[0]);
    await storeVoiceEmbedding(chatId, messageId, text, usedModel, vec.length, encodeVector(vec));
  } catch {
    // Silently degrade — a failed voice embedding must never break the chat.
  }
}

interface PresetParams {
  temperature?: number;
  topP?: number;
  topK?: number;
  minP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  maxTokens?: number;
}

// M26: track which sampler-param warnings have already been shown so the
// toast + app.log line fires only once per (provider × param) per session.
const warnedParams = new Set<string>();

/** Provider support matrix for extra sampler params (M26).
 *  Ollama (OpenAI-compatible) is treated as supporting everything. */
const UNSUPPORTED: Record<string, string[]> = {
  openai: ["top_k", "min_p"],
  gemini: ["frequency_penalty", "presence_penalty", "min_p"],
  claude: ["top_k", "min_p", "frequency_penalty", "presence_penalty"],
};

const PARAM_LABEL: Record<string, string> = {
  top_k: "top_k",
  min_p: "min_p",
  frequency_penalty: "frequency_penalty",
  presence_penalty: "presence_penalty",
};

function warnUnsupportedSamplerParams(provider: string, params?: PresetParams): void {
  if (!params) return;
  const blocked = UNSUPPORTED[provider] ?? [];
  if (blocked.length === 0) return;
  for (const key of blocked) {
    const value = (params as Record<string, unknown>)[key];
    if (value === undefined) continue;
    const dedupeKey = `${provider}:${key}`;
    if (warnedParams.has(dedupeKey)) continue;
    warnedParams.add(dedupeKey);
    const providerLabel = provider === "openai" ? "OpenAI" : provider === "gemini" ? "Gemini" : provider === "claude" ? "Claude" : provider;
    const paramLabel = PARAM_LABEL[key] ?? key;
    const msg = i18n.t("samplers.unsupported", { ns: "settings", provider: providerLabel, param: paramLabel });
    useSamplerToastStore.getState().show(msg);
    appendLog(`${new Date().toISOString()} [warn] ${msg}`);
  }
}

/** Returns a new ConnectionConfig with preset params overridden where present. */
function applyPreset(connection: ConnectionConfig, params?: PresetParams): ConnectionConfig {
  if (!params) return connection;
  const overridden = { ...connection };
  if (params.temperature !== undefined) overridden.temperature = params.temperature;
  if (params.topP !== undefined) overridden.topP = params.topP;
  if (params.topK !== undefined) overridden.topK = params.topK;
  if (params.minP !== undefined) overridden.minP = params.minP;
  if (params.frequencyPenalty !== undefined) overridden.frequencyPenalty = params.frequencyPenalty;
  if (params.presencePenalty !== undefined) overridden.presencePenalty = params.presencePenalty;
  warnUnsupportedSamplerParams(overridden.provider, params);
  if (params.maxTokens != null) overridden.maxTokens = params.maxTokens;
  return overridden;
}

function clearInterrupted(set: Setter, messageId: string) {
  set((s) => {
    if (!s.interruptedMessageIds.has(messageId)) return {};
    const next = new Set(s.interruptedMessageIds);
    next.delete(messageId);
    return { interruptedMessageIds: next };
  });
}

function markInterrupted(set: Setter, messageId: string) {
  set((s) => {
    const next = new Set(s.interruptedMessageIds);
    next.add(messageId);
    return { interruptedMessageIds: next };
  });
}

export const useChatStore = create<ChatState>((set, get) => ({
  chatId: null,
  chat: null,
  members: [],
  memberCharacters: [],
  selectedSpeakerId: null,
  autoReply: false,
  streamingSpeakerId: null,
  messages: [],
  loading: false,
  streaming: false,
  streamingMessageId: null,
  streamingText: "",
  error: null,
  errorRetryable: false,
  retry: null,
  handle: null,
  pendingFinalize: null,
  interruptedMessageIds: new Set(),
  lastPromptReport: null,
  hasOlderMessages: false,
  loadingOlderMessages: false,
  suggestions: null,
  suggesting: false,

  openChat: async (chatId) => {
    if (get().streaming) {
      await get().stop();
    }
    set({
      chatId,
      chat: null,
      members: [],
      memberCharacters: [],
      selectedSpeakerId: null,
      autoReply: false,
      streamingSpeakerId: null,
      loading: true,
      messages: [],
      error: null,
      errorRetryable: false,
      retry: null,
      interruptedMessageIds: new Set(),
      lastPromptReport: null,
      hasOlderMessages: false,
      loadingOlderMessages: false,
      suggestions: null,
      suggesting: false,
    });
    const [messages, total, chat, { members, memberCharacters }] = await Promise.all([
      listRecentMessages(chatId, MESSAGE_PAGE_SIZE),
      countMessages(chatId),
      getChat(chatId),
      loadMembers(chatId),
    ]);
    // Ignore the result if the user has already navigated to a different
    // chat while this query was in flight.
    if (get().chatId !== chatId) return;
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    const lastAssistantIsMember =
      !!lastAssistant?.characterId && members.some((m) => m.characterId === lastAssistant.characterId);
    const selectedSpeakerId =
      lastAssistant && lastAssistantIsMember ? lastAssistant.characterId : (chat?.characterId ?? null);
    set({
      messages,
      loading: false,
      hasOlderMessages: total > messages.length,
      chat,
      members,
      memberCharacters,
      autoReply: chat?.autoReply ?? false,
      selectedSpeakerId,
    });

    // Canon seeding (M25.5) — first open of a fresh chat distills 3–5 story
    // rules from the card into soft canon. Fire-and-forget; one-shot via a
    // settings marker inside runCanonSeed.
    if (chat) {
      const primary = memberCharacters.find((c) => c.id === chat.characterId) ?? memberCharacters[0];
      const seedConnection =
        resolveConnection(chat.extractionConnectionId) ?? resolveConnection(chat.connectionId);
      if (primary && seedConnection) {
        void runCanonSeed(chat.id, seedConnection, primary, chat.gameLanguage);
      }
    }
  },

  closeChat: async () => {
    const closingChatId = get().chatId;
    if (get().streaming) {
      await get().stop();
    }
    // Guard (M11 bug sweep): `stop()` awaits abort + finalize, during which
    // ChatScreen's mount effect for a *new* chat may already have called
    // `openChat` (its unmount cleanup and the next mount's effect run back
    // to back, not sequentially awaited). If that happened, `chatId` here
    // no longer belongs to us — clearing the store now would wipe out the
    // chat that's already open instead of the one we're actually closing.
    if (get().chatId !== closingChatId) return;
    set({
      chatId: null,
      chat: null,
      members: [],
      memberCharacters: [],
      selectedSpeakerId: null,
      autoReply: false,
      streamingSpeakerId: null,
      messages: [],
      loading: false,
      error: null,
      errorRetryable: false,
      retry: null,
      lastPromptReport: null,
      hasOlderMessages: false,
      loadingOlderMessages: false,
    });
  },

  loadOlderMessages: async () => {
    const { chatId, messages, hasOlderMessages, loadingOlderMessages } = get();
    if (!chatId || !hasOlderMessages || loadingOlderMessages || messages.length === 0) return;
    set({ loadingOlderMessages: true });
    try {
      const oldest = messages[0];
      const older = await loadOlderMessagesFromRepo(chatId, oldest.id, MESSAGE_PAGE_SIZE);
      if (get().chatId !== chatId) return;
      // Check whether even older messages remain after this page.
      const more = older.length > 0 ? await hasMoreMessages(chatId, older[0].id) : false;
      if (get().chatId !== chatId) return;
      set((s) => ({
        messages: [...older, ...s.messages],
        hasOlderMessages: more,
      }));
    } finally {
      set({ loadingOlderMessages: false });
    }
  },

  sendMessage: async (content) => {
    const trimmed = content.trim();
    const { chatId, messages, streaming, members, memberCharacters, autoReply, selectedSpeakerId } = get();
    if (!chatId || !trimmed || streaming) return;
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

    const finalize = async (text: string, interrupted: boolean) => {
      let finalText = stripSpeakerPrefix(text.trim(), speaker.name).trim();
      finalText = applyRegexRules(finalText, regexRules ?? "");
      if (finalText) {
        const assistantMessage = await createMessage(chatId, "assistant", finalText, speaker.id);
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
        startStream(retryConn, retryApiMessages, set, get, finalize, retry);
      })();
    };

    startStream(effectiveConnection, apiMessages, set, get, finalize, retry);
  },

  /** "Reply now" for a group chat — the picked member reacts without a new
   * player message. Reuses `buildApiMessages` for the current history, then
   * appends a nudge asking that member specifically to continue the scene
   * (plan §5). */
  triggerSpeaker: async (speakerId) => {
    const { chatId, messages, streaming, memberCharacters } = get();
    if (!chatId || streaming) return;
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

    const finalize = async (text: string, interrupted: boolean) => {
      let finalText = stripSpeakerPrefix(text.trim(), speaker.name).trim();
      finalText = applyRegexRules(finalText, regexRules ?? "");
      if (finalText) {
        const assistantMessage = await createMessage(chatId, "assistant", finalText, speaker.id);
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
        startStream(retryConn, retryApiMessages, set, get, finalize, retry);
      })();
    };

    startStream(effectiveConnection, apiMessages, set, get, finalize, retry);
  },

  regenerate: async (messageId) => {
    const { chatId, messages, streaming, memberCharacters } = get();
    if (!chatId || streaming) return;
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

    const finalize = async (text: string, interrupted: boolean) => {
      let finalText = stripSpeakerPrefix(text.trim(), speaker.name).trim();
      finalText = applyRegexRules(finalText, regexRules ?? "");
      if (finalText) {
        const updated = await appendSwipe(target, finalText);
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
      startStream(effectiveConnection, apiMessages, set, get, finalize, retry);
    };

    startStream(effectiveConnection, apiMessages, set, get, finalize, retry);
  },

  /** Resumes an interrupted assistant message: sends the history up to and
   * including its current (partial) content, asks the model to continue
   * exactly where it left off, and appends the result to the existing
   * swipe content (rather than creating a new variant) — the "continue"
   * half of the "continue/regenerate" pair required by plan §9. Authorship
   * never changes (plan §5). */
  continueMessage: async (messageId) => {
    const { chatId, messages, streaming, memberCharacters } = get();
    if (!chatId || streaming) return;
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

    const finalize = async (text: string, interrupted: boolean) => {
      let addition = stripSpeakerPrefix(text.trim(), speaker.name).trim();
      addition = applyRegexRules(addition, regexRules ?? "");
      const combined = addition ? `${target.content}${/\s$/.test(target.content) ? "" : " "}${addition}` : target.content;
      // Guard (M11 bug sweep) — see sendMessage's `finalize` for rationale.
      const stillCurrentChat = get().chatId === chatId;
      if (addition) {
        const updated = await updateMessageContent(target, combined);
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
      startStream(effectiveConnection, apiMessages, set, get, finalize, retry);
    };

    startStream(effectiveConnection, apiMessages, set, get, finalize, retry);
  },

  editMessage: async (messageId, content) => {
    const { messages } = get();
    const msg = messages.find((m) => m.id === messageId);
    if (!msg) return;
    const updated = await updateMessageContent(msg, content);
    set((s) => ({ messages: s.messages.map((m) => (m.id === messageId ? updated : m)) }));
    clearInterrupted(set, messageId);
  },

  switchSwipe: async (messageId, offset) => {
    const { messages } = get();
    const msg = messages.find((m) => m.id === messageId);
    if (!msg) return;
    const updated = await shiftActiveSwipe(msg, offset);
    set((s) => ({ messages: s.messages.map((m) => (m.id === messageId ? updated : m)) }));
    clearInterrupted(set, messageId);
  },

  stop: async () => {
    const { handle, pendingFinalize, streamingText } = get();
    if (!handle) return;
    // Clear immediately — not after `abort()` resolves — so a concurrent
    // `stop()` call (e.g. ChatScreen's unmount cleanup racing the next
    // chat's mount effect, both of which check `streaming` and call `stop`)
    // sees `handle: null` and no-ops instead of double-aborting the same
    // handle or running `pendingFinalize` twice (M11 bug sweep).
    set({ handle: null, pendingFinalize: null });
    await handle.abort();
    // No further channel events arrive after an abort, so finalize here —
    // it persists whatever partial text streamed in and clears `streaming`
    // once that's done (keeping the bubble visible until then). An abort
    // always counts as "interrupted" so the UI offers continue/regenerate.
    if (pendingFinalize) {
      await pendingFinalize(streamingText);
    } else {
      set({ streaming: false, streamingText: "", streamingMessageId: null, streamingSpeakerId: null });
    }
  },

  dismissError: () => set({ error: null, errorRetryable: false, retry: null }),

  /** Asks the model for 3 short ways the user could react next. Built on
   * the exact same PromptBuilder context as a normal send (ledger facts,
   * summary, lore), so suggestions know everything the character does —
   * but only runs on explicit request, so it costs tokens only when used.
   * Uses the currently selected speaker (or the primary member) purely to
   * pick whose "voice"/context frames the suggestions — the suggestions
   * themselves are always written for the player. */
  suggestReplies: async () => {
    const { chatId, messages, streaming, suggesting, memberCharacters, selectedSpeakerId } = get();
    if (!chatId || streaming || suggesting || messages.length === 0) return;

    const chat = await getChat(chatId);
    if (!chat) return;
    // Guard (M11 bug sweep): `getChat` above already yielded once — bail
    // out if the user has since switched chats, rather than flipping
    // `suggesting` on for whatever chat is now open.
    if (get().chatId !== chatId) return;
    const connection = resolveConnection(chat.connectionId);
    if (!connection) {
      set({ error: "no-connection", errorRetryable: false, retry: null });
      return;
    }

    set({ suggesting: true, suggestions: null });
    try {
      const speaker = await resolveSpeaker(chat, memberCharacters, selectedSpeakerId);
      if (!speaker) return;
      const { messages: baseApiMessages, presetParams } = await buildApiMessages(chat, messages, speaker, memberCharacters);
      const effectiveConnection = applyPreset(connection, presetParams);
      const apiMessages: ChatMessage[] = [
        ...baseApiMessages,
        {
          role: "user",
          content: SUGGEST_PROMPT(chat.gameLanguage ?? "cs"),
        },
      ];
      const reply = await chatComplete(effectiveConnection, apiMessages);
      const inputTokens = apiMessages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
      void logUsage("suggest", connection.id, inputTokens, estimateTokens(reply)).catch(() => {});
      const suggestions = parseSuggestions(reply);
      // Guard (M11 bug sweep): this is a long-running network call — if the
      // user switched to a different chat while it was in flight, don't
      // drop these suggestions (or the `suggesting`/error state below) onto
      // whatever chat is now open.
      if (get().chatId === chatId) set({ suggestions });
    } catch (err) {
      if (get().chatId === chatId) set({ error: String(err), errorRetryable: false, retry: null });
    } finally {
      if (get().chatId === chatId) set({ suggesting: false });
    }
  },

  clearSuggestions: () => set({ suggestions: null }),

  addMember: async (characterId) => {
    const { chatId } = get();
    if (!chatId) return;
    await addChatMember(chatId, characterId);
    const { members, memberCharacters } = await loadMembers(chatId);
    set({ members, memberCharacters });
  },

  removeMember: async (characterId) => {
    const { chatId, chat, members } = get();
    if (!chatId || !chat || members.length <= 1) return false;

    let primaryId = chat.characterId;
    if (primaryId === characterId) {
      const next = members.find((m) => m.characterId !== characterId);
      if (!next) return false;
      await setPrimaryCharacter(chatId, next.characterId);
      primaryId = next.characterId;
    }

    await removeChatMember(chatId, characterId);
    const { members: nextMembers, memberCharacters } = await loadMembers(chatId);
    set((s) => ({
      chat: { ...chat, characterId: primaryId },
      members: nextMembers,
      memberCharacters,
      selectedSpeakerId: s.selectedSpeakerId === characterId ? primaryId : s.selectedSpeakerId,
    }));
    return true;
  },

  setAutoReplyMode: async (on) => {
    const { chatId, chat } = get();
    if (!chatId) return;
    await setAutoReply(chatId, on);
    set({ autoReply: on, chat: chat ? { ...chat, autoReply: on } : chat });
  },

  setSelectedSpeaker: (id) => set({ selectedSpeakerId: id }),
}));

/** Re-fetches the whole chat row and updates the in-memory store so
 *  components reading `chat.inventory`/`chat.skills`/`chat.conditions`/
 *  `chat.xp`/`chat.level` (e.g. InventoryPanel) re-render with fresh data
 *  after a DB write that bypassed the store (game-tag processing, or an
 *  async illustration write landing later). Since this re-fetches the full
 *  row via `getChat`, it covers every chat-scoped live-gameplay field at
 *  once — no need for a field-specific refresh. Guards against a stale
 *  refresh landing after the user has switched to a different chat. */
async function refreshChatState(chatId: string): Promise<void> {
  if (useChatStore.getState().chatId !== chatId) return;
  const freshChat = await getChat(chatId);
  if (freshChat && useChatStore.getState().chatId === chatId) {
    useChatStore.setState({ chat: freshChat });
  }
}

// Wired here (a runtime registration) rather than a static import of
// useChatStore inside imageGenQueue.ts, to avoid a circular import:
// chatStore already depends on imageGenQueue transitively via memoryEngine.
setOnInventoryImageWritten(refreshChatState);

/** Extracts up to 3 suggestion strings from the model's reply. Prefers the
 * requested JSON array (tolerating markdown fences / surrounding prose);
 * falls back to numbered or bulleted lines when the model ignores the
 * format, so the button still works with weaker models. */
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
