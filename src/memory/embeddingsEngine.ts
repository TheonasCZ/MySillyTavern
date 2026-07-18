/** Semantic memory layer (M7/M8): embeddings for ledger facts, folded
 * message chunks and lorebook entries, plus retrieval that feeds
 * PromptBuilder. Brute-force cosine over base64 vectors in SQLite — no
 * SQLite extension needed at this scale (thousands of rows). */

import {
  deleteEmbeddingsByRefIds,
  listAllChatEmbeddings,
  listEmbeddings,
  listEmbeddingsByRefIds,
  upsertEmbedding,
  type StoredEmbedding,
} from "../db/repositories/embeddingsRepo";
import { listActiveFacts, type LedgerFact } from "../db/repositories/ledgerRepo";
import { listMessages } from "../db/repositories/messagesRepo";
import { getSetting, setSetting } from "../db/repositories/settingsRepo";
import { DEFAULT_VERBATIM_WINDOW } from "../prompt/promptBuilder";
import { embedTexts } from "../providers/embeddings";
import type { ConnectionConfig } from "../providers/types";
import { cosineSimilarity, decodeVector, encodeVector } from "./vector";

/** Providers that have been auto-detected as non-embeddable (e.g. the API
 * returned 404/405). Stored as a comma-separated list under the
 * `embedding_disabled_providers` setting. */
const EMBEDDING_DISABLED_KEY = "embedding_disabled_providers";

/** Mirrors the per-provider defaults in src-tauri/src/providers/embeddings.rs
 * — used to detect rows embedded by a different model than the current one. */
const DEFAULT_EMBEDDING_MODELS: Record<string, string> = {
  gemini: "gemini-embedding-2",
  openai: "text-embedding-3-small",
};

export const DEFAULT_MEMORY_TOP_K = 3;
export const DEFAULT_MEMORY_MIN_SCORE = 0.35;
/** Time-decay half-life for scene memories (M25.4): a scene this many days
 * old scores half its raw cosine similarity. Facts are timeless and never
 * decayed — only message-chunk memories fade. */
export const MEMORY_DECAY_HALF_LIFE_DAYS = 45;

/** Applies exponential time decay to a relevance score. Returns the raw
 * score for unparseable timestamps or clock skew (future dates). */
export function applyTimeDecay(score: number, createdAtIso: string, nowMs: number): number {
  const created = Date.parse(createdAtIso);
  if (!Number.isFinite(created)) return score;
  const ageDays = (nowMs - created) / 86_400_000;
  if (ageDays <= 0) return score;
  return score * Math.pow(0.5, ageDays / MEMORY_DECAY_HALF_LIFE_DAYS);
}
/** Semantic lore activations added on top of keyword hits. */
const LORE_TOP_K = 2;

/** How much conversation tail to embed as the retrieval query. */
const QUERY_TAIL_CHARS = 2000;

/** Message-chunk shape: fold this many messages (or this many chars,
 * whichever comes first) into one embeddable "scene". */
const CHUNK_MAX_MESSAGES = 6;
const CHUNK_MAX_CHARS = 1500;

/** Returns true when there is *any* connection — provider auto-detection has
 * moved to runtime (first `embedTexts` failure disables the provider). */
export function canEmbed(connection: ConnectionConfig | null): connection is ConnectionConfig {
  return !!connection;
}

/** Returns false when the provider has been auto-disabled after a failed
 * embedding call (404/405 etc.). */
export async function isEmbeddingAvailable(providerId: string): Promise<boolean> {
  const disabled = await getSetting(EMBEDDING_DISABLED_KEY).catch(() => null);
  if (!disabled) return true;
  return !disabled.split(",").map((s) => s.trim()).includes(providerId);
}

/** Returns the list of provider ids that have been auto-disabled. */
export async function getDisabledEmbeddingProviders(): Promise<string[]> {
  const disabled = await getSetting(EMBEDDING_DISABLED_KEY).catch(() => null);
  if (!disabled) return [];
  return disabled.split(",").map((s) => s.trim()).filter(Boolean);
}

/** Persists `providerId` into the disabled set so future embedding calls are
 * skipped without hitting the API again. */
