/** Ledger extractor (plan §6.3). The parser and merge-decision logic are
 * pure functions (no DB/Tauri import) so they're unit-testable in
 * isolation; `runExtraction` is the thin orchestration layer that wires
 * them to `chat_complete` and `ledgerRepo`. */

import { chatComplete } from "../providers/chatComplete";
import type { ChatMessage, ConnectionConfig } from "../providers/types";
import {
  applyLedgerRemove,
  applyLedgerUpsert,
  applySoftCanonCorrection,
  incrementContradictionStreak,
  incrementStability,
  listAllFacts,
  setFactCanon,
  type LedgerCategory,
} from "../db/repositories/ledgerRepo";
import { logUsage } from "../db/repositories/usageRepo";
import { estimateTokens } from "../prompt/tokenEstimate";
import { embedTexts } from "../providers/embeddings";
import { canEmbed } from "./embeddingsEngine";
import { listEmbeddings } from "../db/repositories/embeddingsRepo";
import { cosineSimilarity, decodeVector } from "./vector";
import { EXTRACTION_SYSTEM_PROMPT } from "../prompt/promptTexts";

export type ExtractAction = "upsert" | "remove";

export interface ExtractedFact {
  category: LedgerCategory;
  subject: string;
  /** Optional disambiguation key — when multiple facts share the same
   * (category, subject) pair (e.g. "Hráč" has both "má meč" and "má štít"),
   * the extractor auto-suggests a short slug like "sword" / "shield" so
   * they don't UPSERT over each other. Defaults to "" for existing facts. */
  sub_key?: string;
  fact: string;
  action: ExtractAction;
}

const VALID_CATEGORIES: LedgerCategory[] = ["player", "world", "npc", "event", "quest"];

function isExtractedFact(value: unknown): value is ExtractedFact {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  // sub_key is optional — a string when present, otherwise defaults to ""
  const subKeyOk = v.sub_key === undefined || v.sub_key === null || typeof v.sub_key === "string";
  return (
    typeof v.category === "string" &&
    VALID_CATEGORIES.includes(v.category as LedgerCategory) &&
    typeof v.subject === "string" &&
    v.subject.trim().length > 0 &&
    typeof v.fact === "string" &&
    (v.action === "upsert" || v.action === "remove") &&
    subKeyOk
  );
}

/** Tolerant parser for the extractor's LLM output: strips ```json fences
 * (or any code fence), finds the first `[...]` JSON array substring, and
 * validates each element's shape. Malformed/missing elements are dropped
 * rather than failing the whole batch — a partially-useful extraction is
 * better than none, and callers only merge what parses. Returns `[]`
 * (never throws) on completely unparseable input so a bad LLM response
 * never crashes the game per plan §9. */
export function parseExtractorOutput(raw: string): ExtractedFact[] {
  if (!raw) return [];
  const withoutFences = raw.replace(/```[a-zA-Z]*\n?/g, "").replace(/```/g, "");
  const start = withoutFences.indexOf("[");
  const end = withoutFences.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return [];
  const candidate = withoutFences.slice(start, end + 1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isExtractedFact).map((f) => ({
    category: f.category,
    subject: f.subject.trim(),
    sub_key: typeof f.sub_key === "string" ? f.sub_key.trim() : undefined,
    fact: f.fact.trim(),
    action: f.action,
  }));
}

// ---- Merge decision (pure) --------------------------------------------

export interface LedgerSnapshotFact {
  id: string;
  category: LedgerCategory;
  subject: string;
  sub_key: string;
  fact: string;
  status: "active" | "archived";
  locked: boolean;
  /** Soft canon (M25.5) — auto-promoted; extractor may still correct it
   * after `SOFT_CANON_CORRECTION_STREAK` consecutive contradictions. */
  canon: boolean;
  contradictionStreak: number;
  stability: number;
}

export type MergeOpKind = "insert" | "update" | "archive" | "skip" | "streak";

