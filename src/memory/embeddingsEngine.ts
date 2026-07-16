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
import { getSetting } from "../db/repositories/settingsRepo";
import { DEFAULT_VERBATIM_WINDOW } from "../prompt/promptBuilder";
import { embedTexts } from "../providers/embeddings";
import type { ConnectionConfig } from "../providers/types";
import { cosineSimilarity, decodeVector, encodeVector } from "./vector";

/** Claude has no embedding API — chats wired to it just skip the semantic
 * layer (facts keep their default trim order, no memory retrieval). */
const EMBEDDABLE_PROVIDERS = new Set(["gemini", "openai"]);

/** Mirrors the per-provider defaults in src-tauri/src/providers/embeddings.rs
 * — used to detect rows embedded by a different model than the current one. */
const DEFAULT_EMBEDDING_MODELS: Record<string, string> = {
  gemini: "gemini-embedding-001",
  openai: "text-embedding-3-small",
};

export const DEFAULT_MEMORY_TOP_K = 3;
export const DEFAULT_MEMORY_MIN_SCORE = 0.35;
/** Semantic lore activations added on top of keyword hits. */
const LORE_TOP_K = 2;

/** How much conversation tail to embed as the retrieval query. */
const QUERY_TAIL_CHARS = 2000;

/** Message-chunk shape: fold this many messages (or this many chars,
 * whichever comes first) into one embeddable "scene". */
const CHUNK_MAX_MESSAGES = 6;
const CHUNK_MAX_CHARS = 1500;

export function canEmbed(connection: ConnectionConfig | null): connection is ConnectionConfig {
  return !!connection && EMBEDDABLE_PROVIDERS.has(connection.provider);
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
export function factEmbeddingText(fact: Pick<LedgerFact, "category" | "subject" | "fact">): string {
  return `(${fact.category}/${fact.subject}) ${fact.fact}`;
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
 * unit-tested without the DB. */
export function chunkMessagesForEmbedding(messages: ChunkSource[]): MessageChunk[] {
  const chunks: MessageChunk[] = [];
  let current: ChunkSource[] = [];
  let currentChars = 0;

  const flush = () => {
    if (current.length === 0) return;
    const text = current
      .map((m) => `${m.role === "user" ? "Hráč" : "Vypravěč"}: ${m.content}`)
      .join("\n")
      .slice(0, CHUNK_MAX_CHARS * 2);
    chunks.push({ refId: current[0].id, text });
    current = [];
    currentChars = 0;
  };

  for (const message of messages) {
    current.push(message);
    currentChars += message.content.length;
    if (current.length >= CHUNK_MAX_MESSAGES || currentChars >= CHUNK_MAX_CHARS) flush();
  }
  flush();
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
  const settings = await getEmbeddingSettings();

  const chunks = chunkMessagesForEmbedding(foldedMessages);
  if (chunks.length === 0) return;

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

  const { model: usedModel, vectors } = await embedTexts(
    connection,
    dirty.map((e) => e.text),
    settings.model,
  );
  for (let i = 0; i < dirty.length; i++) {
    const vec = Float32Array.from(vectors[i]);
    await upsertEmbedding(null, "lore", dirty[i].id, dirty[i].text, usedModel, vec.length, encodeVector(vec));
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

export interface SemanticContext {
  /** Cosine score per fact id — feeds PromptBuilder's relevance-aware trim. */
  factRelevance?: Record<string, number>;
  /** Texts of the top-K relevant older scenes, most relevant first. */
  memories: string[];
  /** Lorebook entry ids activated semantically (on top of keyword hits). */
  loreEntryIds: string[];
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
  const empty: SemanticContext = { memories: [], loreEntryIds: [] };
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
  const { vectors } = await embedTexts(args.connection, [queryText], settings.model);
  const queryVec = Float32Array.from(vectors[0]);

  const factScores = scoreRows(factRows, queryVec);
  const messageScores = scoreRows(messageRows, queryVec);
  const loreScores = scoreRows(loreRows, queryVec);

  const messagesByRef = new Map(messageRows.map((e) => [e.refId, e]));
  const memories = topRefIds(messageScores, settings.minScore, settings.topK).map(
    (refId) => messagesByRef.get(refId)!.text,
  );

  return {
    factRelevance: factScores.size > 0 ? Object.fromEntries(factScores) : undefined,
    memories,
    loreEntryIds: topRefIds(loreScores, settings.minScore, LORE_TOP_K),
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
  const { vectors } = await embedTexts(connection, [queryText], settings.model);
  const queryVec = Float32Array.from(vectors[0]);

  return rows
    .map((e) => ({
      kind: e.kind as "fact" | "message",
      refId: e.refId,
      text: e.text,
      score: cosineSimilarity(queryVec, decodeVector(e.vector)),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
