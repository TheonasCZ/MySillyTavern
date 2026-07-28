import { execute, newId, nowIso, query } from "../database";

export type MemoryLogSource =
  | "memoryEngine"
  | "extractor"
  | "summarizer"
  | "driftDetector"
  | "embeddingsEngine";

export type MemoryLogLevel = "debug" | "info" | "warn" | "error";

export interface MemoryLogEntry {
  id: string;
  chatId: string;
  source: MemoryLogSource;
  event: string;
  level: MemoryLogLevel;
  message: string;
  data: unknown;
  createdAt: string;
}

interface MemoryLogRow {
  id: string;
  chat_id: string;
  source: MemoryLogSource;
  event: string;
  level: MemoryLogLevel;
  message: string;
  data: string | null;
  created_at: string;
}

function toEntry(row: MemoryLogRow): MemoryLogEntry {
  let data: unknown = null;
  if (row.data) {
    try {
      data = JSON.parse(row.data);
    } catch {
      data = row.data;
    }
  }
  return {
    id: row.id,
    chatId: row.chat_id,
    source: row.source,
    event: row.event,
    level: row.level,
    message: row.message,
    data,
    createdAt: row.created_at,
  };
}

/** How many of a chat's most recent log rows are kept — a count cap rather
 * than an age cutoff, so a chat that's only opened once a month still keeps
 * its full history instead of losing everything older than a few weeks. */
const RETENTION_ROWS_PER_CHAT = 2000;
/** Prune probabilistically instead of on every write — a background sweep
 * that's cheap in aggregate but never blocks the hot path on a DELETE. */
const PRUNE_PROBABILITY = 0.05;

async function pruneOldLogs(chatId: string): Promise<void> {
  if (Math.random() >= PRUNE_PROBABILITY) return;
  try {
    await execute(
      `DELETE FROM memory_debug_log WHERE chat_id = $1 AND id NOT IN (
         SELECT id FROM memory_debug_log WHERE chat_id = $1 ORDER BY created_at DESC LIMIT $2
       )`,
      [chatId, RETENTION_ROWS_PER_CHAT],
    );
  } catch {
    // Never let log housekeeping break the caller.
  }
}

/** Records one structured event from the memory pipeline. Insert-only,
 * fire-and-forget by design (like `logUsage`) — a logging failure must
 * never break extraction/summarization/drift-checking. Persists to SQLite
 * so it survives app restarts, unlike console.log, which is the whole point:
 * intermittent "why didn't this fire" bugs need a trail that's still there
 * days later. */
export async function logMemoryEvent(
  chatId: string,
  source: MemoryLogSource,
  level: MemoryLogLevel,
  event: string,
  message: string,
  data?: Record<string, unknown>,
): Promise<void> {
  try {
    await execute(
      `INSERT INTO memory_debug_log (id, chat_id, source, event, level, message, data, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        newId(),
        chatId,
        source,
        event,
        level,
        message,
        data !== undefined ? JSON.stringify(data) : null,
        nowIso(),
      ],
    );
    void pruneOldLogs(chatId);
  } catch (err) {
    // Fall back to console so a DB-layer problem is at least visible live.
    console.warn("memoryLogRepo: failed to persist log entry", err);
  }
}

/** Reads the most recent log entries for a chat, newest first — for the
 * debug/inspector UI and for manual `sqlite3` archaeology. */
export async function listRecentMemoryLogs(
  chatId: string,
  limit = 200,
): Promise<MemoryLogEntry[]> {
  const rows = await query<MemoryLogRow>(
    "SELECT * FROM memory_debug_log WHERE chat_id = $1 ORDER BY created_at DESC LIMIT $2",
    [chatId, limit],
  );
  return rows.map(toEntry);
}