export interface MergeOp {
  kind: MergeOpKind;
  category: LedgerCategory;
  subject: string;
  sub_key: string;
  fact: string;
  /** Present for update/archive/skip/streak — the existing row it targets. */
  factId?: string;
  /** Why an op was skipped (locked, or remove of a nonexistent fact). */
  reason?: string;
  /** Set on update/archive of a soft-canon fact whose contradiction streak
   * ran out — the fact loses its canon status along with the change. */
  demote?: boolean;
}

/** How many *consecutive* extraction passes must contradict a soft-canon
 * fact before the correction is applied (a single outlier never wins). */
export const SOFT_CANON_CORRECTION_STREAK = 2;

// ---- Auto-promotion to soft canon (M25.5) ------------------------------

/** Confirmed-unchanged passes needed before a fact becomes soft canon. */
export const SOFT_CANON_STABILITY_THRESHOLD = 3;
/** Genre/limit-guarding categories promote faster — these are exactly the
 * facts whose drift ruins long campaigns. */
export const PRIORITY_CANON_CATEGORIES: LedgerCategory[] = ["world", "player"];
export const PRIORITY_CANON_STABILITY_THRESHOLD = 2;

export function stabilityThresholdFor(category: LedgerCategory): number {
  return PRIORITY_CANON_CATEGORIES.includes(category)
    ? PRIORITY_CANON_STABILITY_THRESHOLD
    : SOFT_CANON_STABILITY_THRESHOLD;
}

/** Given the facts an extraction pass looked at and the ops it produced,
 * decides (purely) which facts were *confirmed* — relevant to the scene yet
 * left unchanged — and which of those cross their stability threshold and
 * get promoted to soft canon. Locked and already-canon facts don't need
 * promotion; archived ones can't earn it. */
export function selectStabilityUpdates(
  consideredFacts: LedgerSnapshotFact[],
  ops: MergeOp[],
): { confirmedIds: string[]; promoteIds: string[] } {
  const touched = new Set(ops.map((op) => op.factId).filter(Boolean) as string[]);
  const confirmed = consideredFacts.filter(
    (f) => f.status === "active" && !f.locked && !touched.has(f.id),
  );
  return {
    confirmedIds: confirmed.map((f) => f.id),
    promoteIds: confirmed
      .filter((f) => !f.canon && f.stability + 1 >= stabilityThresholdFor(f.category))
      .map((f) => f.id),
  };
}

/** Decides, for each extracted fact, what should happen to the ledger —
 * identity is (category, lower(subject), sub_key):
 *   - locked existing row → skip
 *   - existing row, action upsert → update its fact text
 *   - no existing row, action upsert → insert
 *   - existing row, action remove → archive
 *   - no existing row, action remove → skip (nothing to remove)
 * Pure and side-effect free — `runExtraction` below applies the resulting
 * ops through `ledgerRepo`. */
export function mergeExtractedFacts(
  existing: LedgerSnapshotFact[],
  extracted: ExtractedFact[],
): MergeOp[] {
  const subKey = (sk?: string) => (sk ?? "").toLowerCase();
  const findExisting = (category: LedgerCategory, subject: string, sub_key?: string) =>
    existing.find(
      (f) =>
        f.category === category &&
        f.subject.toLowerCase() === subject.toLowerCase() &&
        f.sub_key.toLowerCase() === subKey(sub_key),
    );

  return extracted.map((item): MergeOp => {
    const sub_key = item.sub_key ?? "";
    const match = findExisting(item.category, item.subject, item.sub_key);

    if (item.action === "remove") {
      if (!match) {
        return { kind: "skip", category: item.category, subject: item.subject, sub_key, fact: item.fact, reason: "not-found" };
      }
      if (match.locked) {
        return { kind: "skip", category: item.category, subject: item.subject, sub_key, fact: item.fact, factId: match.id, reason: "locked" };
      }
      if (match.canon) {
        // Soft canon: a single contradicting pass only bumps the streak; the
        // change goes through (with demotion) once the streak runs out.
        if (match.contradictionStreak + 1 < SOFT_CANON_CORRECTION_STREAK) {
          return { kind: "streak", category: item.category, subject: item.subject, sub_key, fact: item.fact, factId: match.id, reason: "soft-canon" };
        }
        return { kind: "archive", category: item.category, subject: item.subject, sub_key, fact: item.fact, factId: match.id, demote: true };
      }
      return { kind: "archive", category: item.category, subject: item.subject, sub_key, fact: item.fact, factId: match.id };
    }

    // action === 'upsert'
    if (!match) {
      return { kind: "insert", category: item.category, subject: item.subject, sub_key, fact: item.fact };
    }
    if (match.locked) {
      return { kind: "skip", category: item.category, subject: item.subject, sub_key, fact: item.fact, factId: match.id, reason: "locked" };
    }
    if (match.canon && match.fact !== item.fact) {
      if (match.contradictionStreak + 1 < SOFT_CANON_CORRECTION_STREAK) {
        return { kind: "streak", category: item.category, subject: item.subject, sub_key, fact: item.fact, factId: match.id, reason: "soft-canon" };
      }
      return { kind: "update", category: item.category, subject: item.subject, sub_key, fact: item.fact, factId: match.id, demote: true };
    }
    if (match.canon) {
      // Same text re-extracted — a confirmation, not a contradiction.
      return { kind: "skip", category: item.category, subject: item.subject, sub_key, fact: item.fact, factId: match.id, reason: "unchanged" };
    }
    return { kind: "update", category: item.category, subject: item.subject, sub_key, fact: item.fact, factId: match.id };
  });
}

