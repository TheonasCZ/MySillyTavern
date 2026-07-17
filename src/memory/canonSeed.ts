/** Canon seeding (M25.5): when a chat is opened for the first time, one
 * cheap temperature-0 LLM pass distills 3–5 fundamental rules of the story
 * (genre/tone, player limits, world laws) from the character card into the
 * ledger as *soft canon* — so the drift detector has something to guard
 * from message one instead of message one hundred. Runs in the background;
 * a `canon_seed_<chatId>` settings marker makes it strictly one-shot. Never
 * throws (plan §9). */

import { chatComplete } from "../providers/chatComplete";
import type { ChatMessage, ConnectionConfig } from "../providers/types";
import { createFact, listAllFacts, type LedgerCategory } from "../db/repositories/ledgerRepo";
import { getSetting, setSetting } from "../db/repositories/settingsRepo";
import { logUsage } from "../db/repositories/usageRepo";
import { estimateTokens } from "../prompt/tokenEstimate";

export interface SeedRule {
  category: LedgerCategory;
  subject: string;
  fact: string;
}

const VALID_CATEGORIES: LedgerCategory[] = ["player", "world", "npc", "event", "quest"];

function isSeedRule(value: unknown): value is SeedRule {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.category === "string" &&
    VALID_CATEGORIES.includes(v.category as LedgerCategory) &&
    typeof v.subject === "string" &&
    v.subject.trim().length > 0 &&
    typeof v.fact === "string" &&
    v.fact.trim().length > 0
  );
}

/** Tolerant parser, same contract as the extractor's: fences stripped,
 * first `[...]` parsed, invalid entries dropped, capped at 5 rules. */
export function parseSeedOutput(raw: string): SeedRule[] {
  if (!raw) return [];
  const withoutFences = raw.replace(/```[a-zA-Z]*\n?/g, "").replace(/```/g, "");
  const start = withoutFences.indexOf("[");
  const end = withoutFences.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(withoutFences.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(isSeedRule)
    .map((r) => ({ category: r.category, subject: r.subject.trim(), fact: r.fact.trim() }))
    .slice(0, 5);
}

const SEED_SYSTEM_PROMPT =
  "Jsi analytický nástroj. Z karty postavy pro RP hru vytáhni 3–5 ZÁKLADNÍCH PRAVIDEL " +
  "příběhu, která se nesmí během hry nepozorovaně změnit: žánr a tón světa (subjekt " +
  "'Žánr a tón světa', kategorie world), schopnosti a LIMITY hráčovy role (kategorie player), " +
  "případně klíčové zákony světa (kategorie world). Piš je jako krátká závazná tvrzení. " +
  'Vrať POUZE JSON pole objektů {"category": "world"|"player"|"npc", "subject": string, ' +
  '"fact": string}. Žádný text mimo JSON pole.';

export interface SeedCharacterLike {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  systemPrompt: string;
}

const seedKey = (chatId: string) => `canon_seed_${chatId}`;

/** Seeds soft-canon rules for a fresh chat. One-shot per chat (marker set
 * even on failure-free empty results so we don't re-bill every open); skips
 * silently when the ledger already has facts (imported/branched chats). */
export async function runCanonSeed(
  chatId: string,
  connection: ConnectionConfig,
  character: SeedCharacterLike,
): Promise<void> {
  try {
    if (await getSetting(seedKey(chatId))) return;
    // Mark first — a concurrent second open must not double-seed.
    await setSetting(seedKey(chatId), "done");

    const existing = await listAllFacts(chatId);
    if (existing.length > 0) return;

    const card = [
      `Jméno: ${character.name}`,
      character.description && `Popis: ${character.description}`,
      character.personality && `Osobnost: ${character.personality}`,
      character.scenario && `Scénář: ${character.scenario}`,
      character.systemPrompt && `Instrukce: ${character.systemPrompt}`,
    ]
      .filter(Boolean)
      .join("\n");
    if (card.trim().length < 40) return; // nothing substantial to distill

    const prompt: ChatMessage[] = [
      { role: "system", content: SEED_SYSTEM_PROMPT },
      { role: "user", content: card },
    ];
    const zeroTemp: ConnectionConfig = { ...connection, temperature: 0 };
    const raw = await chatComplete(zeroTemp, prompt);
    const inputTokens = prompt.reduce((sum, m) => sum + estimateTokens(m.content), 0);
    void logUsage("memory", connection.id, inputTokens, estimateTokens(raw)).catch(() => {});

    for (const rule of parseSeedOutput(raw)) {
      try {
        await createFact(chatId, { ...rule, canon: true });
      } catch {
        // unique-constraint clash (duplicate subject) — skip, not fatal
      }
    }
  } catch (err) {
    console.warn("canon seed failed", err);
  }
}