export async function markEmbeddingUnavailable(providerId: string): Promise<void> {
  const disabled = await getSetting(EMBEDDING_DISABLED_KEY).catch(() => null);
  const set = new Set(disabled ? disabled.split(",").map((s) => s.trim()) : []);
  if (set.has(providerId)) return;
  set.add(providerId);
  await setSetting(EMBEDDING_DISABLED_KEY, [...set].join(",")).catch(() => {});
}

export interface EmbeddingSettings {
  model: string | null;
  topK: number;
  minScore: number;
}

export async function getEmbeddingSettings(): Promise<EmbeddingSettings> {
  const [model, topK, minScore] = await Promise.all([
    getSetting("embedding_model").catch(() => null),
    getSetting("memory_top_k").catch(() => null),
    getSetting("memory_min_score").catch(() => null),
  ]);
  const k = Number(topK);
  const score = Number(minScore);
  return {
    model: model?.trim() || null,
    topK: Number.isFinite(k) && k > 0 ? Math.floor(k) : DEFAULT_MEMORY_TOP_K,
    minScore: Number.isFinite(score) && score >= 0 && score <= 1 ? score : DEFAULT_MEMORY_MIN_SCORE,
  };
}

/** The model rows are expected to carry — the override setting, or the
 * provider default. Rows with a different model are considered stale. */
export function expectedModel(connection: ConnectionConfig, settings: EmbeddingSettings): string {
  return settings.model ?? DEFAULT_EMBEDDING_MODELS[connection.provider] ?? "";
}

/** The text a fact is embedded as — must stay deterministic, since it's
 * compared against `embeddings.text` to detect facts edited since their
 * last embedding. */
export function factEmbeddingText(
  fact: Pick<LedgerFact, "category" | "subject" | "fact"> & { sub_key?: string },
): string {
  const key = fact.sub_key
    ? `${fact.category}/${fact.subject}/${fact.sub_key}`
    : `${fact.category}/${fact.subject}`;
  return `(${key}) ${fact.fact}`;
}

export interface ChunkSource {
  id: string;
  role: string;
  content: string;
}

export interface MessageChunk {
  /** Id of the chunk's first message — stable across re-runs. */
  refId: string;
  text: string;
}

/** Splits a run of folded messages into embeddable "scenes". Pure —
 * unit-tested without the DB. When `overlap` > 0 the last `overlap`
 * messages are kept after a flush to seed the next chunk, producing a
 * sliding-window effect that keeps scene boundaries connected. */
export function chunkMessagesForEmbedding(messages: ChunkSource[], overlap = 0): MessageChunk[] {
  const chunks: MessageChunk[] = [];
  let current: ChunkSource[] = [];
  let currentChars = 0;

  const flush = (keep: number) => {
    if (current.length === 0) return;
    const text = current
      .map((m) => `${m.role === "user" ? "Hráč" : "Vypravěč"}: ${m.content}`)
      .join("\n")
      .slice(0, CHUNK_MAX_CHARS * 2);
    chunks.push({ refId: current[0].id, text });
    const kept = keep > 0 && current.length > keep ? current.slice(-keep) : [];
    current = kept;
    currentChars = kept.reduce((sum, m) => sum + m.content.length, 0);
  };

  for (const message of messages) {
    current.push(message);
    currentChars += message.content.length;
    if (current.length >= CHUNK_MAX_MESSAGES || currentChars >= CHUNK_MAX_CHARS) flush(overlap);
  }
  flush(0);
  return chunks;
}

/** Picks the messages eligible for scene backfill: user/assistant only,
 * dropping the last `verbatimWindow` (still "live", folded into the summary
 * later rather than embedded now). Pure — unit-tested without the DB. */
export function selectBackfillCandidates(
  messages: ChunkSource[],
  verbatimWindow: number,
): ChunkSource[] {
  const eligible = messages.filter((m) => m.role === "user" || m.role === "assistant");
  return verbatimWindow > 0 ? eligible.slice(0, -verbatimWindow) : eligible;
}

// ---- Sync (write path) ---------------------------------------------------