// ---- Orchestration (DB + chat_complete) --------------------------------



function formatSnapshot(facts: LedgerSnapshotFact[], summary?: string): string {
  if (facts.length === 0) return "(ledger is empty)";
  const active = facts.filter((f) => f.status === "active");
  const lines = active.map((f) => {
    const key = f.sub_key ? `${f.category}/${f.subject}/${f.sub_key}` : `${f.category}/${f.subject}`;
    return `- (${key}) ${f.fact}${f.locked ? " [LOCKED]" : f.canon ? " [CANON]" : ""}`;
  });
  if (summary) lines.push(summary);
  return lines.join("\n");
}

/** Transcript message with an optional group-chat speaker name (plan §M10)
 * — additive over `ChatMessage` so existing callers still typecheck. */
export type TranscriptChatMessage = ChatMessage & { speakerName?: string | null };

function formatNewMessages(messages: TranscriptChatMessage[]): string {
  return messages
    .map((m) => `${m.speakerName ?? (m.role === "assistant" ? "AI" : "Player")}: ${m.content}`)
    .join("\n");
}

const EXTRACTION_MIN_COSINE = 0.3;

/** Selects facts relevant to the new messages by embedding the messages
 * as a query and keeping only facts whose stored embedding has a cosine
 * similarity > `EXTRACTION_MIN_COSINE`. Locked facts and facts without an
 * embedding yet are always included. Returns the filtered list plus a
 * human-readable summary line for the prompt. Falls back to the full
 * snapshot on any error (never throws per plan §9). */
async function selectRelevantFactsForExtraction(
  chatId: string,
  connection: ConnectionConfig,
  snapshot: LedgerSnapshotFact[],
  newMessages: TranscriptChatMessage[],
): Promise<{ filtered: LedgerSnapshotFact[]; summary: string }> {
  try {
    if (!canEmbed(connection)) return { filtered: snapshot, summary: "" };
    if (snapshot.length === 0) return { filtered: snapshot, summary: "" };

    const queryText = formatNewMessages(newMessages);
    if (!queryText.trim()) return { filtered: snapshot, summary: "" };

    const { vectors } = await embedTexts(connection, [queryText]);
    const queryVec = Float32Array.from(vectors[0]);

    const stored = await listEmbeddings(chatId, "fact");
    const storedByRefId = new Map(stored.map((e) => [e.refId, e]));

    const relevant: LedgerSnapshotFact[] = [];
    const skippedLabels: string[] = [];

    for (const fact of snapshot) {
      if (fact.locked || fact.canon) {
        relevant.push(fact);
        continue;
      }
      const emb = storedByRefId.get(fact.id);
      if (!emb) {
        // Not embedded yet — include by default
        relevant.push(fact);
        continue;
      }
      const score = cosineSimilarity(queryVec, decodeVector(emb.vector));
      if (score > EXTRACTION_MIN_COSINE) {
        relevant.push(fact);
      } else {
        const key = fact.sub_key
          ? `${fact.category}/${fact.subject}/${fact.sub_key}`
          : `${fact.category}/${fact.subject}`;
        skippedLabels.push(`(${key}) ${fact.fact}`);
      }
    }

    const summary =
      skippedLabels.length > 0
        ? `\n(Another ${skippedLabels.length} ledger facts are not relevant to the new messages: ${skippedLabels.slice(0, 4).join("; ")}${skippedLabels.length > 4 ? "…" : ""})`
        : "";

    return { filtered: relevant, summary };
  } catch {
    // Any error → fall back to full snapshot (never throw per plan §9)
    return { filtered: snapshot, summary: "" };
  }
}

