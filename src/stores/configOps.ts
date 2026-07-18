import type { Character } from "../db/repositories/charactersRepo";
import {
  type Chat,
} from "../db/repositories/chatsRepo";
import { listActiveFacts } from "../db/repositories/ledgerRepo";
import { listActivatableEntriesForMembers } from "../db/repositories/lorebooksRepo";
import {
  type Message,
} from "../db/repositories/messagesRepo";
import { getDefaultPersona, getPersona, type Persona } from "../db/repositories/personasRepo";
import { getDefaultPreset, getPreset, type Preset } from "../db/repositories/presetsRepo";
import { getSetting } from "../db/repositories/settingsRepo";
import { getSummary } from "../db/repositories/summariesRepo";
import {
  mergeConsecutiveRoles,
} from "../chat/groupSpeaker";
import { loadTimedState, saveTimedState, selectActiveEntries, type LoreEntryLike } from "../lorebooks/activation";
import { buildDirectorNote, getDirectorSettings } from "../chat/director";
import { canEmbed, retrieveSemanticContext, type RetrievedMemoryDetail } from "../memory/embeddingsEngine";
import { findRelevantReplies } from "../prompt/replyExamples";
import { consumeDriftCorrections } from "../memory/driftDetector";
import { buildPrompt, DEFAULT_VERBATIM_WINDOW, type PromptReport } from "../prompt/promptBuilder";
import { calendarDescription } from "../memory/calendar";
import { estimateTokens } from "../prompt/tokenEstimate";
import { ensureCalendarInitialized } from "../memory/memoryEngine";
import type { ChatMessage, ConnectionConfig } from "../providers/types";
import { logUsage } from "../db/repositories/usageRepo";
import { useConnectionsStore } from "./connectionsStore";
import { useSettingsStore } from "./settingsStore";
import i18n from "../i18n";
import { useSamplerToastStore } from "../ui/useSamplerToast";
import { appendLog } from "../logging";
import type { Setter } from "./chatStoreTypes";

/** Fire-and-forget usage logging (M12 §3) — must never throw into a chat
 *  flow, hence the empty catch (an empty catch is deliberate here, not a
 *  logging gap: a usage_log write failure has nothing useful to report and
 *  an M11-style console.error would spam the console on every message). */
export function logChatUsage(connectionId: string | null, apiMessages: ChatMessage[], outputText: string) {
  const inputTokens = apiMessages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
  void logUsage("chat", connectionId, inputTokens, estimateTokens(outputText)).catch(() => {});
}

/** The chat's own persona if it has one selected, otherwise the app-wide
 *  default persona (if any) — same fallback as the plan describes for
 *  "persona per chat" (§7 M4). */
export async function resolveChatPersona(chat: Chat): Promise<Persona | null> {
  if (chat.personaId) {
    const persona = await getPersona(chat.personaId);
    if (persona) return persona;
  }
  return getDefaultPersona();
}

/** Builds the full API message array via PromptBuilder: `speaker` +
 *  persona + ledger facts + summary + activated lore (unioned across every
 *  roster member, plan §5) + a trimmed verbatim window of `history`, cut to
 *  the connection's `context_budget` (plan §6.2). In group chats (more than
 *  one loaded member), every assistant message in the verbatim window gets
 *  prefixed with its author's name, the *other* members are passed to
 *  PromptBuilder as `groupMembers`, and the rendered output is passed
 *  through `mergeConsecutiveRoles` so back-to-back assistant turns don't
 *  break providers with strict role alternation. Solo chats (one member)
 *  behave exactly as before. Returns the report alongside so the memory
 *  panel's "Prompt" tab can show exactly what the last request contained. */
export async function buildApiMessages(
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
    calendarDateDescription = calendarDescription(cal, useSettingsStore.getState().calendarMode);
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

export function resolveConnection(connectionId: string | null): ConnectionConfig | null {
  if (!connectionId) return null;
  return useConnectionsStore.getState().connections.find((c) => c.id === connectionId) ?? null;
}

export interface PresetParams {
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
export const UNSUPPORTED: Record<string, string[]> = {
  openai: ["top_k", "min_p"],
  gemini: ["frequency_penalty", "presence_penalty", "min_p"],
  claude: ["top_k", "min_p", "frequency_penalty", "presence_penalty"],
};

export const PARAM_LABEL: Record<string, string> = {
  top_k: "top_k",
  min_p: "min_p",
  frequency_penalty: "frequency_penalty",
  presence_penalty: "presence_penalty",
};

export function warnUnsupportedSamplerParams(provider: string, params?: PresetParams): void {
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
export function applyPreset(connection: ConnectionConfig, params?: PresetParams): ConnectionConfig {
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

// EXPERIMENTAL (function-calling prototype): caps how many `get_item_detail`
// round trips a single reply may spend, purely as a safety valve against a
// model that calls the tool repeatedly (e.g. once per referenced item) —
// after this many calls, the follow-up request no longer offers the tool at
// all, forcing the model to finish with whatever it already has. Loose
// enough not to bite normal single-lookup usage, tight enough to bound
// worst-case latency/cost for this prototype.
export const MAX_FUNCTION_CALL_ROUND_TRIPS = 3;

export function clearInterrupted(set: Setter, messageId: string) {
  set((s) => {
    if (!s.interruptedMessageIds.has(messageId)) return {};
    const next = new Set(s.interruptedMessageIds);
    next.delete(messageId);
    return { interruptedMessageIds: next };
  });
}

export function markInterrupted(set: Setter, messageId: string) {
  set((s) => {
    const next = new Set(s.interruptedMessageIds);
    next.add(messageId);
    return { interruptedMessageIds: next };
  });
}
