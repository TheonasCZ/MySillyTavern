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
import { listMessages, type Message } from "../db/repositories/messagesRepo";
import { getSetting } from "../db/repositories/settingsRepo";
import type { ChatMessage, ConnectionConfig } from "../providers/types";
import { DEFAULT_VERBATIM_WINDOW } from "../prompt/promptBuilder";
import { runExtraction } from "./extractor";
import { runSummarization } from "./summarizer";

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

function toApiMessages(messages: Message[]): ChatMessage[] {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role, content: m.content }));
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

  const [extractionInterval, verbatimWindow] = await Promise.all([
    readNumberSetting("extraction_interval", DEFAULT_EXTRACTION_INTERVAL),
    readNumberSetting("verbatim_window", DEFAULT_VERBATIM_WINDOW),
  ]);

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
      await runExtraction(chatId, connection, toApiMessages(newSinceExtraction));
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
  if (toFold.length >= SUMMARIZE_TRIGGER_THRESHOLD) {
    const connection = chat.connectionId ? await getConnection(chat.connectionId) : null;
    if (connection) {
      await runSummarization(chatId, connection, toFold);
      await setLastSummarizedMessageId(chatId, toFold[toFold.length - 1].id);
    }
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
