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
import {
  RP_INSTRUCTIONS,
  SECTION_CANON,
  SECTION_FACTS,
  SECTION_SCENE_DIRECTION,
  SECTION_SILENT_CORRECTION,
  SECTION_STORY_SO_FAR,
  SECTION_MEMORIES,
  SECTION_LOREBOOK,
  SECTION_OTHER_CHARS,
  SECTION_RIGHT_NOW,
  SECTION_GAME_TAGS,
  SECTION_FACTIONS,
  SECTION_CRAFTING,
  SECTION_PERSONA,
  SECTION_TWO_ROLES,
  SECTION_DIALOG_EXAMPLE,
  SECTION_CANON_REMINDER,
  TWO_ROLES_INSTRUCTIONS,
  DIALOG_EXAMPLE_HEADER,
  DIALOG_EXAMPLE_BODY,
  factionLabel,
  PERSONA_APPEARANCE,
  PERSONA_SKILLS,
  PERSONA_LEVEL,
  PERSONA_INVENTORY,
  PERSONA_FACTION_REP,
  GROUP_SPEAKER_INSTRUCTION,
  TAG_INSTRUCTIONS_CURRENT_INVENTORY,
  TAG_INSTRUCTIONS_INVENTORY_CHANGES,
  TAG_INSTRUCTIONS_CURRENT_SKILLS,
  TAG_INSTRUCTIONS_SKILL_CHANGES,
  TAG_INSTRUCTIONS_LEVEL_CURRENT,
  TAG_INSTRUCTIONS_LEVEL_CHANGES,
  TAG_PLACEMENT_HINT,
  FACTION_INSTRUCTIONS_REACTIONS,
  FACTION_INSTRUCTIONS_CHANGES,
  FACTION_TAG_HINT,
  CRAFTING_INSTRUCTIONS_BASE,
  CRAFTING_KNOWN_RECIPES,
  TRIM_MEMORIES,
  TRIM_LORE,
  TRIM_HISTORY,
  TRIM_SUMMARY,
  TRIM_FACT,
  TRIM_MES_EXAMPLE,
} from "./promptTexts";

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
  /** Soft canon (M25.5): auto-promoted by stability tracking. Treated like
   * `locked` everywhere in the prompt (canon block, never trimmed, canon
   * reminder) — the difference only matters to the extractor, which may
   * still correct a soft-canon fact after a repeated contradiction. */
  canon?: boolean;
}

/** Canon = user-locked (hard) or auto-promoted (soft). */
export function isCanonFact(f: LedgerFactLike): boolean {
  return f.locked || !!f.canon;
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
  /** Optional extra system prompt from a prompt preset (M12.4) — appended
   * to the system core message before the lore/facts/summary sections. */
  presetExtraSystemPrompt?: string;
  /** Optional author's note from a prompt preset (M26.2) — injected as a
   * system message right before the last user message in the prompt,
   * ideal for style/formatting guidance without cluttering the system core. */
  presetAuthorNote?: string;
  /** Retrieval detail (M25.4) — why each direct-hit memory was selected;
   * same order as the head of `retrievedMemories`. Passed through to the
   * report for the Prompt inspector, truncated to the memories that survive
   * budget trimming. */
  retrievedMemoriesDetail?: Array<{
    snippet: string;
    score: number;
    decayedScore: number;
    createdAt: string;
  }>;
  /** Silent drift corrections (M25.2) — produced by the drift detector when
   * recent scenes contradicted locked canon facts. Injected into the
   * trailing system message; the player never sees them in the UI flow. */
  driftCorrections?: string[];
  /** Director note (M25.3) — per-chat pacing/tone/genre steering, rendered
   * into the trailing system message so it outweighs older instructions. */
  directorNote?: string;
  /** Language the AI writes in (e.g. 'cs', 'en') — per-chat (M28). */
  gameLanguage?: string;
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
    /** Locked (canon) facts rendered in the dedicated `[KÁNON PŘÍBĚHU]`
     * block — always all of them; canon is never trimmed (M25.1). */
    canonFactsIncluded: number;
    /** Drift corrections injected this build (M25.2), verbatim — surfaced
     * only in the Prompt inspector. */
    driftCorrections: string[];
    /** Retrieval detail for the included memories (M25.4). */
    memoriesDetail: Array<{
      snippet: string;
      score: number;
      decayedScore: number;
      createdAt: string;
    }>;
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

const DEFAULT_RP_INSTRUCTIONS_CS =
  "Jsi vypravěč hry na hrdiny (RP). Hraj roli postavy {{char}} podle popisu níže, " +
  "drž se jejího charakteru a scénáře. Akce a gesta piš kurzívou, přímou řeč normálně. " +
  "Nikdy nemluv ani nejednej za hráče ({{user}}). Drž konzistenci žánru a pravidel světa " +
  "tak, jak byla zavedena — nepovoluj hráči schopnosti, moc ani vybavení nad rámec " +
  "zavedených pravidel a nenech herní žánr nebo tón postupně driftovat k něčemu jinému.";

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
    const moodSuffix = mood ? ` (mood: ${mood})` : "";
    return `- ${m.name}${moodSuffix}: ${desc}`;
  });
  return `${SECTION_OTHER_CHARS}\n${lines.join("\n")}`;
}

