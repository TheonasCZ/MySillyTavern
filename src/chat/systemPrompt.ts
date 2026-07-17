import type { Character } from "../db/repositories/charactersRepo";
import type { Persona } from "../db/repositories/personasRepo";
import type { LoreEntryLike } from "../lorebooks/activation";
import {
  RP_INSTRUCTIONS,
  PERSONA_APPEARANCE,
  PERSONA_SKILLS,
  PERSONA_LEVEL,
  PERSONA_INVENTORY,
  SECTION_PERSONA,
  SECTION_LOREBOOK,
} from "../prompt/promptTexts";

/** Used when a character has no `system_prompt` of its own. Kept short and
 * generic — the full PromptBuilder (ledger facts, summaries, budget/
 * trimming) lands in M5; this composes card + persona + lorebook (M4). */
const DEFAULT_RP_INSTRUCTIONS_CS =
  "Jsi vypravěč hry na hrdiny (RP). Hraj roli postavy {{char}} podle popisu níže, " +
  "drž se jejího charakteru a scénáře. Akce a gesta piš kurzívou, přímou řeč normálně. " +
  "Nikdy nemluv ani nejednej za hráče ({{user}}).";

/** Fallback shown when a chat has no persona selected — matches plan
 * §7 M4 wording verbatim ("nebo fallback „User""). */
export const DEFAULT_USER_NAME = "User";

/** The name to substitute `{{user}}` with: the persona's name, trimmed, or
 * the fallback when there's no persona (or it has a blank name). */
export function personaDisplayName(persona: Persona | null): string {
  return persona?.name.trim() || DEFAULT_USER_NAME;
}

/** Replaces both `{{char}}` and `{{user}}` placeholders (case-insensitive,
 * SillyTavern-style) throughout `text` — used for card fields, persona
 * description and lore entry content alike. */
export function substitutePlaceholders(text: string, charName: string, userName: string): string {
  return text.replace(/\{\{char\}\}/gi, charName).replace(/\{\{user\}\}/gi, userName);
}

/** Builds a simple system message from a character card's fields:
 * `system_prompt` (or a default RP instruction) + description + personality
 * + scenario + the player persona's description, with `{{char}}`/`{{user}}`
 * replaced throughout. `persona` is optional so chats without one selected
 * still work (falls back to the generic "User" name). */
export function buildCharacterSystemPrompt(character: Character, persona: Persona | null = null, lang?: string): string {
  const userName = personaDisplayName(persona);
  const language = lang ?? "cs";
  const base = character.systemPrompt.trim() || (language === "cs" ? DEFAULT_RP_INSTRUCTIONS_CS : RP_INSTRUCTIONS(language));
  const parts = [base, character.description, character.personality, character.scenario].map((p) =>
    p.trim(),
  );

  // Build persona description from structured fields
  if (persona) {
    const personaLines: string[] = [];
    const identity: string[] = [];
    if (persona.gender) identity.push(persona.gender);
    if (persona.age) identity.push(`${persona.age} let`);
    if (persona.race) identity.push(persona.race);
    if (identity.length > 0) personaLines.push(identity.join(", "));

    if (persona.appearance) {
      personaLines.push(`\n${PERSONA_APPEARANCE} ${persona.appearance}`);
    }

    if (persona.skills.length > 0) {
      personaLines.push(`\n${PERSONA_SKILLS}`);
      for (const s of persona.skills) {
        personaLines.push(`- ${s.name} (${PERSONA_LEVEL} ${s.level})`);
      }
    }

    if (persona.inventory.length > 0) {
      personaLines.push(`\n${PERSONA_INVENTORY}`);
      for (const inv of persona.inventory) {
        personaLines.push(`- ${inv.item}${inv.qty > 1 ? ` x${inv.qty}` : ""}`);
      }
    }

    if (personaLines.length > 0) {
      parts.push(`${SECTION_PERSONA(userName)}\n${personaLines.join("\n")}`);
    }
  }

  const joined = parts.filter(Boolean).join("\n\n");
  return substitutePlaceholders(joined, character.name, userName);
}

/** Formats the entries selected by `lorebooks/activation.ts` into a system
 * message block, `{{char}}`/`{{user}}` substituted in their content.
 * Returns "" when nothing activated, so callers can skip an empty block. */
export function buildLoreSection(
  entries: LoreEntryLike[],
  character: Character,
  persona: Persona | null = null,
): string {
  if (entries.length === 0) return "";
  const userName = personaDisplayName(persona);
  const lines = entries.map(
    (e) => `- ${substitutePlaceholders(e.content.trim(), character.name, userName)}`,
  );
  return `${SECTION_LOREBOOK}\n${lines.join("\n")}`;
}

/** Combines the character system prompt with the activated lorebook
 * entries into the single system message sent to the model. */
export function buildFullSystemMessage(
  character: Character,
  persona: Persona | null,
  loreEntries: LoreEntryLike[],
): string {
  const base = buildCharacterSystemPrompt(character, persona);
  const lore = buildLoreSection(loreEntries, character, persona);
  return [base, lore].filter(Boolean).join("\n\n");
}

/** Picks the greeting to use as a chat's first assistant message: either an
 * explicitly chosen one (from `first_mes` + `alternate_greetings`) or the
 * card's default `first_mes`. Falls back to a generic opener when the card
 * has neither. */
export function resolveGreeting(
  character: Character,
  chosen: string | null,
  persona: Persona | null = null,
): string {
  const text = chosen ?? character.firstMes ?? "";
  const trimmed = text.trim();
  if (!trimmed) return "";
  return substitutePlaceholders(trimmed, character.name, personaDisplayName(persona));
}

/** All greeting options a "new chat" form can offer for a character:
 * `first_mes` first, then `alternate_greetings`, deduplicated. */
export function greetingOptions(character: Character): string[] {
  const options = [character.firstMes, ...character.alternateGreetings]
    .map((g) => g.trim())
    .filter(Boolean);
  return Array.from(new Set(options));
}
