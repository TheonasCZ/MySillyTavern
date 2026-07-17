/** Memory engine orchestration (plan §6.3): decides *when* to run an
 * extraction/summarization pass and makes sure at most one job runs per
 * chat at a time. The actual LLM work lives in `extractor.ts` /
 * `summarizer.ts`; both already swallow their own errors, so a failure
 * here never surfaces to the chat UI — it's logged and simply retried the
 * next time `scheduleMemoryWork` is called (next assistant message). */

import { getConnection } from "../db/repositories/connectionsRepo";
import {
  getChat,
  setLastExtractedMessageId,
  setLastSummarizedMessageId,
} from "../db/repositories/chatsRepo";
import { listChatMembers } from "../db/repositories/chatMembersRepo";
import { getCharacter } from "../db/repositories/charactersRepo";
import { listMessages, type Message } from "../db/repositories/messagesRepo";
import { getSetting, setSetting } from "../db/repositories/settingsRepo";
import type { ConnectionConfig } from "../providers/types";
import { DEFAULT_VERBATIM_WINDOW } from "../prompt/promptBuilder";
import { listActivatableEntriesForMembers } from "../db/repositories/lorebooksRepo";
import {
  syncFactEmbeddings,
  syncLoreEmbeddings,
  syncMessageChunkEmbeddings,
} from "./embeddingsEngine";
import { runDriftCheck } from "./driftDetector";
import { runExtraction, type TranscriptChatMessage } from "./extractor";
import { listAllFacts } from "../db/repositories/ledgerRepo";
import { runSummarization, type TranscriptMessage } from "./summarizer";
import {
  advanceTime,
  defaultGameTimeState,
  type GameTimeState,
} from "./gameTime";
import {
  advanceDay,
  calendarToJSON,
  calendarFromJSON,
  defaultCalendarDate,
  type CalendarDate,
} from "./calendar";

// Side-effect import: loads the auto-illustration background queue so it is
// ready to accept items as soon as facts are locked or inventory is updated.
import "./imageGenQueue";

export const DEFAULT_EXTRACTION_INTERVAL = 10;
/** How many messages must have scrolled past the verbatim window,
 * unsummarized, before a summarization pass is queued. Fixed per plan
 * §6.3 (only the extraction interval and verbatim window are settings). */
export const SUMMARIZE_TRIGGER_THRESHOLD = 10;

// ---- Adaptive extraction interval (A5) ---------------------------------

/** Minimum number of messages before an early extraction can fire. */
export const MIN_EXTRACTION_MESSAGES = 5;
/** Info-density threshold above which we extract early. */
export const HIGH_DENSITY_THRESHOLD = 0.6;

const PROPER_NOUN_RE = /\b[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ][a-záčďéěíňóřšťúůýž]+\b/g;
const BASELINE_MESSAGE_LENGTH = 100;

/**
 * Pure heuristic: estimate how "information-dense" a batch of messages is.
 * Returns a number 0–1 where higher means more substantial content.
 *
 * Three signals, each normalised to 0–1:
 * 1. Named-entity density — capitalised words that appear ≥ 2× or are *not*
 *    the first token of a message (excludes sentence‑start false positives).
 * 2. Lexical diversity — unique‑word ratio (`unique / total`).
 * 3. Average message length relative to a 100‑char baseline.
 *
 * The final score is the unweighted average of the three.
 */
export function computeInfoDensity(messages: Message[]): number {
  if (messages.length === 0) return 0;

  let totalWords = 0;
  const wordFreq = new Map<string, number>();
  let neCount = 0;

  // First pass: count word frequencies
  for (const m of messages) {
    const content = m.content.trim();
    if (content.length === 0) continue;
    const words = content.split(/\s+/);
    for (const w of words) {
      totalWords++;
      const lower = w.toLowerCase();
      wordFreq.set(lower, (wordFreq.get(lower) ?? 0) + 1);
    }
  }

  if (totalWords === 0) return 0;

  // Second pass: count named entities
  // Capitalised word is counted as a NE if it appears ≥ 2× OR is not the
  // first token of its message (excludes sentence‑start false positives).
  for (const m of messages) {
    const content = m.content.trim();
    if (content.length === 0) continue;
    const words = content.split(/\s+/);
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (!PROPER_NOUN_RE.test(w)) continue;
      const freq = wordFreq.get(w.toLowerCase()) ?? 0;
      if (freq >= 2 || i > 0) {
        neCount++;
      }
    }
  }

  // 1. NE density: cap at 0.3 NE/word → score 1.0
  const neScore = Math.min(neCount / totalWords / 0.3, 1);

  // 2. Lexical diversity: unique / total
  const uniqueWords = wordFreq.size;
  const lexScore = uniqueWords / totalWords;

  // 3. Average message length
  const avgLen = messages.reduce((sum, m) => sum + m.content.length, 0) / messages.length;
  const lenScore = Math.min(avgLen / BASELINE_MESSAGE_LENGTH, 1);

  return (neScore + lexScore + lenScore) / 3;
}

