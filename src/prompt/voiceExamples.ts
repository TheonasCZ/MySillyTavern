/** Voice-example and mes-example section builders extracted from
 * promptBuilder.ts (§6.2 refactor). Renders `[DIALOG EXAMPLE]` and
 * `[VOICE EXAMPLES]` blocks. */

import { SECTION_DIALOG_EXAMPLE, SECTION_VOICE_EXAMPLES } from "./promptTexts";
import { substitutePlaceholders, type CharacterLike } from "./promptBuilder";

/** Builds the `[DIALOG EXAMPLE]` section from the character's mes_example
 * field. Returns "" when the field is empty or whitespace-only. */
export function buildMesExampleSection(
  character: CharacterLike,
  charName: string,
  userName: string,
): string {
  const trimmed = character.mesExample.trim();
  if (!trimmed) return "";
  return `${SECTION_DIALOG_EXAMPLE}\n${substitutePlaceholders(trimmed, charName, userName)}`;
}

/** Builds the `[VOICE EXAMPLES]` section from historically similar replies
 * (embedding-based voice-consistency examples). Returns "" when the array
 * is empty or absent. */
export function buildVoiceExamplesSection(examples: string[]): string {
  if (!examples || examples.length === 0) return "";
  return `${SECTION_VOICE_EXAMPLES}\n${examples.map((e) => `---\n${e}`).join("\n")}`;
}
