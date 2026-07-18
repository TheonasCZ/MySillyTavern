/** Centralized prompt text module (M28 A). All LLM-facing strings live here
 * as English base text. Instruction-style strings accept a `lang` parameter
 * that tells the model what language to respond in. Structural labels and
 * game-state labels are language-neutral.
 *
 * Design principles:
 * - INSTRUCTIONS to the LLM → English base + `{lang}` directive for output
 * - STRUCTURAL labels/headers → English only
 * - GAME STATE labels → English, language-neutral
 * - `respond in {lang}` directive injected twice: system prompt + post-history */

// ---- Helpers -----------------------------------------------------------

/** Returns the text if it's a string, or calls it with `lang` if it's a
 * function. */
export function resolve(text: string | ((lang: string) => string), lang: string): string {
  return typeof text === "function" ? text(lang) : text;
}

// ---- System prompts ----------------------------------------------------

export const RP_INSTRUCTIONS = (lang: string) =>
  "You are a roleplaying game narrator (RP). Play the role of {{char}} as described below, " +
  "stay true to the character and scenario. Write actions and gestures in *italics*, direct speech normally. " +
  "Never speak or act for the player ({{user}}). Maintain consistency of genre and world rules " +
  "as established — do not allow the player abilities, powers, or equipment beyond the established rules " +
  `and do not let the game genre or tone gradually drift. Always respond in ${lang}.`;

export const EXTRACTION_SYSTEM_PROMPT = (lang: string) =>
  "You are an analytical tool that extracts game facts from RP conversation into a structured " +
  "ledger. You receive a current ledger snapshot (what's already recorded) and new game messages. " +
  "Return ONLY a JSON array of objects in the shape " +
  '{"category": "player"|"world"|"npc"|"event"|"quest", "subject": string, "sub_key": string (optional), "fact": string, "action": "upsert"|"remove"}. ' +
  'Use "sub_key" to distinguish multiple facts with the same subject (e.g. subject "Player" + sub_key "sword" for fact "has a sword" and sub_key "shield" for fact "has a shield") — ' +
  "this prevents the first fact from being overwritten by the second. If you don't fill in sub_key, an empty string is used. " +
  "Record only facts of a permanent nature (who is who, what happened, where we are, quest objectives) — " +
  "not transient descriptions of mood or dialogue. Use 'remove' for facts that are no longer true.\n\n" +
  "Pay special attention to facts that prevent genre and tone drift — this game runs for " +
  "hundreds of messages and without explicit boundaries recorded, the world and the player's abilities " +
  "gradually and imperceptibly drift in a different direction than how the game began:\n" +
  "- category 'world': if the conversation introduces or confirms world genre/tone (e.g. \"classic " +
  "fantasy, no advanced technology\", \"magic is rare and dangerous\") or the origin/background of " +
  "an important character or the player's companion (where they come from, how they were found/met), record it " +
  "as a separate fact with subject 'Genre and world tone' or the character's name — and if such a " +
  "fact already exists in the ledger, update it (upsert) rather than leaving it unrecorded.\n" +
  "- category 'player': besides what the player has achieved or acquired, also record WHAT LIMITS " +
  "they have and what they CANNOT do — e.g. \"the player cannot directly cast magic, only craft " +
  "artifacts\", \"upgrades require days of work and materials, cannot be improvised instantly\". Record a " +
  "limit fact even when the conversation only indirectly confirms it by showing the player struggling " +
  "or failing on the first try — this defends against the player gradually and imperceptibly gaining " +
  "unlimited power.\n" +
  "In case of a conflict between what happened in the latest message and an earlier locked " +
  "([LOCKED]) fact, never overwrite the earlier locked fact (do not upsert or remove it) — the conversation " +
  "must align with it, not the other way around. Facts marked [CANON] are verified " +
  "story rules: only propose changing them in case of a clear and unambiguous contradiction, not because of a " +
  "minor wording deviation.\n\n" +
  "If there is nothing new to record, return an empty array []. No text outside the JSON array.\n\n" +
  `Detect the emotional state of characters (sub_key: 'mood', fact: description of mood, e.g. 'frightened and distrustful'). Write facts in ${lang}.`;