function buildSystemCore(
  character: CharacterLike,
  persona: PersonaLike | null,
  userName: string,
  groupMembers: Array<{ name: string; description: string }>,
  moodFacts: Array<{ subject: string; fact: string }>,
  lang: string,
): string {
  const base = character.systemPrompt.trim() || (lang === "cs" ? DEFAULT_RP_INSTRUCTIONS_CS : RP_INSTRUCTIONS(lang));

  const roleSplit = `${SECTION_TWO_ROLES}\n${TWO_ROLES_INSTRUCTIONS(lang)}`;

  const examples = `${DIALOG_EXAMPLE_HEADER}\n${DIALOG_EXAMPLE_BODY}`;

  const parts = [base, roleSplit, examples, character.description, character.personality, character.scenario].map((p) =>
    p.trim(),
  );
  if (persona) {
    const personaLines: string[] = [];
    const identity: string[] = [];
    if (persona.gender) identity.push(persona.gender);
    if (persona.age) identity.push(`${persona.age} let`);
    if (persona.race) identity.push(persona.race);
    if (identity.length > 0) personaLines.push(identity.join(", "));
    if (persona.appearance) personaLines.push(`\n${PERSONA_APPEARANCE} ${persona.appearance}`);
    if (persona.skills?.length) {
      personaLines.push(`\n${PERSONA_SKILLS}`);
      for (const s of persona.skills) personaLines.push(`- ${s.name} (${PERSONA_LEVEL} ${s.level})`);
    }
    if (persona.inventory?.length) {
      personaLines.push(`\n${PERSONA_INVENTORY}`);
      for (const inv of persona.inventory) {
        personaLines.push(`- ${inv.item}${inv.qty > 1 ? ` x${inv.qty}` : ""}`);
      }
    }
    if (persona.factions?.length) {
      personaLines.push(`\n${PERSONA_FACTION_REP}`);
      for (const f of persona.factions) {
        const label = factionLabel(f.reputation);
        personaLines.push(`- ${f.factionName}: ${f.reputation} (${label})`);
      }
    }
    if (personaLines.length > 0) {
      parts.push(`${SECTION_PERSONA(userName)}\n${personaLines.join("\n")}`);
    }
  }
  const groupSection = buildGroupMembersSection(groupMembers, moodFacts);
  if (groupSection) parts.push(groupSection);
  return substitutePlaceholders(parts.filter(Boolean).join("\n\n"), character.name, userName);
}

/** "Speak only as {{char}}" instruction added in group chats (plan §4) —
 * appended to post_history_instructions, or sent as its own trailing
 * system message when the card has none. */
function buildGroupSpeakerInstruction(otherNames: string[], charName: string, userName: string): string {
  const names = otherNames.join(", ");
  return substitutePlaceholders(
    GROUP_SPEAKER_INSTRUCTION("{{char}}", `{{others}}`, "{{user}}"),
    charName,
    userName,
  ).replace("{{others}}", names);
}

function buildMesExampleSection(character: CharacterLike, charName: string, userName: string): string {
  const trimmed = character.mesExample.trim();
  if (!trimmed) return "";
  return `${SECTION_DIALOG_EXAMPLE}\n${substitutePlaceholders(trimmed, charName, userName)}`;
}

function factLine(fact: LedgerFactLike, charName: string, userName: string): string {
  return `- (${fact.category}/${substitutePlaceholders(fact.subject, charName, userName)}) ${substitutePlaceholders(fact.fact, charName, userName)}`;
}

/** Renders ledger facts as two blocks (M25.1): locked facts first under
 * `[KÁNON PŘÍBĚHU]` — the user-pinned, immutable rules of the story — then
 * the extracted facts under `[FAKTA SVĚTA]`. The split makes the model
 * treat canon as law rather than as one line among many. */
