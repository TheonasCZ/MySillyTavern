/** PromptBuilder (plan §6.2). Pure module — no DB/Tauri imports — so it can
 * be unit-tested with vitest without booting the Tauri runtime. Callers
 * (chatStore) load the character/persona/ledger/summary/lore data via the
 * repositories and pass plain, already-resolved data in.
 *
 * Composes, in order:
 *   1. system: character system_prompt (or default RP instructions) +
 *      description + personality + scenario + mes_example + persona
 *   2. `[FAKTA SVĚTA — závazná]`: active ledger facts grouped by category
 *   3. activated lorebook entries (already priority-ordered by the caller)
 *   4. `[DOSAVADNÍ PŘÍBĚH]`: running summary
 *   5. the last `verbatimWindow` messages of history, verbatim, followed by
 *      `post_history_instructions` as a trailing system message
 *
 * When the estimated token total exceeds `contextBudget`, trims in this
 * order until it fits (or the step is exhausted): (a) lore entries from
 * lowest priority, (b) older verbatim messages (never below 4 most
 * recent), (c) summary text from its start, (d) ledger facts
 * event → quest → npc (world/player are never trimmed), (e) mes_example.
 * The system core (system_prompt/description/personality/scenario/persona)
 * and the most recent messages are never trimmed. */

import type { LoreEntryLike } from "../lorebooks/activation";
import { estimateTokens } from "./tokenEstimate";

export interface CharacterLike {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  systemPrompt: string;
  postHistoryInstructions: string;
  mesExample: string;
}

export interface PersonaLike {
  name: string;
  description: string;
}

export type LedgerCategory = "player" | "world" | "npc" | "event" | "quest";

export interface LedgerFactLike {
  id: string;
  category: LedgerCategory;
  subject: string;
  fact: string;
  status: "active" | "archived";
  locked: boolean;
}

export interface PromptMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface PromptBuilderInput {
  character: CharacterLike;
  persona: PersonaLike | null;
  /** Ledger facts for the chat — only `status === 'active'` ones are
   * rendered; archived rows are ignored (caller may pass the whole table,
   * or pre-filter — either works). */
  ledgerFacts: LedgerFactLike[];
  summary: string | null;
  /** Already activation-scanned & priority-sorted lorebook entries (see
   * `lorebooks/activation.ts`). PromptBuilder only trims this list further
   * when the overall budget is tight — it does not re-run the scan. */
  loreEntries: LoreEntryLike[];
  /** Full chat history, oldest → newest, user/assistant only (no system
   * rows) — PromptBuilder takes the tail itself per `verbatimWindow`. */
  history: PromptMessage[];
  contextBudget: number;
  /** Default 20 (`verbatim_window` setting). */
  verbatimWindow?: number;
}

export interface PromptReport {
  estimatedTokens: number;
  budget: number;
  overBudget: boolean;
  sections: {
    systemTokens: number;
    factsTokens: number;
    factsIncluded: number;
    factsTotal: number;
    loreTokens: number;
    loreIncluded: number;
    loreTotal: number;
    summaryTokens: number;
    summaryIncluded: boolean;
    summaryTruncated: boolean;
    historyTokens: number;
    historyMessagesIncluded: number;
    historyMessagesTotal: number;
    mesExampleIncluded: boolean;
  };
  /** Human/UI-readable list of what got cut, in the order it was cut —
   * shown verbatim in the memory panel's "Prompt" tab. */
  trimmedNotes: string[];
}

export interface PromptBuildResult {
  messages: PromptMessage[];
  report: PromptReport;
}

export const DEFAULT_VERBATIM_WINDOW = 20;
export const MIN_VERBATIM_MESSAGES = 4;

const DEFAULT_RP_INSTRUCTIONS =
  "Jsi vypravěč hry na hrdiny (RP). Hraj roli postavy {{char}} podle popisu níže, " +
  "drž se jejího charakteru a scénáře. Akce a gesta piš kurzívou, přímou řeč normálně. " +
  "Nikdy nemluv ani nejednej za hráče ({{user}}).";

export const DEFAULT_USER_NAME = "User";

export function personaDisplayName(persona: PersonaLike | null): string {
  return persona?.name.trim() || DEFAULT_USER_NAME;
}

/** Replaces `{{char}}`/`{{user}}` placeholders (case-insensitive) anywhere
 * in `text`. */
