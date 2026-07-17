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
 *      `post_history_instructions` + a `[Připomínka kánonu]` reminder of the
 *      world/player facts, as a trailing system message
 *
 * When the estimated token total exceeds `contextBudget`, trims in this
 * order until it fits (or the step is exhausted): (a0) retrieved memories
 * from least relevant, (a) lore entries from
 * lowest priority, (b) older verbatim messages (never below 4 most
 * recent), (c) summary text from its start, (d) ledger facts
 * event → quest → npc (world/player are never trimmed), (e) mes_example.
 * The system core (system_prompt/description/personality/scenario/persona)
 * and the most recent messages are never trimmed. Nor is the trailing
 * `[Připomínka kánonu]` block — it repeats the never-trimmed world/player
 * facts right before generation (where models weigh instructions most
 * heavily) as a defense against genre/canon drift over long chats; it is
 * only size-capped at build time, never cut under budget pressure. */

import type { LoreEntryLike } from "../lorebooks/activation";
import type { ConnectionConfig } from "../providers/types";
import { cosineSimilarity } from "../memory/vector";
import { estimateTokens } from "./tokenEstimate";
import { syncCountTokens } from "./tokenCounter";

export interface CharacterLike {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  systemPrompt: string;
  postHistoryInstructions: string;
  mesExample: string;
}

export interface FactionRepLike {
  factionName: string;
  reputation: number;
}

export interface CraftingRecipeLike {
  resultItem: string;
  ingredients: string[];
  skillName: string | null;
  tier: number;
  perks: string[];
  craftedAt: string | null;
}

export interface PersonaLike {
  name: string;
  description: string;
  gender?: string;
  age?: number | null;
  race?: string;
  appearance?: string;
  progression?: "skill" | "level" | "none";
  xp?: number;
  level?: number;
  skills?: Array<{ name: string; level: number }>;
  inventory?: Array<{ item: string; qty: number; note?: string }>;
  /** Current faction standings for this persona. */
  factions?: FactionRepLike[];
  /** Known crafting recipes for this persona. */
  craftingRecipes?: CraftingRecipeLike[];
}

export type LedgerCategory = "player" | "world" | "npc" | "event" | "quest";

export interface LedgerFactLike {
  id: string;
  category: LedgerCategory;
  subject: string;
  sub_key: string;
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
  /** Optional semantic relevance per fact id (cosine similarity from
   * `memory/embeddingsEngine.ts`). When present, the fact-trimming pass
   * cuts the *least relevant* fact within each trimmable category instead
   * of the first one found; facts missing from the map are cut first. */
  factRelevance?: Record<string, number>;
  /** Semantically retrieved older scenes (most relevant first) — rendered
   * as `[RELEVANTNÍ VZPOMÍNKY]` after the summary. Trimmed before anything
   * else under budget pressure, least relevant (last) first. */
  retrievedMemories?: string[];
  /** Group-chat only (plan §4): the *other* members in the scene — never
   * includes `character` itself, which is always the speaker. Rendered as
   * `[Další postavy ve scéně]` in the system core and adds a
   * "speak only as {{char}}" instruction near post_history_instructions.
   * Omitting this field (the solo-chat case) leaves the output unchanged. */
  groupMembers?: Array<{ name: string; description: string }>;
  /** Connection whose model selects the best available token counter
   * (tiktoken for OpenAI, etc.). When absent, falls back to the rough
   * `estimateTokens` chars-per-token approximation. */
  connection?: ConnectionConfig;
  /** Optional pre-decoded fact embedding vectors (fact id → raw f32 array).
   * When present, enables MMR-based diversity selection during fact
   * trimming instead of the simple least-relevance-first cut.  Callers
   * (e.g. chatStore) decode the base64 vectors once and pass them here so
   * PromptBuilder stays pure (no DB/Tauri imports). */
  factVectors?: Record<string, number[]>;
  /** Current game-time description from `memory/gameTime.ts`, rendered as a
   * `[PRÁVĚ TEĎ]` block right before the canon reminder. Small enough
   * (~50 tokens) to not stress the budget. */
  gameTimeDescription?: string;
  /** Current calendar date + season effects from `memory/calendar.ts`,
   * rendered as a `[DNEŠNÍ DATUM]` block before `[PRÁVĚ TEĎ]`. Includes
   * season effect hints and `[TIME:+1d]` tag instructions for the model. */
  calendarDateDescription?: string;
  /** Current mood facts from `memory/emotions.ts`, keyed by character name.
   * When `groupMembers` are present, the mood is appended to each member's
   * description line (e.g. `- Eliška (nálada: vyděšená): ...`). */
  moodFacts?: Array<{ subject: string; fact: string }>;
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
    memoriesTokens: number;
    memoriesIncluded: number;
    memoriesTotal: number;
    historyTokens: number;
    historyMessagesIncluded: number;
    historyMessagesTotal: number;
    mesExampleIncluded: boolean;
    /** Tokens spent on the end-of-context `[Připomínka kánonu]` block (0 when
     * there are no world/player facts). Always rendered when non-empty —
     * never trimmed under budget pressure, only size-capped at build time
     * (see `buildCanonReminderSection`). */
    canonReminderTokens: number;
    /** Number of other group members rendered in `[Další postavy ve scéně]`.
     * Only present for group-chat builds (`input.groupMembers` given). */
    groupMembersIncluded?: number;
    /** The full assembled system prompt text (system core + sections). */
    systemText: string;
    /** The verbatim history messages concatenated as "role: content\n". */
    historyText: string;
    /** The trailing system message (post_history_instructions + canon reminder + group speaker instruction). */
    phiText: string;
  };
  /** Human/UI-readable list of what got cut, in the order it was cut —
   * shown verbatim in the memory panel's "Prompt" tab. */
  trimmedNotes: string[];
}