function buildFactsSection(facts: LedgerFactLike[], charName: string, userName: string): string {
  if (facts.length === 0) return "";
  const byCategory = (list: LedgerFactLike[]) =>
    FACT_CATEGORY_ORDER.flatMap((cat) => list.filter((f) => f.category === cat));
  const canon = byCategory(facts.filter(isCanonFact));
  const rest = byCategory(facts.filter((f) => !isCanonFact(f)));

  const blocks: string[] = [];
  if (canon.length > 0) {
    const lines = canon.map((f) => factLine(f, charName, userName));
    blocks.push(
      `${SECTION_CANON}\n${lines.join("\n")}`,
    );
  }
  if (rest.length > 0) {
    const lines = rest.map((f) => factLine(f, charName, userName));
    blocks.push(`${SECTION_FACTS}\n${lines.join("\n")}`);
  }
  return blocks.join("\n\n");
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
  // Canon facts (locked or soft) of ANY category are included alongside the
  // always-reinforced world/player categories; hard locks sort first.
  const relevant = facts
    .filter((f) => isCanonFact(f) || CANON_REMINDER_CATEGORIES.includes(f.category))
    .sort((a, b) => Number(isCanonFact(b)) - Number(isCanonFact(a)));
  if (relevant.length === 0) return "";

  const header = SECTION_CANON_REMINDER;
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
  return `${SECTION_LOREBOOK}\n${lines.join("\n")}`;
}

function buildSummarySection(summary: string): string {
  if (!summary.trim()) return "";
  return `${SECTION_STORY_SO_FAR}\n${summary.trim()}`;
}

