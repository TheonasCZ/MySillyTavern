import type { Character } from "../db/repositories/charactersRepo";

/** Used when a character has no `system_prompt` of its own. Kept short and
 * generic — the full PromptBuilder (persona substitution, ledger facts,
 * lorebook, budget/trimming) lands in M5; this is just enough to make a
 * chat coherent today. */
const DEFAULT_RP_INSTRUCTIONS =
  "Jsi vypravěč hry na hrdiny (RP). Hraj roli postavy {{char}} podle popisu níže, " +
  "drž se jejího charakteru a scénáře. Akce a gesta piš kurzívou, přímou řeč normálně. " +
  "Nikdy nemluv ani nejednej za hráče.";

function substituteCharName(text: string, charName: string): string {
  return text.replace(/\{\{char\}\}/gi, charName);
}

/** Builds a simple system message from a character card's fields:
 * `system_prompt` (or a default RP instruction) + description + personality
 * + scenario, with `{{char}}` replaced by the character's name throughout. */
export function buildCharacterSystemPrompt(character: Character): string {
  const base = character.systemPrompt.trim() || DEFAULT_RP_INSTRUCTIONS;
  const parts = [base, character.description, character.personality, character.scenario]
    .map((p) => p.trim())
    .filter(Boolean);
  return substituteCharName(parts.join("\n\n"), character.name);
}

/** Picks the greeting to use as a chat's first assistant message: either an
 * explicitly chosen one (from `first_mes` + `alternate_greetings`) or the
 * card's default `first_mes`. Falls back to a generic opener when the card
 * has neither. */
export function resolveGreeting(character: Character, chosen: string | null): string {
  const text = chosen ?? character.firstMes ?? "";
  const trimmed = text.trim();
  if (!trimmed) return "";
  return substituteCharName(trimmed, character.name);
}

/** All greeting options a "new chat" form can offer for a character:
 * `first_mes` first, then `alternate_greetings`, deduplicated. */
export function greetingOptions(character: Character): string[] {
  const options = [character.firstMes, ...character.alternateGreetings]
    .map((g) => g.trim())
    .filter(Boolean);
  return Array.from(new Set(options));
}
