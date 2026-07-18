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
import { SEED_SYSTEM_PROMPT } from "../prompt/promptTexts";

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
  lang?: string,
): Promise<void> {
  try {
    if (await getSetting(seedKey(chatId))) return;
    // Mark first — a concurrent second open must not double-seed.
    await setSetting(seedKey(chatId), "done");

    const existing = await listAllFacts(chatId);
    if (existing.length > 0) return;

    const language = lang ?? "cs";

    const card = [
      `Name: ${character.name}`,
      character.description && `Description: ${character.description}`,
      character.personality && `Personality: ${character.personality}`,
      character.scenario && `Scenario: ${character.scenario}`,
      character.systemPrompt && `Instructions: ${character.systemPrompt}`,
    ]
      .filter(Boolean)
      .join("\n");
    if (card.trim().length < 40) return; // nothing substantial to distill

    const prompt: ChatMessage[] = [
      { role: "system", content: SEED_SYSTEM_PROMPT(language) },
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
    console.warn("canonSeed: seeding failed for chat", chatId, err);
  }
}