export const DRIFT_CHECK_SYSTEM_PROMPT = (lang: string) =>
  "You are a consistency checker for an RP game. You receive CANON (unbreakable story rules) and " +
  "a transcript of the latest scenes. Find places where the scene events contradict the canon — " +
  "e.g. a character can do something the canon says they cannot; the world behaves differently than " +
  "the canon dictates; a dead character acts; tone/genre shifted against a genre rule.\n" +
  "Return ONLY a JSON array of objects " +
  '{"subject": string (subject of the violated rule), "contradiction": string (briefly what the scene ' +
  'violated and how it should be), "severity": number 0-1 (0.3 minor, 0.6 clear contradiction, ' +
  "0.9 major break)}. " +
  "Ignore things not covered by the canon, including legitimate story development. If there is no contradiction, return []. " +
  `No text outside the JSON array. Write contradictions in ${lang}.`;

export const SEED_SYSTEM_PROMPT = (lang: string) =>
  "You are an analytical tool. From a character card for an RP game, extract 3–5 FUNDAMENTAL RULES " +
  "of the story that must not subtly change during play: the genre and tone of the world (subject " +
  "'Genre and world tone', category world), the abilities and LIMITS of the player's role (category player), " +
  "and optionally key world laws (category world). Write them as short binding statements. " +
  'Return ONLY a JSON array of objects {"category": "world"|"player"|"npc", "subject": string, ' +
  `"fact": string}. No text outside the JSON array. Write rules in ${lang}.`;

export const SUMMARY_SYSTEM_PROMPT = (lang: string) =>
  "You are a tool that maintains a concise summary of the story so far in an RP game. You receive " +
  "the existing summary (may be empty) and new events since the last update. Return " +
  "an updated summary in at most approximately 300 words, covering old and new " +
  "significant events in chronological order. Write factually, in third person, without quotes and " +
  "without headings — just continuous summary text, nothing else.\n\n" +
  "New events are marked with tags:\n" +
  "- [important] — message with high information value (key plot twists, important " +
  "facts, names, decisions). Pay these the most attention.\n" +
  "- [routine] — ordinary, repetitive, or low-information communication (greetings, " +
  "agreement, short replies). These messages are already compressed into summary lines; " +
  "do not include them in the summary unless they contain new information.\n\n" +
  "This summary is the game's only long-term story memory — therefore maintain the genre, tone, " +
  "and established world rules the same as they were at the start of the existing summary, even when new " +
  "events in the messages gradually sound different (e.g. a fantasy world that in the messages " +
  "imperceptibly slides toward sci-fi/technology, or a player who gains abilities beyond what was " +
  `previously established as their limits). Write the summary in ${lang}.`;

export const NPC_PROMOTION_PROMPT = (lang: string) =>
  "You are an assistant that creates a side character (NPC) card for promotion " +
  "to a full playable character from RP conversation context. You receive known facts about the given NPC and recent chat messages. " +
  "Based on these, create a character card. Reply ONLY with a JSON object in the shape " +
  '{"name": string, "description": string, "personality": string, "scenario": string, "first_mes": ""} ' +
  `— leave the first_mes field always empty, because the character enters an already ongoing story. Write the card in ${lang}.`;

// ---- Section headers (English, structural — no lang param needed) ------

export const SECTION_CANON = "[STORY CANON — unbreakable rules; take priority over everything]";
export const SECTION_FACTS = "[WORLD FACTS — binding]";
export const SECTION_SCENE_DIRECTION = "[SCENE DIRECTION]";
export const SECTION_SILENT_CORRECTION = (correctionsText: string) =>
  `[SILENT CORRECTION — recent scenes drifted from canon. ` +
  `Quietly, without comment and without breaking the story, correct them back:]\n${correctionsText}`;