/** Embeds new/edited active facts and deletes rows for facts that no
 * longer exist. No-op (and no API call) when everything is up to date.
 * Called from the memory engine after each pass; safe to call often. */
export async function syncFactEmbeddings(
  chatId: string,
  connection: ConnectionConfig | null,
): Promise<void> {
  if (!canEmbed(connection)) return;
  if (!(await isEmbeddingAvailable(connection.provider))) return;
  const settings = await getEmbeddingSettings();
  const model = expectedModel(connection, settings);

  const [facts, stored] = await Promise.all([
    listActiveFacts(chatId),
    listEmbeddings(chatId, "fact"),
  ]);
  const storedByRef = new Map(stored.map((e) => [e.refId, e]));

  const dirty = facts.filter((f) => {
    const row = storedByRef.get(f.id);
    return !row || row.text !== factEmbeddingText(f) || row.model !== model;
  });
  if (dirty.length > 0) {
    try {
      const { model: usedModel, vectors } = await embedTexts(
        connection,
        dirty.map(factEmbeddingText),
        settings.model,
      );
      for (let i = 0; i < dirty.length; i++) {
        const vec = Float32Array.from(vectors[i]);
        await upsertEmbedding(
          chatId,
          "fact",
          dirty[i].id,
          factEmbeddingText(dirty[i]),
          usedModel,
          vec.length,
          encodeVector(vec),
        );
      }
    } catch (err) {
      await markEmbeddingUnavailable(connection.provider);
      console.warn("fact embedding failed for provider", connection.provider, err);
    }
  }

  const factIds = new Set(facts.map((f) => f.id));
  const stale = stored.filter((e) => !factIds.has(e.refId)).map((e) => e.refId);
  if (stale.length > 0) {
    await deleteEmbeddingsByRefIds("fact", stale);
  }
}

/** Embeds the message chunks that were just folded into the summary —
 * these become the retrievable "memories of older scenes". Chunks are
 * append-only (folded messages never change), so no dirty check needed. */
export async function syncMessageChunkEmbeddings(
  chatId: string,
  connection: ConnectionConfig | null,
  foldedMessages: ChunkSource[],
): Promise<void> {
  if (!canEmbed(connection) || foldedMessages.length === 0) return;
  if (!(await isEmbeddingAvailable(connection.provider))) return;
  const settings = await getEmbeddingSettings();

  const chunks = chunkMessagesForEmbedding(foldedMessages, 3);
  if (chunks.length === 0) return;

  try {
    const { model, vectors } = await embedTexts(
      connection,
      chunks.map((c) => c.text),
      settings.model,
    );
    for (let i = 0; i < chunks.length; i++) {
      const vec = Float32Array.from(vectors[i]);
      await upsertEmbedding(
        chatId,
        "message",
        chunks[i].refId,
        chunks[i].text,
        model,
        vec.length,
        encodeVector(vec),
      );
    }
  } catch (err) {
    await markEmbeddingUnavailable(connection.provider);
    console.warn("message chunk embedding failed for provider", connection.provider, err);
  }
}

/** One-off backfill for chats that predate the message-chunk embedding
 * feature: embeds scenes from the whole history minus the live verbatim
 * tail, skipping chunks already embedded. Returns how many were created. */
export async function backfillSceneEmbeddings(
  chatId: string,
  connection: ConnectionConfig,
): Promise<number> {
  const [messages, verbatimWindowSetting, existing] = await Promise.all([
    listMessages(chatId),
    getSetting("verbatim_window").catch(() => null),
    listEmbeddings(chatId, "message"),
  ]);
  const parsedWindow = Number(verbatimWindowSetting);
  const verbatimWindow = Number.isFinite(parsedWindow) && parsedWindow > 0
    ? Math.floor(parsedWindow)
    : DEFAULT_VERBATIM_WINDOW;

  const candidates = selectBackfillCandidates(messages, verbatimWindow);
  const chunks = chunkMessagesForEmbedding(candidates);

  const existingRefIds = new Set(existing.map((e) => e.refId));
  const missing = chunks.filter((c) => !existingRefIds.has(c.refId));
  if (missing.length === 0) return 0;

  const settings = await getEmbeddingSettings();
  try {
    const { model, vectors } = await embedTexts(
      connection,
      missing.map((c) => c.text),
      settings.model,
    );
    for (let i = 0; i < missing.length; i++) {
      const vec = Float32Array.from(vectors[i]);
      await upsertEmbedding(chatId, "message", missing[i].refId, missing[i].text, model, vec.length, encodeVector(vec));
    }
    return missing.length;
  } catch (err) {
    await markEmbeddingUnavailable(connection.provider);
    console.warn("backfill embedding failed for provider", connection.provider, err);
    return 0;
  }
}