export function substitutePlaceholders(text: string, charName: string, userName: string): string {
  return text.replace(/\{\{char\}\}/gi, charName).replace(/\{\{user\}\}/gi, userName);
}

const FACT_CATEGORY_ORDER: LedgerCategory[] = ["world", "player", "npc", "quest", "event"];
/** Categories trimmed under budget pressure, in the order they're cut.
 * `world`/`player` never appear here — they're never trimmed. */
const TRIMMABLE_FACT_CATEGORIES: LedgerCategory[] = ["event", "quest", "npc"];

// ---- Section builders ---------------------------------------------------

function buildSystemCore(character: CharacterLike, persona: PersonaLike | null, userName: string): string {
  const base = character.systemPrompt.trim() || DEFAULT_RP_INSTRUCTIONS;
  const parts = [base, character.description, character.personality, character.scenario].map((p) =>
    p.trim(),
  );
  const personaDescription = persona?.description.trim();
  if (personaDescription) {
    parts.push(`[Hráčova persona — ${userName}]\n${personaDescription}`);
  }
  return substitutePlaceholders(parts.filter(Boolean).join("\n\n"), character.name, userName);
}

function buildMesExampleSection(character: CharacterLike, charName: string, userName: string): string {
  const trimmed = character.mesExample.trim();
  if (!trimmed) return "";
  return `[Ukázka stylu dialogu]\n${substitutePlaceholders(trimmed, charName, userName)}`;
}

function factLine(fact: LedgerFactLike, charName: string, userName: string): string {
  return `- (${fact.category}/${substitutePlaceholders(fact.subject, charName, userName)}) ${substitutePlaceholders(fact.fact, charName, userName)}`;
}

function buildFactsSection(facts: LedgerFactLike[], charName: string, userName: string): string {
  if (facts.length === 0) return "";
  const ordered = FACT_CATEGORY_ORDER.flatMap((cat) => facts.filter((f) => f.category === cat));
  const lines = ordered.map((f) => factLine(f, charName, userName));
  return `[FAKTA SVĚTA — závazná]\n${lines.join("\n")}`;
}

function buildLoreSection(entries: LoreEntryLike[], charName: string, userName: string): string {
  if (entries.length === 0) return "";
  const lines = entries.map((e) => `- ${substitutePlaceholders(e.content.trim(), charName, userName)}`);
  return `[Poznámky ze světa — lorebook]\n${lines.join("\n")}`;
}

function buildSummarySection(summary: string): string {
  if (!summary.trim()) return "";
  return `[DOSAVADNÍ PŘÍBĚH]\n${summary.trim()}`;
}

function assembleSystemMessage(sections: string[]): string {
  return sections.filter(Boolean).join("\n\n");
}

// ---- Main builder ---------------------------------------------------

