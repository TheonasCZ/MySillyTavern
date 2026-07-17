/**
 * Dice command helpers for the `/r` chat command.
 *
 * When a player types `/r 2d6+3`, the frontend detects it and calls the
 * Rust `eval_dice` command. The result is sent as a system message so the
 * LLM can react to it.
 */

/** Returns true when the chat input starts with `/r ` (case-insensitive). */
export function isDiceCommand(text: string): boolean {
  return /^\/r\s/i.test(text);
}

/** Extracts the dice expression after the `/r ` prefix. Returns the trimmed
 * expression or an empty string when there is nothing after `/r `. Never
 * throws. */
export function extractDiceExpression(text: string): string {
  const match = text.match(/^\/r\s+(.+)/i);
  return match ? match[1].trim() : "";
}

export function isHelpCommand(text: string): boolean {
  return /^\/help/i.test(text.trim());
}

export function getHelpText(): string {
  return `📖 **Dostupné herní příkazy:**

**Kostky:**
\`/r 2d6+3\` — hod kostkou (podporuje ± modifikátory, např. \`/r 1d20-2\`)

**Herní tagy (automaticky zpracované AI):**
\`[INV:+předmět]\` — přidat do inventáře
\`[INV:-předmět]\` — odebrat z inventáře
\`[SKILL:+jméno]\` — naučit dovednost (level 1)
\`[SKILL:jméno+1]\` — zvýšit dovednost
\`[QUEST:+jméno]\` — začít quest
\`[QUEST:✓jméno]\` — dokončit quest
\`[FACTION:+jméno:10]\` — změnit reputaci frakce
\`[COND:+jméno:popis]\` — přidat stav (efekt)
\`[CRAFT:výsledek:ingredience1+ingredience2]\` — objevit recept
\`[TIME:+1d]\` — posunout herní čas o 1 den`;
}

/** Formats a dice roll result for the chat as a system message content.
 * The Rust `eval_dice` command already returns a fully formatted string
 * (e.g. `"2d6+3 = 8 (3+2+3) = 8"`), so we just prefix it with the dice
 * emoji. */
export function formatDiceSystemMessage(_expression: string, result: string): string {
  return `🎲 ${result}`;
}