export interface PromptBuildResult {
  messages: PromptMessage[];
  report: PromptReport;
}

export const DEFAULT_VERBATIM_WINDOW = 6;
export const MIN_VERBATIM_MESSAGES = 4;

const DEFAULT_RP_INSTRUCTIONS =
  "Jsi vypravěč hry na hrdiny (RP). Hraj roli postavy {{char}} podle popisu níže, " +
  "drž se jejího charakteru a scénáře. Akce a gesta piš kurzívou, přímou řeč normálně. " +
  "Nikdy nemluv ani nejednej za hráče ({{user}}). Drž konzistenci žánru a pravidel světa " +
  "tak, jak byla zavedena — nepovoluj hráči schopnosti, moc ani vybavení nad rámec " +
  "zavedených pravidel a nenech herní žánr nebo tón postupně driftovat k něčemu jinému.";

export const DEFAULT_USER_NAME = "User";

/** Maps a numeric reputation (-100..100) to a Czech label for the prompt. */
function factionLabel(rep: number): string {
  if (rep <= -50) return "nepřátelská";
  if (rep <= -20) return "podezřívavá";
  if (rep >= 50) return "spojenecká";
  if (rep >= 20) return "přátelská";
  return "neutrální";
}

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

/** Categories reinforced in the end-of-context canon reminder — the
 * world/player facts that most directly guard against genre/power drift
 * (see `buildCanonReminderSection`). Same set as the never-trimmed
 * categories above, by design: what's too important to cut is also
 * important enough to repeat where the model weighs it most. */
const CANON_REMINDER_CATEGORIES: LedgerCategory[] = ["world", "player"];
/** Soft cap on the reminder block's size (~600 tokens at 4 chars/token).
 * Long-running chats can accumulate many world/player facts; this keeps the
 * reinforcement compact rather than repeating the entire ledger. Locked
 * facts (explicitly pinned by the user as canon) are kept first so they
 * survive the cap before unlocked ones. */
const CANON_REMINDER_MAX_CHARS = 2400;

// ---- Section builders ---------------------------------------------------

const GROUP_MEMBER_DESCRIPTION_MAX_LEN = 500;