export interface LoreSource {
  id: string;
  content: string;
}

/** Embeds new/edited lorebook entries (chat-agnostic, chat_id NULL). */
export async function syncLoreEmbeddings(
  connection: ConnectionConfig | null,
  entries: LoreSource[],
): Promise<void> {
  if (!canEmbed(connection)) return;
  if (!(await isEmbeddingAvailable(connection.provider))) return;
  const candidates = entries
    .map((e) => ({ id: e.id, text: e.content.trim() }))
    .filter((e) => e.text.length > 0);
  if (candidates.length === 0) return;

  const settings = await getEmbeddingSettings();
  const model = expectedModel(connection, settings);
  const stored = await listEmbeddingsByRefIds(
    "lore",
    candidates.map((e) => e.id),
  );
  const storedByRef = new Map(stored.map((e) => [e.refId, e]));

  const dirty = candidates.filter((e) => {
    const row = storedByRef.get(e.id);
    return !row || row.text !== e.text || row.model !== model;
  });
  if (dirty.length === 0) return;

  try {
    const { model: usedModel, vectors } = await embedTexts(
      connection,
      dirty.map((e) => e.text),
      settings.model,
    );
    for (let i = 0; i < dirty.length; i++) {
      const vec = Float32Array.from(vectors[i]);
      await upsertEmbedding(null, "lore", dirty[i].id, dirty[i].text, usedModel, vec.length, encodeVector(vec));
    }
  } catch (err) {
    await markEmbeddingUnavailable(connection.provider);
    console.warn("lore embedding failed for provider", connection.provider, err);
  }
}

/** Re-embeds every stored row for a chat with the current model — the
 * "Reindex" button after switching embedding models. Returns how many rows
 * were re-embedded. */
export async function reindexChatEmbeddings(
  chatId: string,
  connection: ConnectionConfig,
): Promise<number> {
  const settings = await getEmbeddingSettings();
  const rows = await listAllChatEmbeddings(chatId);
  if (rows.length > 0) {
    try {
      const { model, vectors } = await embedTexts(
        connection,
        rows.map((r) => r.text),
        settings.model,
      );
      for (let i = 0; i < rows.length; i++) {
        const vec = Float32Array.from(vectors[i]);
        await upsertEmbedding(
          rows[i].chatId,
          rows[i].kind,
          rows[i].refId,
          rows[i].text,
          model,
          vec.length,
          encodeVector(vec),
        );
      }
    } catch (err) {
      await markEmbeddingUnavailable(connection.provider);
      console.warn("reindex embedding failed for provider", connection.provider, err);
    }
  }
  // Also picks up facts that were never embedded (e.g. Claude-only history).
  await syncFactEmbeddings(chatId, connection);
  return rows.length;
}

// ---- Retrieval (read path) -----------------------------------------------

/** Builds the retrieval query from the conversation tail (most recent
 * messages, capped by characters so a huge message doesn't blow up the
 * embedding call). */
export function buildRelevanceQuery(recentContents: string[]): string {
  return recentContents.join("\n").slice(-QUERY_TAIL_CHARS);
}

function scoreRows(rows: StoredEmbedding[], queryVec: Float32Array): Map<string, number> {
  return new Map(rows.map((e) => [e.refId, cosineSimilarity(queryVec, decodeVector(e.vector))]));
}

function topRefIds(scores: Map<string, number>, minScore: number, topK: number): string[] {
  return [...scores.entries()]
    .filter(([, s]) => s >= minScore)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK)
    .map(([refId]) => refId);
}