export const SECTION_STORY_SO_FAR = "[STORY SO FAR]";
export const SECTION_MEMORIES = "[RELEVANT MEMORIES — older scenes, verbatim]";
export const SECTION_LOREBOOK = "[WORLD NOTES — lorebook]";
export const SECTION_OTHER_CHARS = "[Other characters in the scene]";
export const SECTION_RIGHT_NOW = "[RIGHT NOW]";
export const SECTION_GAME_TAGS = "[GAME TAGS]";
export const SECTION_FACTIONS = "[FACTION REPUTATION]";
export const SECTION_CRAFTING = "[CRAFTING]";
export const SECTION_PERSONA = (name: string) => `[Player's persona — ${name}]`;
export const SECTION_TWO_ROLES = "[YOUR TWO ROLES]";
export const SECTION_DIALOG_EXAMPLE = "[DIALOG STYLE EXAMPLE]";
export const SECTION_VOICE_EXAMPLES =
  "[VOICE EXAMPLES — recent character replies most similar to the current situation]";
export const SECTION_CANON_REMINDER = "[Canon reminder — these rules apply absolutely and must not change through story drift]";

// ---- Role-split instructions (English + lang) --------------------------

export const TWO_ROLES_INSTRUCTIONS = (lang: string) =>
  "You are both NARRATOR and MECHANIC. Never confuse these roles.\n" +
  "- As NARRATOR: You describe the world, speak for NPCs, tell the story. Use natural language.\n" +
  "- As MECHANIC: You manage inventory, skills, quests, factions, conditions, and time. Use ONLY these exact tag formats:\n" +
  "  [INV:+item] / [INV:-item] / [INV:+3:item]\n" +
  "  [SKILL:+name] / [SKILL:+name:level] / [SKILL:name+2] / [SKILL:name-1]\n" +
  "  [QUEST:+name] (start) / [QUEST:✓name] (complete) / [QUEST:-name] (fail) / [QUEST:name: note]\n" +
  "  [FACTION:+name:delta] / [FACTION:-name:delta]\n" +
  "  [COND:+name] / [COND:+name:duration] / [COND:-name]\n" +
  "  [MOD:+popis] (add body modification) / [MOD:-popis] (remove body modification)\n" +
  "  [TIME:+1d] (advance one day — this is the ONLY time tag; the calendar has no clock, never write a clock time like [TIME:14:00])\n" +
  "IMPORTANT for [COND:...] and [MOD:...]: always reuse the exact same name for the same body part/effect " +
  "across the whole story — e.g. always \"left arm\", never switch to \"left hand\" or \"my arm\" for the same " +
  "injury. A new tag with a name that already exists REPLACES the old entry instead of adding a duplicate, " +
  "but only if the name matches exactly — inconsistent naming creates duplicate, contradictory entries " +
  "(e.g. two separate \"torn off arm\" records). This applies to non-humanoid anatomy too — e.g. for a " +
  "spider-like creature, use stable slot names like \"leg 1\"–\"leg 8\", not vague terms like \"a leg\".\n" +
  `Write tags as the Mechanic — never mix them into narrator text. Each tag on its own line, using the exact format above. At most 3 tags per response. Always respond in ${lang}.`;

export const DIALOG_EXAMPLE_HEADER = "[EXAMPLE OF CORRECT RESPONSE]";
export const DIALOG_EXAMPLE_BODY =
  "Player: I search the old chest.\n" +
  "GM: The chest creaked as you lifted its lid. Inside lies a rusty sword and a few coins. The air smells of mold.\n" +
  "[INV:+Rusty sword]\n" +
  "[INV:+10:Copper coins]\n" +
  "What do you do next?";

// ---- Faction labels (language-neutral game state) ----------------------

export function factionLabel(rep: number): string {
  if (rep <= -50) return "hostile";
  if (rep <= -20) return "suspicious";
  if (rep >= 50) return "allied";
  if (rep >= 20) return "friendly";
  return "neutral";
}

// ---- Persona labels (English, structural) ------------------------------