function buildGroupMembersSection(
  groupMembers: Array<{ name: string; description: string }>,
  moodFacts: Array<{ subject: string; fact: string }>,
): string {
  if (groupMembers.length === 0) return "";
  const moodMap = new Map<string, string>();
  for (const mf of moodFacts) {
    if (!moodMap.has(mf.subject)) moodMap.set(mf.subject, mf.fact);
  }
  const lines = groupMembers.map((m) => {
    const desc = m.description.length > GROUP_MEMBER_DESCRIPTION_MAX_LEN
      ? `${m.description.slice(0, GROUP_MEMBER_DESCRIPTION_MAX_LEN)}…`
      : m.description;
    const mood = moodMap.get(m.name);
    const moodSuffix = mood ? ` (nálada: ${mood})` : "";
    return `- ${m.name}${moodSuffix}: ${desc}`;
  });
  return `[Další postavy ve scéně]\n${lines.join("\n")}`;
}

function buildSystemCore(
  character: CharacterLike,
  persona: PersonaLike | null,
  userName: string,
  groupMembers: Array<{ name: string; description: string }>,
  moodFacts: Array<{ subject: string; fact: string }>,
): string {
  const base = character.systemPrompt.trim() || DEFAULT_RP_INSTRUCTIONS;
  const parts = [base, character.description, character.personality, character.scenario].map((p) =>
    p.trim(),
  );
  if (persona) {
    const personaLines: string[] = [];
    const identity: string[] = [];
    if (persona.gender) identity.push(persona.gender);
    if (persona.age) identity.push(`${persona.age} let`);
    if (persona.race) identity.push(persona.race);
    if (identity.length > 0) personaLines.push(identity.join(", "));
    if (persona.appearance) personaLines.push(`\nVzhled: ${persona.appearance}`);
    if (persona.skills?.length) {
      personaLines.push("\nDovednosti:");
      for (const s of persona.skills) personaLines.push(`- ${s.name} (úroveň ${s.level})`);
    }
    if (persona.inventory?.length) {
      personaLines.push("\nInventář:");
      for (const inv of persona.inventory) {
        personaLines.push(`- ${inv.item}${inv.qty > 1 ? ` x${inv.qty}` : ""}`);
      }
    }
    if (persona.factions?.length) {
      personaLines.push("\nReputace u frakcí:");
      for (const f of persona.factions) {
        const label = factionLabel(f.reputation);
        personaLines.push(`- ${f.factionName}: ${f.reputation} (${label})`);
      }
    }
    if (personaLines.length > 0) {
      parts.push(`[Hráčova persona — ${userName}]\n${personaLines.join("\n")}`);
    }
  }
  const groupSection = buildGroupMembersSection(groupMembers, moodFacts);
  if (groupSection) parts.push(groupSection);
  return substitutePlaceholders(parts.filter(Boolean).join("\n\n"), character.name, userName);
}

/** "Speak only as {{char}}" instruction added in group chats (plan §4) —
 * appended to post_history_instructions, or sent as its own trailing
 * system message when the card has none. */