export interface RetrievedMemoryDetail {
  /** First ~120 chars of the scene text (for the Prompt inspector). */
  snippet: string;
  /** Raw cosine similarity to the query. */
  score: number;
  /** Score after time decay — this is what the ranking used. */
  decayedScore: number;
  createdAt: string;
}

export interface SemanticContext {
  /** Cosine score per fact id — feeds PromptBuilder's relevance-aware trim. */
  factRelevance?: Record<string, number>;
  /** Texts of the top-K relevant older scenes, most relevant first. */
  memories: string[];
  /** Why each direct-hit memory was selected (M25.4) — same order as the
   * direct hits at the head of `memories`; adjacent-scene fillers have no
   * entry. */
  memoriesDetail: RetrievedMemoryDetail[];
  /** Lorebook entry ids activated semantically (on top of keyword hits). */
  loreEntryIds: string[];
  /** The raw query embedding (f32 array) that was used to score everything.
   * Callers can reuse this for additional similarity lookups (e.g. voice
   * examples) without a second embedding API call. */
  queryEmbedding?: number[];
}

/** One embedding API call per send: embeds the conversation tail and scores
 * everything stored against it. Returns an empty context when nothing is
 * embedded yet. */
export async function retrieveSemanticContext(args: {
  chatId: string;
  connection: ConnectionConfig;
  queryTexts: string[];
  /** Activatable lorebook entries NOT already keyword-selected. */
  candidateLoreIds: string[];
}): Promise<SemanticContext> {
  const empty: SemanticContext = { memories: [], memoriesDetail: [], loreEntryIds: [] };
  const queryText = buildRelevanceQuery(args.queryTexts);
  if (!queryText.trim()) return empty;

  const [factRows, messageRows, loreRows] = await Promise.all([
    listEmbeddings(args.chatId, "fact"),
    listEmbeddings(args.chatId, "message"),
    args.candidateLoreIds.length > 0
      ? listEmbeddingsByRefIds("lore", args.candidateLoreIds)
      : Promise.resolve([]),
  ]);
  if (factRows.length + messageRows.length + loreRows.length === 0) return empty;

  const settings = await getEmbeddingSettings();
  let queryVec: Float32Array;
  try {
    const { vectors } = await embedTexts(args.connection, [queryText], settings.model);
    queryVec = Float32Array.from(vectors[0]);
  } catch (err) {
    await markEmbeddingUnavailable(args.connection.provider);
    console.warn("semantic retrieval embedding failed for provider", args.connection.provider, err);
    return empty;
  }

  const factScores = scoreRows(factRows, queryVec);
  const rawMessageScores = scoreRows(messageRows, queryVec);
  const loreScores = scoreRows(loreRows, queryVec);

  const messagesByRef = new Map(messageRows.map((e) => [e.refId, e]));

  // Time decay (M25.4): older scenes fade so a months-old lookalike doesn't
  // crowd out a fresher, slightly-less-similar one. The min-score gate runs
  // on the decayed value — a fully faded memory just stops being retrieved.
  const now = Date.now();
  const messageScores = new Map<string, number>();
  for (const [refId, score] of rawMessageScores) {
    const row = messagesByRef.get(refId);
    messageScores.set(refId, row ? applyTimeDecay(score, row.createdAt, now) : score);
  }

  const topMessageRefIds = topRefIds(messageScores, settings.minScore, settings.topK);
  const memories = topMessageRefIds.map((refId) => messagesByRef.get(refId)!.text);
  const memoriesDetail: RetrievedMemoryDetail[] = topMessageRefIds.map((refId) => {
    const row = messagesByRef.get(refId)!;
    return {
      snippet: row.text.length > 120 ? `${row.text.slice(0, 120)}…` : row.text,
      score: rawMessageScores.get(refId) ?? 0,
      decayedScore: messageScores.get(refId) ?? 0,
      createdAt: row.createdAt,
    };
  });

  // Include adjacent chunks (k-1, k+1) so scene boundaries aren't lost.
  const sortedMessageRows = [...messageRows].sort((a, b) =>
    a.refId < b.refId ? -1 : a.refId > b.refId ? 1 : 0,
  );
  const refIdIndex = new Map(sortedMessageRows.map((r, i) => [r.refId, i]));
  const topRefIdSet = new Set(topMessageRefIds);
  const adjacentTexts: string[] = [];
  for (const refId of topMessageRefIds) {
    const idx = refIdIndex.get(refId);
    if (idx === undefined) continue;
    for (const offset of [-1, 1]) {
      const neighborIdx = idx + offset;
      if (neighborIdx < 0 || neighborIdx >= sortedMessageRows.length) continue;
      const neighbor = sortedMessageRows[neighborIdx];
      if (!topRefIdSet.has(neighbor.refId) && !adjacentTexts.includes(neighbor.text)) {
        adjacentTexts.push(neighbor.text);
      }
    }
  }
  // Prepend "(sousední scéna) " so the model knows this is context, not a direct match.
  for (const text of adjacentTexts) {
    memories.push(`(sousední scéna) ${text}`);
  }

  return {
    factRelevance: factScores.size > 0 ? Object.fromEntries(factScores) : undefined,
    memories,
    memoriesDetail,
    loreEntryIds: topRefIds(loreScores, settings.minScore, LORE_TOP_K),
    queryEmbedding: Array.from(queryVec),
  };
}

