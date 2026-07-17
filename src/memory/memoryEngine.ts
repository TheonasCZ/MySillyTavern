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
import { runExtraction, type TranscriptChatMessage } from "./extractor";
import { runSummarization, type TranscriptMessage } from "./summarizer";
import {
  advanceTime,
  defaultGameTimeState,
  type GameTimeState,
} from "./gameTime";

export const DEFAULT_EXTRACTION_INTERVAL = 10;
/** How many messages must have scrolled past the verbatim window,
 * unsummarized, before a summarization pass is queued. Fixed per plan
 * §6.3 (only the extraction interval and verbatim window are settings). */
export const SUMMARIZE_TRIGGER_THRESHOLD = 10;

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
  if (newSinceExtraction.length >= extractionInterval) {
    const connection = await resolveExtractionConnection(
      chat.extractionConnectionId,
      chat.connectionId,
    );
    if (connection) {
      await runExtraction(chatId, connection, toApiMessages(newSinceExtraction, memberNames));
      await setLastExtractedMessageId(chatId, messages[messages.length - 1].id);
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