function buildGroupSpeakerInstruction(otherNames: string[]): string {
  const names = otherNames.join(", ");
  return (
    "Mluv a jednej pouze za {{char}}. Nikdy nemluv za hráče ({{user}}) ani za ostatní postavy " +
    `(${names}). Nezačínej odpověď svým jménem s dvojtečkou.`
  );
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

/** Builds the end-of-context canon reminder (plan: memory-anchoring fix) —
 * a compact restatement of the `world`/`player` ledger facts, meant to be
 * appended to the trailing post-history system message. Long system
 * messages bury the `[FAKTA SVĚTA]` block far from the end of the context
 * window, where models (especially smaller/faster ones) weigh instructions
 * the least; repeating the load-bearing facts right before generation
 * counteracts that recency bias. Locked facts sort first (the user has
 * explicitly pinned them as immutable canon); the block is capped at
 * `CANON_REMINDER_MAX_CHARS` rather than trimmed under budget pressure —
 * callers that need to save tokens should lock/curate fewer facts, not
 * silently lose the reminder. Returns "" when there are no world/player
 * facts to remind the model of. */
function buildCanonReminderSection(facts: LedgerFactLike[], charName: string, userName: string): string {
  const relevant = facts
    .filter((f) => CANON_REMINDER_CATEGORIES.includes(f.category))
    .sort((a, b) => Number(b.locked) - Number(a.locked));
  if (relevant.length === 0) return "";

  const header = "[Připomínka kánonu — tato pravidla platí závazně a nesmí se driftem hry změnit]";
  const lines: string[] = [];
  let usedChars = header.length;
  for (const f of relevant) {
    const line = factLine(f, charName, userName);
    // +1 for the joining newline.
    if (usedChars + line.length + 1 > CANON_REMINDER_MAX_CHARS && lines.length > 0) break;
    lines.push(line);
    usedChars += line.length + 1;
  }
  if (lines.length === 0) return "";
  return `${header}\n${lines.join("\n")}`;
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

function buildMemoriesSection(memories: string[]): string {
  if (memories.length === 0) return "";
  return `[RELEVANTNÍ VZPOMÍNKY — starší scény, doslovně]\n${memories
    .map((m) => `---\n${m.trim()}`)
    .join("\n")}`;
}

// ---- MMR diversity selection ----------------------------------------------

/**
 * Maximal Marginal Relevance (MMR) selection for fact diversity (plan §A4).
 *
 * Iteratively selects `k` facts from `facts` that balance relevance (λ)
 * against diversity (1-λ).  The first fact is always the most relevant one;
 * each subsequent pick maximizes `λ * relevance(f) - (1-λ) *
 * max_similarity(f, already_selected)`.  Falls back to relevance-only ranking
 * when `factVectors` is absent or a fact's vector is missing.
 *
 * O(n²) for n facts — fine for the typical ledger size (hundreds max). */
function selectDiverseFacts(
  facts: LedgerFactLike[],
  relevance: Record<string, number>,
  factVectors: Record<string, number[]> | undefined,
  k: number,
  lambda: number,
): LedgerFactLike[] {
  if (k >= facts.length) return [...facts];
  if (k <= 0) return [];

  const selected: LedgerFactLike[] = [];
  const remaining = [...facts];

  // Convert vectors once to Float32Array for cosineSimilarity.
  const vectors = new Map<string, Float32Array>();
  if (factVectors) {
    for (const [id, vec] of Object.entries(factVectors)) {
      vectors.set(id, Float32Array.from(vec));
    }
  }

  // First pick: most relevant.
  remaining.sort((a, b) => {
    const ra = relevance[a.id] ?? 0;
    const rb = relevance[b.id] ?? 0;
    return rb - ra;
  });
  const first = remaining.shift()!;
  selected.push(first);

  // Subsequent picks: MMR.
  while (selected.length < k && remaining.length > 0) {
    const selVecs = selected
      .map((s) => vectors.get(s.id))
      .filter((v): v is Float32Array => !!v);

    let bestIdx = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const f = remaining[i];
      const rel = relevance[f.id] ?? 0;
      const fVec = vectors.get(f.id);

      let maxSim = 0;
      if (fVec && selVecs.length > 0) {
        for (const sv of selVecs) {
          const sim = cosineSimilarity(fVec, sv);
          if (sim > maxSim) maxSim = sim;
        }
      }

      const mmr = lambda * rel - (1 - lambda) * maxSim;
      if (mmr > bestScore) {
        bestScore = mmr;
        bestIdx = i;
      }
    }

    const [next] = remaining.splice(bestIdx, 1);
    selected.push(next);
  }

  return selected;
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
  let memories = [...(input.retrievedMemories ?? [])]; // most relevant first
  const memoriesTotal = memories.length;
  let summaryText = (input.summary ?? "").trim();
  let summaryTruncated = false;
  let mesExampleIncluded = character.mesExample.trim().length > 0;

  const historyTotal = input.history.length;
  let historyIncluded = input.history.slice(-verbatimWindow);

  const groupMembers = input.groupMembers ?? [];
  const moodFacts = input.moodFacts ?? [];
  const systemCore = buildSystemCore(character, persona, userName, groupMembers, moodFacts);

  function render(): {
    messages: PromptMessage[];
    totalTokens: number;
    sectionsTokens: ReturnType<typeof sectionTokens>;
    canonReminderTokens: number;
    systemText: string;
    historyText: string;
    phiText: string;
  } {
    const mesExampleSection = mesExampleIncluded ? buildMesExampleSection(character, charName, userName) : "";
    const factsSection = buildFactsSection(facts, charName, userName);
    const loreSectionEntries = [...lore].sort((a, b) => b.priority - a.priority);
    const loreSection = buildLoreSection(loreSectionEntries, charName, userName);
    const summarySection = buildSummarySection(summaryText);
    const memoriesSection = buildMemoriesSection(memories);

    const systemText = assembleSystemMessage([
      systemCore,
      mesExampleSection,
      factsSection,
      loreSection,
      summarySection,
      memoriesSection,
    ]);

    const messages: PromptMessage[] = [];
    if (systemText) messages.push({ role: "system", content: systemText });
    for (const m of historyIncluded) messages.push(m);
    let phi = character.postHistoryInstructions.trim();
    if (groupMembers.length > 0) {
      const groupInstruction = buildGroupSpeakerInstruction(groupMembers.map((m) => m.name));
      phi = phi ? `${phi}\n\n${groupInstruction}` : groupInstruction;
    }
    // Calendar date + season block rendered before game-time — gives the
    // model awareness of the fantasy date, season effects, and the [TIME:+1d]
    // tag for advancing the calendar.
    const calDesc = input.calendarDateDescription?.trim();
    if (calDesc) {
      phi = phi ? `${phi}\n\n${calDesc}` : calDesc;
    }
    // Game-time block rendered before the canon reminder — small enough
    // (~50 tokens) to not stress the budget and gives the model a sense
    // of the current in-game moment.
    const gameTimeDesc = input.gameTimeDescription?.trim();
    if (gameTimeDesc) {
      phi = phi ? `${phi}\n\n[PRÁVĚ TEĎ]\n${gameTimeDesc}` : `[PRÁVĚ TEĎ]\n${gameTimeDesc}`;
    }
    // Game tag instructions — tells the model to annotate item + skill/level changes
    const progression = persona?.progression ?? "skill";
    const hasInv = persona?.inventory?.length;
    const hasSkills = persona?.skills?.length;
    if (progression !== "none" && (hasInv || (progression === "skill" && hasSkills))) {
      let tagInstructions = "[HERNÍ TAGY]\n";
      // Inventory tags always emitted when inventory exists (regardless of progression)
      if (hasInv && persona) {
        const inv = persona.inventory ?? [];
        tagInstructions += `Aktuální inventář: ${inv.map((i) => i.item + (i.qty > 1 ? ` x${i.qty}` : "")).join(", ")}.\n`;
        tagInstructions += "Změny inventáře: [INV:+předmět] získání, [INV:-předmět] ztráta, [INV:+počet:předmět] množství.\n";
      }
      if (progression === "skill" && hasSkills && persona) {
        const sk = persona.skills ?? [];
        tagInstructions += `Aktuální dovednosti: ${sk.map((s) => `${s.name} ${s.level}`).join(", ")}.\n`;
        tagInstructions += "Změny dovedností: [SKILL:+nová] naučení (level 1), [SKILL:+jméno:level] nastavení úrovně, [SKILL:jméno+1] zvýšení.\n";
      }
      if (progression === "level") {
        const xp = persona?.xp ?? 0;
        const lvl = persona?.level ?? 1;
        tagInstructions += `Aktuálně: úroveň ${lvl}, ${xp} XP.\n`;
        tagInstructions += "Změny: [LEVEL:+částka] přidá XP.\n";
      }
      tagInstructions += "Tagy umísti kamkoliv do textu — budou automaticky odstraněny.";
      phi = phi ? `${phi}\n\n${tagInstructions}` : tagInstructions;
    }

    // Faction reputation instructions — always included when persona has any faction standings
    const hasFactions = persona?.factions?.length;
    if (hasFactions && persona) {
      let factionInstructions = "[FRAKČNÍ REPUTACE]\n";
      factionInstructions += "NPC reakce by měly odrážet reputaci u frakcí: ";
      factionInstructions += "nepřátelské (< -50), podezřívavé (< -20), neutrální, přátelské (> 20), spojenecké (> 50).\n";
      factionInstructions += "Změny reputace: [FACTION:+jméno:hodnota] zvýšení, [FACTION:-jméno:hodnota] snížení.\n";
      factionInstructions += "Tagy umísti kamkoliv do textu — budou automaticky odstraněny.";
      phi = phi ? `${phi}\n\n${factionInstructions}` : factionInstructions;
    }

    // Crafting instructions — included when persona has known recipes or an inventory
    const hasRecipes = persona?.craftingRecipes?.length;
    if (hasRecipes || hasInv) {
      let craftInstructions = "[VÝROBA]\n";
      craftInstructions += "Skill určuje KVALITU výrobku, ne možnost výroby. Při skillu 1 vznikne z ingrediencí slabý předmět, při skillu 9 mistrovský s bonusovými perky.\n";
      craftInstructions += "Ingredience se vždy spotřebují (i při neúspěchu). Legendární ingredience jsou vzácné (padají z bossů), nejsou omezeny skillem.\n\n";

      // Perk scale
      craftInstructions += "Škála perků podle skillu:\n";
      craftInstructions += "- Skill 1–2: 0 perků, základní předmět\n";
      craftInstructions += "- Skill 3–5: 1 perk (Tier 1)\n";
      craftInstructions += "- Skill 6–8: 2 perky (Tier 1 + Tier 2)\n";
      craftInstructions += "- Skill 9–11: 3 perky (Tier 1 + Tier 2 + Tier 3)\n";
      craftInstructions += "- Skill 12+: 4 perky (Tier 1 + Tier 2 + Tier 3 + Tier 4)\n\n";

      craftInstructions += "Dostupné perky podle tierů:\n";
      craftInstructions += "- Tier 1 (od skillu 3): Nabroušený, Nerezaví, Lehký\n";
      craftInstructions += "- Tier 2 (od skillu 6): Nezlomný, Přesný, Ochranný\n";
      craftInstructions += "- Tier 3 (od skillu 9): Nasává manu, Leechuje, Magická čepel\n";
      craftInstructions += "- Tier 4 (od skillu 12): Pojmenovaná, Duše v čepeli\n\n";

      craftInstructions += "Tagy:\n";
      craftInstructions += "- [CRAFT:výsledek:surovina1+surovina2] — objevení/zápis receptu (suroviny se odečtou z inventáře)\n";
      craftInstructions += "- [CRAFTED:výsledek] — úspěšné vyrobení (perky vybereš automaticky podle skillu)\n";
      craftInstructions += "- [CRAFTED:výsledek:perk1+perk2] — vyrobení s konkrétními perky\n";
      craftInstructions += "Tagy umísti kamkoliv do textu — budou automaticky odstraněny.";

      if (hasRecipes && persona) {
        craftInstructions += "\n\nZnámé recepty:\n";
        for (const r of persona.craftingRecipes ?? []) {
          const crafted = r.craftedAt ? "✓" : "✗";
          const skillHint = r.skillName ? ` (skill: ${r.skillName})` : "";
          const perksStr = r.perks.length > 0 ? ` [perky: ${r.perks.join(", ")}]` : "";
          craftInstructions += `- ${crafted} ${r.resultItem} ← ${r.ingredients.join(" + ")}${skillHint}${perksStr}\n`;
        }
      }

      phi = phi ? `${phi}\n\n${craftInstructions}` : craftInstructions;
    }

    // Canon reminder is appended last, closest to generation — see
    // `buildCanonReminderSection`. It is intentionally NOT part of the
    // budget-trim passes below (never cut), only size-capped at build time.
    const canonSection = buildCanonReminderSection(facts, charName, userName);
    if (canonSection) {
      phi = phi ? `${phi}\n\n${canonSection}` : canonSection;
    }
    if (phi) {
      messages.push({ role: "system", content: substitutePlaceholders(phi, charName, userName) });
    }

    const sectionsTok = sectionTokens(systemCore, mesExampleSection, factsSection, loreSection, summarySection, memoriesSection, historyIncluded, phi);
    const totalTokens = sectionsTok.systemTokens + sectionsTok.factsTokens + sectionsTok.loreTokens +
      sectionsTok.summaryTokens + sectionsTok.memoriesTokens + sectionsTok.historyTokens;

    const historyText = historyIncluded.map((m) => `${m.role}: ${m.content}`).join("\n");
    const phiText = phi ? substitutePlaceholders(phi, charName, userName) : "";
    return { messages, totalTokens, sectionsTokens: sectionsTok, canonReminderTokens: estimateTokens(canonSection) , systemText, historyText, phiText };
  }

  function sectionTokens(
    core: string,
    mesExample: string,
    factsSection: string,
    loreSection: string,
    summarySection: string,
    memoriesSection: string,
    history: PromptMessage[],
    phi: string,
  ) {
    // Use model-specific counting for the three largest sections when a
    // connection is available (plan §A3).  Falls back to the rough
    // chars-per-token estimate for all other sections and when
    // syncCountTokens hasn't preloaded tiktoken yet.
    const useModel = input.connection;
    const count = useModel
      ? (text: string) => syncCountTokens(useModel.model, text)
      : estimateTokens;

    return {
      systemTokens: count(core) + estimateTokens(mesExample),
      factsTokens: count(factsSection),
      loreTokens: estimateTokens(loreSection),
      summaryTokens: estimateTokens(summarySection),
      memoriesTokens: estimateTokens(memoriesSection),
      historyTokens: count(
        history.map((m) => `${m.role}: ${m.content}`).join("\n"),
      ) + estimateTokens(phi),
    };
  }

  let current = render();

  // (a0) trim retrieved memories, least relevant (last) first — they're a
  // semantic bonus, so they go before anything the user curated.
  while (current.totalTokens > budget && memories.length > 0) {
    memories.pop();
    trimmedNotes.push("Vzpomínky: vynechána nejméně relevantní scéna (rozpočet kontextu).");
    current = render();
  }

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
  // With factVectors (plan §A4): use MMR to pre-rank facts per category
  // so the trimmer always cuts the least diverse+relevant fact first.
  // Without factVectors: the original relevance-only (or first-found)
  // ordering applies.
  const mmrRanked = new Map<LedgerCategory, LedgerFactLike[]>();
  if (input.factVectors) {
    for (const cat of TRIMMABLE_FACT_CATEGORIES) {
      const catFacts = facts.filter((f) => f.category === cat);
      if (catFacts.length > 0) {
        mmrRanked.set(
          cat,
          selectDiverseFacts(catFacts, input.factRelevance ?? {}, input.factVectors, catFacts.length, 0.7),
        );
      } else {
        mmrRanked.set(cat, []);
      }
    }
  }

  const factCutIndex = (cat: LedgerCategory): number => {
    if (input.factVectors) {
      // Cut the last-ranked fact (least important in MMR order).
      const ranked = mmrRanked.get(cat) ?? [];
      if (ranked.length === 0) return -1;
      const last = ranked[ranked.length - 1];
      const idx = facts.findIndex((f) => f.id === last.id);
      if (idx !== -1) ranked.pop(); // keep ranking in sync
      return idx;
    }

    let best = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    facts.forEach((f, i) => {
      if (f.category !== cat) return;
      const score = input.factRelevance
        ? (input.factRelevance[f.id] ?? Number.NEGATIVE_INFINITY)
        : 0;
      if (best === -1 || score < bestScore) {
        best = i;
        bestScore = score;
      }
    });
    return best;
  };
  for (const cat of TRIMMABLE_FACT_CATEGORIES) {
    while (current.totalTokens > budget && facts.some((f) => f.category === cat)) {
      const idx = factCutIndex(cat);
      if (idx === -1) break;
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
      // Includes mes_example when it's still included — matches what
      // `estimatedTokens` actually counted for this section.
      systemTokens: current.sectionsTokens.systemTokens,
      factsTokens: current.sectionsTokens.factsTokens,
      factsIncluded: facts.length,
      factsTotal,
      loreTokens: current.sectionsTokens.loreTokens,
      loreIncluded: lore.length,
      loreTotal: input.loreEntries.length,
      summaryTokens: current.sectionsTokens.summaryTokens,
      summaryIncluded: summaryText.length > 0,
      summaryTruncated,
      memoriesTokens: current.sectionsTokens.memoriesTokens,
      memoriesIncluded: memories.length,
      memoriesTotal,
      historyTokens: current.sectionsTokens.historyTokens,
      historyMessagesIncluded: historyIncluded.length,
      historyMessagesTotal: historyTotal,
      mesExampleIncluded,
      canonReminderTokens: current.canonReminderTokens,
      ...(input.groupMembers ? { groupMembersIncluded: groupMembers.length } : {}),
      systemText: current.systemText,
      historyText: current.historyText,
      phiText: current.phiText,
    },
    trimmedNotes,
  };

  return { messages: current.messages, report };
}