export function buildPrompt(input: PromptBuilderInput): PromptBuildResult {
  const { character, persona } = input;
  const userName = personaDisplayName(persona);
  const charName = character.name;
  const verbatimWindow = input.verbatimWindow ?? DEFAULT_VERBATIM_WINDOW;
  const budget = input.contextBudget;
  const trimmedNotes: string[] = [];

  const activeFacts = input.ledgerFacts.filter((f) => f.status === "active");
  const factsTotal = activeFacts.length;

  // Mutable working state for the trim passes below.
  let lore = [...input.loreEntries].sort((a, b) => a.priority - b.priority); // ascending: index 0 = lowest priority = first to cut
  let facts = [...activeFacts];
  let summaryText = (input.summary ?? "").trim();
  let summaryTruncated = false;
  let mesExampleIncluded = character.mesExample.trim().length > 0;

  const historyTotal = input.history.length;
  let historyIncluded = input.history.slice(-verbatimWindow);

  const systemCore = buildSystemCore(character, persona, userName);
  const systemCoreTokens = estimateTokens(systemCore);

  function render(): { messages: PromptMessage[]; totalTokens: number; sectionsTokens: ReturnType<typeof sectionTokens> } {
    const mesExampleSection = mesExampleIncluded ? buildMesExampleSection(character, charName, userName) : "";
    const factsSection = buildFactsSection(facts, charName, userName);
    const loreSectionEntries = [...lore].sort((a, b) => b.priority - a.priority);
    const loreSection = buildLoreSection(loreSectionEntries, charName, userName);
    const summarySection = buildSummarySection(summaryText);

    const systemText = assembleSystemMessage([
      systemCore,
      mesExampleSection,
      factsSection,
      loreSection,
      summarySection,
    ]);

    const messages: PromptMessage[] = [];
    if (systemText) messages.push({ role: "system", content: systemText });
    for (const m of historyIncluded) messages.push(m);
    const phi = character.postHistoryInstructions.trim();
    if (phi) {
      messages.push({ role: "system", content: substitutePlaceholders(phi, charName, userName) });
    }

    const sectionsTok = sectionTokens(systemCore, mesExampleSection, factsSection, loreSection, summarySection, historyIncluded, phi);
    const totalTokens = sectionsTok.systemTokens + sectionsTok.factsTokens + sectionsTok.loreTokens +
      sectionsTok.summaryTokens + sectionsTok.historyTokens;

    return { messages, totalTokens, sectionsTokens: sectionsTok };
  }

  function sectionTokens(
    core: string,
    mesExample: string,
    factsSection: string,
    loreSection: string,
    summarySection: string,
    history: PromptMessage[],
    phi: string,
  ) {
    return {
      systemTokens: estimateTokens(core) + estimateTokens(mesExample),
      factsTokens: estimateTokens(factsSection),
      loreTokens: estimateTokens(loreSection),
      summaryTokens: estimateTokens(summarySection),
      historyTokens: history.reduce((sum, m) => sum + estimateTokens(m.content), 0) + estimateTokens(phi),
    };
  }

  let current = render();

  // (a) trim lore, lowest priority first.
  while (current.totalTokens > budget && lore.length > 0) {
    const removed = lore.shift();
    if (removed) trimmedNotes.push(`Lorebook: vynechán záznam „${removed.id}" (nízká priorita, rozpočet kontextu).`);
    current = render();
  }

  // (b) trim older verbatim messages, never below MIN_VERBATIM_MESSAGES.
  while (current.totalTokens > budget && historyIncluded.length > MIN_VERBATIM_MESSAGES) {
    historyIncluded = historyIncluded.slice(1);
    trimmedNotes.push("Historie: vynechána starší zpráva (rozpočet kontextu).");
    current = render();
  }

  // (c) trim summary from its start.
  while (current.totalTokens > budget && summaryText.length > 0) {
    const excessTokens = current.totalTokens - budget;
    const cutChars = Math.max(40, Math.min(summaryText.length, excessTokens * 4));
    summaryText = summaryText.slice(cutChars).trim();
    summaryTruncated = true;
    current = render();
  }
  if (summaryTruncated) {
    trimmedNotes.push("Shrnutí: zkráceno od začátku (rozpočet kontextu).");
  }

  // (d) trim facts event -> quest -> npc (world/player never touched).
  for (const cat of TRIMMABLE_FACT_CATEGORIES) {
    while (current.totalTokens > budget && facts.some((f) => f.category === cat)) {
      const idx = facts.findIndex((f) => f.category === cat);
      const [removed] = facts.splice(idx, 1);
      trimmedNotes.push(`Fakta: vynechán fakt „(${removed.category}/${removed.subject})" (rozpočet kontextu).`);
      current = render();
    }
    if (current.totalTokens <= budget) break;
  }

  // (e) drop mes_example entirely, last resort.
  if (current.totalTokens > budget && mesExampleIncluded) {
    mesExampleIncluded = false;
    trimmedNotes.push("Ukázka stylu dialogu: vynechána (rozpočet kontextu).");
    current = render();
  }

  const report: PromptReport = {
    estimatedTokens: current.totalTokens,
    budget,
    overBudget: current.totalTokens > budget,
    sections: {
      systemTokens: systemCoreTokens,
      factsTokens: current.sectionsTokens.factsTokens,
      factsIncluded: facts.length,
      factsTotal,
      loreTokens: current.sectionsTokens.loreTokens,
      loreIncluded: lore.length,
      loreTotal: input.loreEntries.length,
      summaryTokens: current.sectionsTokens.summaryTokens,
      summaryIncluded: summaryText.length > 0,
      summaryTruncated,
      historyTokens: current.sectionsTokens.historyTokens,
      historyMessagesIncluded: historyIncluded.length,
      historyMessagesTotal: historyTotal,
      mesExampleIncluded,
    },
    trimmedNotes,
  };

  return { messages: current.messages, report };
}