export interface SearchResult {
  kind: "fact" | "message";
  refId: string;
  text: string;
  score: number;
}

/** Manual search from the memory panel's "Search" tab — same scoring as
 * retrieval, but over a user-typed query and returning everything ranked. */
export async function semanticSearch(
  chatId: string,
  connection: ConnectionConfig,
  queryText: string,
  limit = 20,
): Promise<SearchResult[]> {
  const [factRows, messageRows] = await Promise.all([
    listEmbeddings(chatId, "fact"),
    listEmbeddings(chatId, "message"),
  ]);
  const rows = [...factRows, ...messageRows];
  if (rows.length === 0 || !queryText.trim()) return [];

  const settings = await getEmbeddingSettings();
  let queryVec: Float32Array;
  try {
    const { vectors } = await embedTexts(connection, [queryText], settings.model);
    queryVec = Float32Array.from(vectors[0]);
  } catch (err) {
    await markEmbeddingUnavailable(connection.provider);
    console.warn("semantic search embedding failed for provider", connection.provider, err);
    return [];
  }

  const results = rows
    .map((e) => ({
      kind: e.kind as "fact" | "message",
      refId: e.refId,
      text: e.text,
      score: cosineSimilarity(queryVec, decodeVector(e.vector)),
    }))
    .sort((a, b) => b.score - a.score);

  // Include adjacent message chunks (k-1, k+1) so scene boundaries aren't lost.
  const topMessageRefIds = results
    .filter((r) => r.kind === "message")
    .slice(0, limit)
    .map((r) => r.refId);
  const sortedMessageRows = [...messageRows].sort((a, b) =>
    a.refId < b.refId ? -1 : a.refId > b.refId ? 1 : 0,
  );
  const refIdIndex = new Map(sortedMessageRows.map((r, i) => [r.refId, i]));
  const topRefIdSet = new Set(topMessageRefIds);
  const resultRefIds = new Set(results.map((r) => r.refId));
  const adjacent: SearchResult[] = [];
  for (const refId of topMessageRefIds) {
    const idx = refIdIndex.get(refId);
    if (idx === undefined) continue;
    for (const offset of [-1, 1]) {
      const neighborIdx = idx + offset;
      if (neighborIdx < 0 || neighborIdx >= sortedMessageRows.length) continue;
      const neighbor = sortedMessageRows[neighborIdx];
      if (!topRefIdSet.has(neighbor.refId) && !resultRefIds.has(neighbor.refId)) {
        adjacent.push({
          kind: "message",
          refId: neighbor.refId,
          text: `(sousední scéna) ${neighbor.text}`,
          score: 0,
        });
        resultRefIds.add(neighbor.refId);
      }
    }
  }

  return [...results.slice(0, limit), ...adjacent];
}
