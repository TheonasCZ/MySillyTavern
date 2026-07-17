import { execute, newId, nowIso, query } from "../database";
import type { LedgerCategory, LedgerFactLike } from "../../prompt/promptBuilder";

export type { LedgerCategory };

export interface LedgerFact extends LedgerFactLike {
  imagePath: string | null;
  chatId: string;
  /** Soft canon flag (M25.5) — auto-promoted; `locked` stays the hard lock. */
  canon: boolean;
  /** Consecutive extraction passes that confirmed this fact unchanged. */
  stability: number;
  /** Consecutive passes the extractor tried to change a soft-canon fact —
   * at 2 the correction goes through and the fact is demoted. */
  contradictionStreak: number;
  createdAt: string;
  updatedAt: string;
}

interface LedgerFactRow {
  id: string;
  chat_id: string;
  category: LedgerCategory;
  subject: string;
  sub_key: string;
  fact: string;
  status: "active" | "archived";
  locked: number;
  canon: number;
  stability: number;
  contradiction_streak: number;
  image_path: string | null;
  created_at: string;
  updated_at: string;
}

function toFact(row: LedgerFactRow): LedgerFact {
  return {
    id: row.id,
    chatId: row.chat_id,
    category: row.category,
    subject: row.subject,
    sub_key: row.sub_key,
    fact: row.fact,
    status: row.status,
    locked: row.locked === 1,
    canon: row.canon === 1,
    stability: row.stability ?? 0,
    contradictionStreak: row.contradiction_streak ?? 0,
    imagePath: row.image_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** All facts for a chat (active + archived) — the memory panel's "Facts"
 * tab filters client-side. */
export async function listAllFacts(chatId: string): Promise<LedgerFact[]> {
  const rows = await query<LedgerFactRow>(
    "SELECT * FROM ledger_facts WHERE chat_id = $1 ORDER BY category ASC, subject ASC, sub_key ASC",
    [chatId],
  );
  return rows.map(toFact);
}

/** Only `status = 'active'` facts — what PromptBuilder consumes. */
export async function listActiveFacts(chatId: string): Promise<LedgerFact[]> {
  const rows = await query<LedgerFactRow>(
    "SELECT * FROM ledger_facts WHERE chat_id = $1 AND status = 'active' ORDER BY category ASC, subject ASC, sub_key ASC",
    [chatId],
  );
  return rows.map(toFact);
}

export interface LedgerFactDraft {
  category: LedgerCategory;
  subject: string;
  sub_key?: string;
  fact: string;
  locked?: boolean;
  canon?: boolean;
}

/** Manual create from the memory panel — fails (unique constraint) if a
 * fact with the same (chatId, category, subject) already exists; callers
 * should use `upsertFact` from the extractor merge path instead. */
export async function createFact(chatId: string, draft: LedgerFactDraft): Promise<LedgerFact> {
  const id = newId();
  const now = nowIso();
  await execute(
    `INSERT INTO ledger_facts (id, chat_id, category, subject, sub_key, fact, status, locked, canon, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, $8, $9, $9)`,
    [id, chatId, draft.category, draft.subject, draft.sub_key ?? '', draft.fact, draft.locked ? 1 : 0, draft.canon ? 1 : 0, now],
  );
  return {
    id,
    chatId,
    category: draft.category,
    subject: draft.subject,
    sub_key: draft.sub_key ?? '',
    fact: draft.fact,
    status: "active",
    locked: !!draft.locked,
    canon: !!draft.canon,
    stability: 0,
    contradictionStreak: 0,
    imagePath: null,
    createdAt: now,
    updatedAt: now,
  };
}

export interface LedgerFactUpdate {
  category: LedgerCategory;
  subject: string;
  sub_key?: string;
  fact: string;
}

/** Manual edit from the memory panel. Does not touch `locked` — use
 * `setFactLocked` for that (keeps intent explicit in the UI). */
export async function updateFact(id: string, patch: LedgerFactUpdate): Promise<void> {
  await execute(
    `UPDATE ledger_facts SET category = $2, subject = $3, sub_key = $4, fact = $5, updated_at = $6 WHERE id = $1`,
    [id, patch.category, patch.subject, patch.sub_key ?? '', patch.fact, nowIso()],
  );
}

export async function getFact(id: string): Promise<LedgerFact | null> {
  const rows = await query<LedgerFactRow>(
    "SELECT * FROM ledger_facts WHERE id = $1",
    [id],
  );
  return rows[0] ? toFact(rows[0]) : null;
}

export async function setFactImage(id: string, imagePath: string): Promise<void> {
  await execute(
    "UPDATE ledger_facts SET image_path = $2, updated_at = $3 WHERE id = $1",
    [id, imagePath, nowIso()],
  );
}

export async function setFactLocked(id: string, locked: boolean): Promise<void> {
  await execute("UPDATE ledger_facts SET locked = $2, updated_at = $3 WHERE id = $1", [
    id,
    locked ? 1 : 0,
    nowIso(),
  ]);

  // Auto-illustration trigger: enqueue when locking a fact that has no image yet.
  if (locked) {
    const fact = await getFact(id);
    if (fact && !fact.imagePath) {
      const { enqueueIllustration } = await import("../../memory/imageGenQueue");
      enqueueIllustration("fact", id, `Fantasy illustration: ${fact.fact}`);
    }
  }
}

/** Sets/clears the soft-canon flag (M25.5). Clearing also resets the
 * stability counter so the fact has to re-earn its promotion. */
export async function setFactCanon(id: string, canon: boolean): Promise<void> {
  await execute(
    canon
      ? "UPDATE ledger_facts SET canon = 1, contradiction_streak = 0, updated_at = $2 WHERE id = $1"
      : "UPDATE ledger_facts SET canon = 0, stability = 0, contradiction_streak = 0, updated_at = $2 WHERE id = $1",
    [id, nowIso()],
  );
}

/** Bulk stability bump for facts an extraction pass confirmed unchanged;
 * also resets their contradiction streaks (a clean pass ends a streak). */
export async function incrementStability(ids: string[]): Promise<void> {
  const now = nowIso();
  for (const id of ids) {
    await execute(
      "UPDATE ledger_facts SET stability = stability + 1, contradiction_streak = 0, updated_at = $2 WHERE id = $1",
      [id, now],
    );
  }
}

export async function incrementContradictionStreak(id: string): Promise<void> {
  await execute(
    "UPDATE ledger_facts SET contradiction_streak = contradiction_streak + 1, updated_at = $2 WHERE id = $1",
    [id, nowIso()],
  );
}

/** Applies a correction to a soft-canon fact (repeated contradiction won):
 * new text, demoted out of canon, counters reset — it must re-earn the
 * promotion through fresh stability. */
export async function applySoftCanonCorrection(id: string, fact: string): Promise<void> {
  await execute(
    `UPDATE ledger_facts SET fact = $2, canon = 0, stability = 0, contradiction_streak = 0, status = 'active', updated_at = $3 WHERE id = $1`,
    [id, fact, nowIso()],
  );
}

export async function setFactStatus(id: string, status: "active" | "archived"): Promise<void> {
  await execute("UPDATE ledger_facts SET status = $2, updated_at = $3 WHERE id = $1", [
    id,
    status,
    nowIso(),
  ]);
}

export async function deleteFact(id: string): Promise<void> {
  await execute("DELETE FROM ledger_facts WHERE id = $1", [id]);
}

/** Fetches a single fact by (chatId, category, subject, sub_key)
 * case-insensitively on subject — the identity the extractor merges
 * against (plan §6.3). */
export async function findFactBySubject(
  chatId: string,
  category: LedgerCategory,
  subject: string,
  sub_key?: string,
): Promise<LedgerFact | null> {
  const rows = await query<LedgerFactRow>(
    `SELECT * FROM ledger_facts WHERE chat_id = $1 AND category = $2 AND lower(subject) = lower($3) AND sub_key = $4`,
    [chatId, category, subject, sub_key ?? ''],
  );
  return rows[0] ? toFact(rows[0]) : null;
}

/** Applies one extractor merge action against the DB. Pure decision logic
 * lives in `memory/extractor.ts` (`decideMergeAction`, unit-tested) — this
 * is just the persistence step, kept in the repository per the app's
 * DB-access convention. */
export async function applyLedgerUpsert(
  chatId: string,
  category: LedgerCategory,
  subject: string,
  sub_key: string,
  fact: string,
): Promise<void> {
  const existing = await findFactBySubject(chatId, category, subject, sub_key);
  if (existing) {
    if (existing.locked) return;
    await execute(
      `UPDATE ledger_facts SET fact = $2, status = 'active', updated_at = $3 WHERE id = $1`,
      [existing.id, fact, nowIso()],
    );
    return;
  }
  await createFact(chatId, { category, subject, sub_key, fact });
}

export async function applyLedgerRemove(
  chatId: string,
  category: LedgerCategory,
  subject: string,
  sub_key: string,
): Promise<void> {
  const existing = await findFactBySubject(chatId, category, subject, sub_key);
  if (!existing || existing.locked) return;
  await setFactStatus(existing.id, "archived");
}