interface QueueEntry {
  running: boolean;
  pendingRerun: boolean;
}

const queues = new Map<string, QueueEntry>();

/** Maps messages to transcript entries for the extractor, stamping
 * `speakerName` from `Message.characterId` via a chatId->name lookup built
 * once per pass (plan §M10) — solo chats get an empty map and every message
 * falls back to the "AI"/"Hráč" label as before. */
function toApiMessages(messages: Message[], memberNames: Map<string, string>): TranscriptChatMessage[] {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role,
      content: m.content,
      speakerName: m.characterId ? (memberNames.get(m.characterId) ?? null) : null,
    }));
}

/** Same speaker-name stamping for the summarizer's `Message[]`-shaped
 * input. */
function withSpeakerNames(messages: Message[], memberNames: Map<string, string>): TranscriptMessage[] {
  return messages.map((m) => ({
    ...m,
    speakerName: m.characterId ? (memberNames.get(m.characterId) ?? null) : null,
  }));
}

async function readNumberSetting(key: string, fallback: number): Promise<number> {
  const raw = await getSetting(key);
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function resolveExtractionConnection(
  extractionConnectionId: string | null,
  connectionId: string | null,
): Promise<ConnectionConfig | null> {
  const id = extractionConnectionId ?? connectionId;
  if (!id) return null;
  return getConnection(id);
}

/** One pass of "check both triggers and run whatever's due". Re-reads
 * fresh state from the DB every time it's invoked, so it's naturally
 * idempotent — running it twice in a row when nothing changed is a no-op
 * the second time. */
async function runDueWork(chatId: string): Promise<void> {
  const chat = await getChat(chatId);
  if (!chat) return;
  const messages = await listMessages(chatId);
  if (messages.length === 0) return;

  const [extractionInterval, verbatimWindow, members] = await Promise.all([
    readNumberSetting("extraction_interval", DEFAULT_EXTRACTION_INTERVAL),
    readNumberSetting("verbatim_window", DEFAULT_VERBATIM_WINDOW),
    listChatMembers(chatId),
  ]);
  const memberCharacterIds = members.map((m) => m.characterId);
  // Built once per pass (not per message) — used to stamp speaker names on
  // the extraction/summarization transcripts (plan §M10).
  const memberNames = new Map<string, string>();
  await Promise.all(
    members.map(async (m) => {
      const character = await getCharacter(m.characterId);
      if (character) memberNames.set(m.characterId, character.name);
    }),
  );

  // --- Extraction: messages since last_extracted_message_id ---
  const lastExtractedIdx = chat.lastExtractedMessageId
    ? messages.findIndex((m) => m.id === chat.lastExtractedMessageId)
    : -1;
  const newSinceExtraction = messages.slice(lastExtractedIdx + 1);

  // Adaptive interval: extract early when information density is high
  const density = computeInfoDensity(newSinceExtraction);
  const effectiveInterval =
    newSinceExtraction.length >= MIN_EXTRACTION_MESSAGES && density > HIGH_DENSITY_THRESHOLD
      ? MIN_EXTRACTION_MESSAGES
      : extractionInterval;

  if (newSinceExtraction.length >= effectiveInterval) {
    const connection = await resolveExtractionConnection(
      chat.extractionConnectionId,
      chat.connectionId,
    );
    if (connection) {
      const transcript = toApiMessages(newSinceExtraction, memberNames);
      await runExtraction(chatId, connection, transcript);
      await setLastExtractedMessageId(chatId, messages[messages.length - 1].id);

      // Drift check (M25.2) — same cadence and connection as extraction.
      // Only locked facts are canon; without any there is nothing to guard.
      try {
        const canon = (await listAllFacts(chatId)).filter(
          (f) => f.locked && f.status === "active",
        );
        await runDriftCheck(chatId, connection, canon, transcript);
      } catch (err) {
        console.warn("drift check scheduling failed", err);
      }
    }
  }

  // --- Summarization: unmerged messages older than the verbatim window ---
  const lastSummarizedIdx = chat.lastSummarizedMessageId
    ? messages.findIndex((m) => m.id === chat.lastSummarizedMessageId)
    : -1;
  const foldableEnd = messages.length - verbatimWindow; // exclusive upper bound
  const toFold =
    foldableEnd > lastSummarizedIdx + 1 ? messages.slice(lastSummarizedIdx + 1, foldableEnd) : [];
  let folded: Message[] = [];
  if (toFold.length >= SUMMARIZE_TRIGGER_THRESHOLD) {
    const connection = chat.connectionId ? await getConnection(chat.connectionId) : null;
    if (connection) {
      await runSummarization(chatId, connection, withSpeakerNames(toFold, memberNames));
      await setLastSummarizedMessageId(chatId, toFold[toFold.length - 1].id);
      folded = toFold;
    }
  }

  // --- Embeddings (M7/M8) ---
  // Facts and lore sync every pass, but only call the embedding API when a
  // row is new or was edited since its last embedding — so manual edits
  // from the memory panel get picked up too. Message chunks are embedded
  // exactly once, right after their messages were folded into the summary.
  try {
    const connection = await resolveExtractionConnection(
      chat.extractionConnectionId,
      chat.connectionId,
    );
    await syncFactEmbeddings(chatId, connection);
    if (folded.length > 0) {
      await syncMessageChunkEmbeddings(chatId, connection, folded);
    }
    const loreEntries = await listActivatableEntriesForMembers(
      memberCharacterIds.length > 0 ? memberCharacterIds : [chat.characterId],
      chatId,
    );
    await syncLoreEmbeddings(connection, loreEntries);
  } catch (err) {
    console.warn("embedding sync failed", err);
  }
}

async function drainQueue(chatId: string, entry: QueueEntry): Promise<void> {
  try {
    await runDueWork(chatId);
  } catch (err) {
    // Belt and suspenders: extractor/summarizer already catch their own
    // errors, but a DB read/write here (e.g. getChat) could still throw.
    console.warn("memory engine job failed", err);
  } finally {
    entry.running = false;
    if (entry.pendingRerun) {
      entry.pendingRerun = false;
      scheduleMemoryWork(chatId);
    }
  }
}

const GAME_TIME_SETTING_PREFIX = "game_time_";

/** Advances the game clock for a chat after each assistant message and
 *  persists the updated state to the settings table. The returned
 *  `GameTimeState` can be passed directly to `PromptBuilder` via
 *  `timeDescription`. Never throws — on any failure the original state
 *  (or default) is returned so the game continues. */
export async function advanceAndPersistTime(
  chatId: string,
  messageCount: number,
): Promise<GameTimeState> {
  try {
    const key = `${GAME_TIME_SETTING_PREFIX}${chatId}`;
    const raw = await getSetting(key);
    let state: GameTimeState;
    if (raw) {
      state = JSON.parse(raw) as GameTimeState;
    } else {
      state = defaultGameTimeState();
    }
    const next = advanceTime(state, messageCount);
    await setSetting(key, JSON.stringify(next));
    return next;
  } catch (err) {
    console.warn("advanceAndPersistTime failed", err);
    return defaultGameTimeState();
  }
}

const CALENDAR_SETTING_PREFIX = "game_calendar_";

/** Advances the fantasy calendar for a chat by one day and persists it.
 * Companion to `advanceAndPersistTime` — the calendar tracks named days,
 * months and seasons separately from the real-time game clock. Never throws:
 * on any failure the default calendar (Rok 847, day 1) is returned. */
export async function advanceAndPersistCalendar(
  chatId: string,
): Promise<CalendarDate> {
  try {
    const key = `${CALENDAR_SETTING_PREFIX}${chatId}`;
    const raw = await getSetting(key);
    let cal: CalendarDate;
    if (raw) {
      cal = calendarFromJSON(JSON.parse(raw));
    } else {
      cal = defaultCalendarDate();
    }
    const next = advanceDay(cal);
    await setSetting(key, JSON.stringify(calendarToJSON(next)));
    return next;
  } catch (err) {
    console.warn("advanceAndPersistCalendar failed", err);
    return defaultCalendarDate();
  }
}

/** Initializes the calendar for a chat if it hasn't been set yet.
 * Safe to call on every chat open — only writes the first time. */
export async function ensureCalendarInitialized(chatId: string): Promise<CalendarDate> {
  try {
    const key = `${CALENDAR_SETTING_PREFIX}${chatId}`;
    const raw = await getSetting(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      return calendarFromJSON(parsed);
    }
    const cal = defaultCalendarDate();
    await setSetting(key, JSON.stringify(calendarToJSON(cal)));
    return cal;
  } catch (err) {
    console.warn("ensureCalendarInitialized failed", err);
    return defaultCalendarDate();
  }
}

/** Queues a "check and run due memory work" pass for a chat. Call this
 * after an assistant message is finalized (plan §6.3). Fire-and-forget by
 * design — never awaited by the chat flow, never throws, and coalesces
 * concurrent triggers into a single rerun per chat so at most one job runs
 * at a time. */
export function scheduleMemoryWork(chatId: string): void {
  const entry = queues.get(chatId) ?? { running: false, pendingRerun: false };
  queues.set(chatId, entry);

  if (entry.running) {
    entry.pendingRerun = true;
    return;
  }
  entry.running = true;
  void drainQueue(chatId, entry);
}
