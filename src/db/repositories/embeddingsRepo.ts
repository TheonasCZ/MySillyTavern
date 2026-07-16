import { execute, newId, nowIso, query } from "../database";

export type EmbeddingKind = "fact" | "summary" | "message" | "lore";

export interface StoredEmbedding {
  id: string;
  /** Null for chat-agnostic rows (kind 'lore'). */
  chatId: string | null;
  kind: EmbeddingKind;
  refId: string;
  /** The exact text that was embedded — compared against the current
   * source text to detect stale rows needing re-embedding. */
  text: string;
  model: string;
  dims: number;
  /** base64-encoded little-endian f32 array (see memory/vector.ts). */
  vector: string;
  createdAt: string;
}

interface EmbeddingRow {
  id: string;
  chat_id: string | null;
  kind: EmbeddingKind;
  ref_id: string;
  text: string;
  model: string;
  dims: number;
  vector: string;
  created_at: string;
}

function toEmbedding(row: EmbeddingRow): StoredEmbedding {
  return {
    id: row.id,
    chatId: row.chat_id,
    kind: row.kind,
    refId: row.ref_id,
    text: row.text,
    model: row.model,
    dims: row.dims,
    vector: row.vector,
    createdAt: row.created_at,
  };
}

export async function listEmbeddings(
  chatId: string,
  kind: EmbeddingKind,
): Promise<StoredEmbedding[]> {
  const rows = await query<EmbeddingRow>(
    "SELECT * FROM embeddings WHERE chat_id = $1 AND kind = $2",
    [chatId, kind],
  );
  return rows.map(toEmbedding);
}

export async function upsertEmbedding(
  chatId: string | null,
  kind: EmbeddingKind,
  refId: string,
  text: string,
  model: string,
  dims: number,
  vector: string,
): Promise<void> {
  await execute(
    `INSERT INTO embeddings (id, chat_id, kind, ref_id, text, model, dims, vector, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (kind, ref_id)
     DO UPDATE SET text = $5, model = $6, dims = $7, vector = $8`,
    [newId(), chatId, kind, refId, text, model, dims, vector, nowIso()],
  );
}

/** Removes rows whose source (fact/message/…) no longer exists. */
export async function deleteEmbeddingsByRefIds(
  kind: EmbeddingKind,
  refIds: string[],
): Promise<void> {
  for (const refId of refIds) {
    await execute("DELETE FROM embeddings WHERE kind = $1 AND ref_id = $2", [kind, refId]);
  }
}

/** Fetches rows for a specific set of source ids (used for lorebook
 * entries, which aren't chat-scoped). Chunked to stay under SQLite's
 * parameter limit. */
export async function listEmbeddingsByRefIds(
  kind: EmbeddingKind,
  refIds: string[],
): Promise<StoredEmbedding[]> {
  const out: StoredEmbedding[] = [];
  const CHUNK = 200;
  for (let i = 0; i < refIds.length; i += CHUNK) {
    const chunk = refIds.slice(i, i + CHUNK);
    const placeholders = chunk.map((_, j) => `$${j + 2}`).join(", ");
    const rows = await query<EmbeddingRow>(
      `SELECT * FROM embeddings WHERE kind = $1 AND ref_id IN (${placeholders})`,
      [kind, ...chunk],
    );
    out.push(...rows.map(toEmbedding));
  }
  return out;
}

/** Everything embedded for a chat — the reindex path re-embeds these rows'
 * stored texts with the current model. */
export async function listAllChatEmbeddings(chatId: string): Promise<StoredEmbedding[]> {
  const rows = await query<EmbeddingRow>("SELECT * FROM embeddings WHERE chat_id = $1", [chatId]);
  return rows.map(toEmbedding);
}