export const PERSONA_APPEARANCE = "Appearance:";
export const PERSONA_SKILLS = "Skills:";
export const PERSONA_LEVEL = "level";
export const PERSONA_INVENTORY = "Inventory:";
export const PERSONA_FACTION_REP = "Faction reputation:";

// ---- Group speaker -----------------------------------------------------

export const GROUP_SPEAKER_INSTRUCTION = (charName: string, otherNames: string, userName: string) =>
  `Speak and act only as ${charName}. Never speak for the player (${userName}) or other characters ` +
  `(${otherNames}). Do not start your reply with your name followed by a colon.`;

// ---- Continue instructions ---------------------------------------------

export const CONTINUE_AS = (name: string) => `[Continue the scene as ${name}.]`;
export const CONTINUE_EXACT = (name: string) =>
  `[Continue exactly where you left off as ${name}. Do not repeat text already written, just continue with the next words.]`;
export const CONTINUE_EXACT_SOLO =
  "[Continue exactly where you left off. Do not repeat text already written, just continue with the next words.]";

// ---- Inline suggestions ------------------------------------------------

export const SUGGEST_PROMPT = (lang: string) =>
  `[Out-of-story instruction: Suggest exactly 3 brief options for how the player's character could react or what to do next in this situation. Each option max 1–2 sentences, written in first person as the player's character. Use known facts and items from the story. Reply ONLY with a JSON array of three strings, no other text. Write options in ${lang}.]`;

// ---- Director notes (English) ------------------------------------------

export const DIRECTOR_PACE: Record<string, string> = {
  slow: "Slow down — develop scenes in detail, give space to atmosphere and conversations, do not advance the plot by more than one step at a time.",
  normal: "",
  fast: "Keep a brisk pace — shorter descriptions, faster cuts between events, the plot moves with every reply.",
};

export const DIRECTOR_TONE: Record<string, string> = {
  light: "Keep the tone lighthearted and playful; humor is welcome, grimness only rarely.",
  neutral: "",
  dark: "Keep the tone dark and serious; the world is dangerous, actions have consequences, humor only sparingly.",
  epic: "Keep the tone epic and majestic; grand gestures, high stakes, pathos is appropriate.",
};

export const DIRECTOR_FOCUS: Record<string, string> = {
  dialogue: "Focus scenes on conversations and relationships between characters.",
  balanced: "",
  action: "Focus scenes on action — combat, chases, physical obstacles.",
  exploration: "Focus scenes on exploration — environment, mysteries, discoveries.",
};

// ---- Game tag instructions (English) -----------------------------------

export const TAG_INSTRUCTIONS_CURRENT_INVENTORY = "Current inventory:";
export const TAG_INSTRUCTIONS_INVENTORY_CHANGES = "Inventory changes: [INV:+item] gain, [INV:-item] lose, [INV:+count:item] quantity.";
export const TAG_INSTRUCTIONS_CURRENT_SKILLS = "Current skills:";
export const TAG_INSTRUCTIONS_SKILL_CHANGES = "Skill changes: [SKILL:+name] learn (level 1), [SKILL:+name:level] set level, [SKILL:name+1] increase.";
export const TAG_INSTRUCTIONS_LEVEL_CURRENT = (lvl: number, xp: number) => `Current: level ${lvl}, ${xp} XP.`;
export const TAG_INSTRUCTIONS_LEVEL_CHANGES = "Changes: [LEVEL:+amount] adds XP.";
export const TAG_INSTRUCTIONS_CURRENT_CONDITIONS = "Current conditions/status effects:";
export const TAG_INSTRUCTIONS_CONDITION_CHANGES = "Condition changes: [COND:+name] add, [COND:+name:duration] add with duration, [COND:-name] remove. Check this list before adding — reuse the exact same name to update/avoid duplicates.";
export const TAG_INSTRUCTIONS_CURRENT_MODIFICATIONS = "Current body modifications:";
export const TAG_INSTRUCTIONS_MODIFICATION_CHANGES = "Modification changes: [MOD:+description] add, [MOD:-description] remove. Check this list before adding — reuse the exact same wording to update/avoid duplicates.";
export const TAG_PLACEMENT_HINT = "Place tags anywhere in the text — they will be automatically removed.";
/** Fold clause appended to a capped current-state list (inventory/skills/
 * conditions/modifications) once it exceeds the full-detail cap — the
 * oldest entries beyond the cap keep their NAME (never dropped, see
 * `promptBuilder.ts`'s state-list capping) but lose qty/level/duration
 * detail, folded into this trailing clause. English/language-neutral,
 * same category as the other GAME STATE labels above. */
