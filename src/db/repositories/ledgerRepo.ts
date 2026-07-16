import { execute, newId, nowIso, query } from "../database";
import type { LedgerCategory, LedgerFactLike } from "../../prompt/promptBuilder";

export type { LedgerCategory };

export interface LedgerFact extends LedgerFactLike {
  chatId: string;
  createdAt: string;
  updatedAt: string;
}

interface LedgerFactRow {
  id: string;
  chat_id: string;
  category: LedgerCategory;
  subject: string;
  fact: string;
  status: "active" | "archived";
  locked: number;
  created_at: string;
  updated_at: string;
}

function toFact(row: LedgerFactRow): LedgerFact {
  return {
    id: row.id,
    chatId: row.chat_id,
    category: row.category,
    subject: row.subject,
    fact: row.fact,
    status: row.status,
    locked: row.locked === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** All facts for a chat (active + archived) — the memory panel's "Facts"
 * tab filters client-side. */
export async function listAllFacts(chatId: string): Promise<LedgerFact[]> {
  const rows = await query<LedgerFactRow>(
    "SELECT * FROM ledger_facts WHERE chat_id = $1 ORDER BY category ASC, subject ASC",
    [chatId],
  );
  return rows.map(toFact);
}

/** Only `status = 'active'` facts — what PromptBuilder consumes. */
export async function listActiveFacts(chatId: string): Promise<LedgerFact[]> {
  const rows = await query<LedgerFactRow>(
    "SELECT * FROM ledger_facts WHERE chat_id = $1 AND status = 'active' ORDER BY category ASC, subject ASC",
    [chatId],
  );
  return rows.map(toFact);
}

export interface LedgerFactDraft {
  category: LedgerCategory;
  subject: string;
  fact: string;
  locked?: boolean;
}

/** Manual create from the memory panel — fails (unique constraint) if a
 * fact with the same (chatId, category, subject) already exists; callers
 * should use `upsertFact` from the extractor merge path instead. */
export async function createFact(chatId: string, draft: LedgerFactDraft): Promise<LedgerFact> {
  const id = newId();
  const now = nowIso();
  await execute(
    `INSERT INTO ledger_facts (id, chat_id, category, subject, fact, status, locked, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, $7)`,
    [id, chatId, draft.category, draft.subject, draft.fact, draft.locked ? 1 : 0, now],
  );
  return {
    id,
    chatId,
    category: draft.category,
    subject: draft.subject,
    fact: draft.fact,
    status: "active",
    locked: !!draft.locked,
    createdAt: now,
    updatedAt: now,
  };
}

export interface LedgerFactUpdate {
  category: LedgerCategory;
  subject: string;
  fact: string;
}

/** Manual edit from the memory panel. Does not touch `locked` — use
 * `setFactLocked` for that (keeps intent explicit in the UI). */
export async function updateFact(id: string, patch: LedgerFactUpdate): Promise<void> {
  await execute(
    `UPDATE ledger_facts SET category = $2, subject = $3, fact = $4, updated_at = $5 WHERE id = $1`,
    [id, patch.category, patch.subject, patch.fact, nowIso()],
  );
}

export async function setFactLocked(id: string, locked: boolean): Promise<void> {
  await execute("UPDATE ledger_facts SET locked = $2, updated_at = $3 WHERE id = $1", [
    id,
    locked ? 1 : 0,
    nowIso(),
  ]);
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

/** Fetches a single fact by (chatId, category, subject) case-insensitively
 * on subject — the identity the extractor merges against (plan §6.3). */
export async function findFactBySubject(
  chatId: string,
  category: LedgerCategory,
  subject: string,
): Promise<LedgerFact | null> {
  const rows = await query<LedgerFactRow>(
    `SELECT * FROM ledger_facts WHERE chat_id = $1 AND category = $2 AND lower(subject) = lower($3)`,
    [chatId, category, subject],
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
  fact: string,
): Promise<void> {
  const existing = await findFactBySubject(chatId, category, subject);
  if (existing) {
    if (existing.locked) return;
    await execute(
      `UPDATE ledger_facts SET fact = $2, status = 'active', updated_at = $3 WHERE id = $1`,
      [existing.id, fact, nowIso()],
    );
    return;
  }
  await createFact(chatId, { category, subject, fact });
}

export async function applyLedgerRemove(
  chatId: string,
  category: LedgerCategory,
  subject: string,
): Promise<void> {
  const existing = await findFactBySubject(chatId, category, subject);
  if (!existing || existing.locked) return;
  await setFactStatus(existing.id, "archived");
}