/** Runs one extraction pass for a chat: builds the prompt from the current
 * ledger snapshot + the given new messages, calls `chat_complete` on the
 * extraction connection (temperature 0), parses the result, and merges it
 * into the ledger. Never throws — failures are logged and swallowed so a
 * bad extraction never interrupts the game (plan §6.3/§9); the caller
 * (memoryEngine) retries on the next interval. */
export async function runExtraction(
  chatId: string,
  connection: ConnectionConfig,
  newMessages: TranscriptChatMessage[],
  lang?: string,
): Promise<void> {
  try {
    const language = lang ?? "cs";
    const existingRows = await listAllFacts(chatId);
    const snapshot: LedgerSnapshotFact[] = existingRows.map((f) => ({
      id: f.id,
      category: f.category,
      subject: f.subject,
      sub_key: f.sub_key,
      fact: f.fact,
      status: f.status,
      locked: f.locked,
      canon: f.canon,
      contradictionStreak: f.contradictionStreak,
      stability: f.stability,
    }));

    // A6: differential extraction — only send relevant facts to the LLM
    const { filtered, summary } = await selectRelevantFactsForExtraction(
      chatId, connection, snapshot, newMessages,
    );

    const prompt: ChatMessage[] = [
      { role: "system", content: EXTRACTION_SYSTEM_PROMPT(language) },
      {
        role: "user",
        content: `Ledger snapshot:\n${formatSnapshot(filtered, summary)}\n\nNew messages:\n${formatNewMessages(newMessages)}`,
      },
    ];

    const zeroTempConnection: ConnectionConfig = { ...connection, temperature: 0 };
    const raw = await chatComplete(zeroTempConnection, prompt);
    const inputTokens = prompt.reduce((sum, m) => sum + estimateTokens(m.content), 0);
    void logUsage("memory", connection.id, inputTokens, estimateTokens(raw)).catch(() => {});
    const extracted = parseExtractorOutput(raw);

    const ops = mergeExtractedFacts(snapshot, extracted);
    for (const op of ops) {
      if (op.kind === "update" && op.demote && op.factId) {
        // Repeated contradiction won against a soft-canon fact — correct it
        // and demote it back to a normal fact (must re-earn canon).
        await applySoftCanonCorrection(op.factId, op.fact);
      } else if (op.kind === "insert" || op.kind === "update") {
        await applyLedgerUpsert(chatId, op.category, op.subject, op.sub_key, op.fact);
      } else if (op.kind === "archive") {
        if (op.demote && op.factId) await setFactCanon(op.factId, false);
        await applyLedgerRemove(chatId, op.category, op.subject, op.sub_key);
      } else if (op.kind === "streak" && op.factId) {
        await incrementContradictionStreak(op.factId);
      }
      // "skip" ops are no-ops by definition (locked, or nothing to remove).
    }

    // Auto-promotion (M25.5): facts the pass looked at and left unchanged
    // gain stability; crossing the per-category threshold makes them soft
    // canon — fully automatic, the user can demote/unlock in the panel.
    const { confirmedIds, promoteIds } = selectStabilityUpdates(filtered, ops);
    if (confirmedIds.length > 0) await incrementStability(confirmedIds);
    for (const id of promoteIds) {
      await setFactCanon(id, true);
    }
  } catch (err) {
    console.warn("extractor: ledger extraction failed for chat", chatId, err);
  }
}