function buildMemoriesSection(memories: string[]): string {
  if (memories.length === 0) return "";
  return `${SECTION_MEMORIES}\n${memories
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
  const driftCorrections = (input.driftCorrections ?? []).map((c) => c.trim()).filter(Boolean);

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

  const lang = input.gameLanguage ?? "cs";

  const groupMembers = input.groupMembers ?? [];
  const moodFacts = input.moodFacts ?? [];
  const systemCore = buildSystemCore(character, persona, userName, groupMembers, moodFacts, lang);

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

    const presetSection = input.presetExtraSystemPrompt?.trim();
    const systemText = assembleSystemMessage([
      systemCore,
      presetSection || "",
      mesExampleSection,
      factsSection,
      loreSection,
      summarySection,
      memoriesSection,
    ]);

    const messages: PromptMessage[] = [];
    if (systemText) messages.push({ role: "system", content: systemText });
    for (const m of historyIncluded) messages.push(m);

    // M26.2: author's note injected as a system message right before the last
    // user message — ideal for writing-style guidance late in the context where
    // models weigh it most heavily.
    const authorNote = input.presetAuthorNote?.trim();
    if (authorNote) {
      // Find the last user-role message and insert the author's note before it.
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "user") {
          messages.splice(i, 0, { role: "system", content: authorNote });
          break;
        }
      }
    }

    let phi = character.postHistoryInstructions.trim();
    if (groupMembers.length > 0) {
      const groupInstruction = buildGroupSpeakerInstruction(groupMembers.map((m) => m.name), charName, userName);
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
      phi = phi ? `${phi}\n\n${SECTION_RIGHT_NOW}\n${gameTimeDesc}` : `${SECTION_RIGHT_NOW}\n${gameTimeDesc}`;
    }
    // Game tag instructions — tells the model to annotate item + skill/level changes
    const progression = persona?.progression ?? "skill";
    const hasInv = persona?.inventory?.length;
    const hasSkills = persona?.skills?.length;
    if (progression !== "none" && (hasInv || (progression === "skill" && hasSkills))) {
      let tagInstructions = `${SECTION_GAME_TAGS}\n`;
      // Inventory tags always emitted when inventory exists (regardless of progression)
      if (hasInv && persona) {
        const inv = persona.inventory ?? [];
        tagInstructions += `${TAG_INSTRUCTIONS_CURRENT_INVENTORY} ${inv.map((i) => i.item + (i.qty > 1 ? ` x${i.qty}` : "")).join(", ")}.\n`;
        tagInstructions += `${TAG_INSTRUCTIONS_INVENTORY_CHANGES}\n`;
      }
      if (progression === "skill" && hasSkills && persona) {
        const sk = persona.skills ?? [];
        tagInstructions += `${TAG_INSTRUCTIONS_CURRENT_SKILLS} ${sk.map((s) => `${s.name} ${s.level}`).join(", ")}.\n`;
        tagInstructions += `${TAG_INSTRUCTIONS_SKILL_CHANGES}\n`;
      }
      if (progression === "level") {
        const xp = persona?.xp ?? 0;
        const lvl = persona?.level ?? 1;
        tagInstructions += `${TAG_INSTRUCTIONS_LEVEL_CURRENT(lvl, xp)}\n`;
        tagInstructions += `${TAG_INSTRUCTIONS_LEVEL_CHANGES}\n`;
      }
      tagInstructions += TAG_PLACEMENT_HINT;
      phi = phi ? `${phi}\n\n${tagInstructions}` : tagInstructions;
    }

    // Faction reputation instructions — always included when persona has any faction standings
    const hasFactions = persona?.factions?.length;
    if (hasFactions && persona) {
      let factionInstructions = `${SECTION_FACTIONS}\n`;
      factionInstructions += `${FACTION_INSTRUCTIONS_REACTIONS}\n`;
      factionInstructions += `${FACTION_INSTRUCTIONS_CHANGES}\n`;
      factionInstructions += FACTION_TAG_HINT;
      phi = phi ? `${phi}\n\n${factionInstructions}` : factionInstructions;
    }

    // Crafting instructions — included when persona has known recipes or an inventory
    const hasRecipes = persona?.craftingRecipes?.length;
    if (hasRecipes || hasInv) {
      let craftInstructions = `${SECTION_CRAFTING}\n`;
      craftInstructions += CRAFTING_INSTRUCTIONS_BASE;

      if (hasRecipes && persona) {
        craftInstructions += `\n\n${CRAFTING_KNOWN_RECIPES}\n`;
        for (const r of persona.craftingRecipes ?? []) {
          const crafted = r.craftedAt ? "✓" : "✗";
          const skillHint = r.skillName ? ` (skill: ${r.skillName})` : "";
          const perksStr = r.perks.length > 0 ? ` [perky: ${r.perks.join(", ")}]` : "";
          craftInstructions += `- ${crafted} ${r.resultItem} ← ${r.ingredients.join(" + ")}${skillHint}${perksStr}\n`;
        }
      }

      phi = phi ? `${phi}\n\n${craftInstructions}` : craftInstructions;
    }

    // Director note (M25.3) — pacing/tone steering, close to generation so
    // it wins over conflicting older style cues.
    const director = input.directorNote?.trim();
    if (director) {
      phi = phi ? `${phi}\n\n${SECTION_SCENE_DIRECTION}\n${director}` : `${SECTION_SCENE_DIRECTION}\n${director}`;
    }

    // Canon reminder is appended last, closest to generation — see
    // `buildCanonReminderSection`. It is intentionally NOT part of the
    // budget-trim passes below (never cut), only size-capped at build time.
    const canonSection = buildCanonReminderSection(facts, charName, userName);
    if (canonSection) {
      phi = phi ? `${phi}\n\n${canonSection}` : canonSection;
    }

    // Silent drift corrections (M25.2) — after the canon reminder, i.e. the
    // very last thing the model reads. Instructs a quiet course-correction;
    // never surfaced to the player.
    if (driftCorrections.length > 0) {
      const lines = driftCorrections.map((c) => `- ${c}`).join("\n");
      const block = SECTION_SILENT_CORRECTION(lines);
      phi = phi ? `${phi}\n\n${block}` : block;
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
    trimmedNotes.push(TRIM_MEMORIES);
    current = render();
  }

  // (a) trim lore, lowest priority first.
  while (current.totalTokens > budget && lore.length > 0) {
    const removed = lore.shift();
    if (removed) trimmedNotes.push(TRIM_LORE(removed.id));
    current = render();
  }

  // (b) trim older verbatim messages, never below MIN_VERBATIM_MESSAGES.
  while (current.totalTokens > budget && historyIncluded.length > MIN_VERBATIM_MESSAGES) {
    historyIncluded = historyIncluded.slice(1);
    trimmedNotes.push(TRIM_HISTORY);
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
    trimmedNotes.push(TRIM_SUMMARY);
  }

  // (d) trim facts event -> quest -> npc (world/player never touched).
  // With factVectors (plan §A4): use MMR to pre-rank facts per category
  // so the trimmer always cuts the least diverse+relevant fact first.
  // Without factVectors: the original relevance-only (or first-found)
  // ordering applies.
  const mmrRanked = new Map<LedgerCategory, LedgerFactLike[]>();
  if (input.factVectors) {
    for (const cat of TRIMMABLE_FACT_CATEGORIES) {
      // Canon facts (locked or soft) — never candidates for trimming.
      const catFacts = facts.filter((f) => f.category === cat && !isCanonFact(f));
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
      if (f.category !== cat || isCanonFact(f)) return;
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
    while (current.totalTokens > budget && facts.some((f) => f.category === cat && !isCanonFact(f))) {
      const idx = factCutIndex(cat);
      if (idx === -1) break;
      const [removed] = facts.splice(idx, 1);
      trimmedNotes.push(TRIM_FACT(removed.category, removed.subject));
      current = render();
    }
    if (current.totalTokens <= budget) break;
  }

  // (e) drop mes_example entirely, last resort.
  if (current.totalTokens > budget && mesExampleIncluded) {
    mesExampleIncluded = false;
    trimmedNotes.push(TRIM_MES_EXAMPLE);
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
      canonFactsIncluded: facts.filter(isCanonFact).length,
      driftCorrections,
      // Direct hits sit at the head of the memories list and trimming pops
      // from the tail, so the surviving prefix maps 1:1 onto the detail.
      memoriesDetail: (input.retrievedMemoriesDetail ?? []).slice(0, memories.length),
    },
    trimmedNotes,
  };

  return { messages: current.messages, report };
}