export const TAG_LIST_FOLD_SUFFIX = (count: number) => `; +${count} more (name only): `;

// ---- Faction instructions (English) ------------------------------------

export const FACTION_INSTRUCTIONS_REACTIONS = "NPC reactions should reflect faction reputation: hostile (< -50), suspicious (< -20), neutral, friendly (> 20), allied (> 50).";
export const FACTION_INSTRUCTIONS_CHANGES = "Reputation changes: [FACTION:+name:value] increase, [FACTION:-name:value] decrease.";
export const FACTION_TAG_HINT = "Place tags anywhere in the text — they will be automatically removed.";

// ---- Crafting instructions (English) -----------------------------------

export const CRAFTING_INSTRUCTIONS_BASE =
  "Skill determines the QUALITY of the result, not the ability to craft. At skill 1, ingredients yield a weak item; at skill 9, a masterwork with bonus perks.\n" +
  "Ingredients are always consumed (even on failure). Legendary ingredients are rare (drop from bosses), not limited by skill.\n\n" +
  "Perk scale by skill:\n" +
  "- Skill 1–2: 0 perks, basic item\n" +
  "- Skill 3–5: 1 perk (Tier 1)\n" +
  "- Skill 6–8: 2 perks (Tier 1 + Tier 2)\n" +
  "- Skill 9–11: 3 perks (Tier 1 + Tier 2 + Tier 3)\n" +
  "- Skill 12+: 4 perks (Tier 1 + Tier 2 + Tier 3 + Tier 4)\n\n" +
  "Available perks by tier:\n" +
  "- Tier 1 (from skill 3): Sharpened, Rustproof, Light\n" +
  "- Tier 2 (from skill 6): Unbreakable, Precise, Protective\n" +
  "- Tier 3 (from skill 9): Mana-drawing, Leeching, Magic blade\n" +
  "- Tier 4 (from skill 12): Named, Soul in the blade\n\n" +
  "Tags:\n" +
  "- [CRAFT:result:ingredient1+ingredient2] — discover/record a recipe (ingredients are deducted from inventory)\n" +
  "- [CRAFTED:result] — successful crafting (perks auto-selected based on skill)\n" +
  "- [CRAFTED:result:perk1+perk2] — crafting with specific perks\n" +
  "Place tags anywhere in the text — they will be automatically removed.";

export const CRAFTING_KNOWN_RECIPES = "Known recipes:";

// ---- Trim notes (Czech debug strings — intentionally left as-is) -------

export const TRIM_MEMORIES = "Vzpomínky: vynechána nejméně relevantní scéna (rozpočet kontextu).";
export const TRIM_LORE = (entryId: string) => `Lorebook: vynechán záznam „${entryId}" (nízká priorita, rozpočet kontextu).`;
export const TRIM_HISTORY = "Historie: vynechána starší zpráva (rozpočet kontextu).";
export const TRIM_SUMMARY = "Shrnutí: zkráceno od začátku (rozpočet kontextu).";
export const TRIM_FACT = (category: string, subject: string) =>
  `Fakta: vynechán fakt „(${category}/${subject})" (rozpočet kontextu).`;
export const TRIM_MES_EXAMPLE = "Ukázka stylu dialogu: vynechána (rozpočet kontextu).";
export const TRIM_STATE_LIST = "Herní stav (inventář/dovednosti/stavy/úpravy): omezen počet položek se stručným detailem, jména zůstávají (rozpočet kontextu).";
