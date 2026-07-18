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
\`[TIME:+1d]\` / \`[TIME:+1h]\` / \`[TIME:+15m]\` — posunout herní čas (den/hodina/minuty)`;
}

/** Formats a dice roll result for the chat as a system message content.
 * The Rust `eval_dice` command already returns a fully formatted string
 * (e.g. `"2d6+3 = 8 (3+2+3) = 8"`), so we just prefix it with the dice
 * emoji. */
export function formatDiceSystemMessage(_expression: string, result: string): string {
  return `🎲 ${result}`;
}

/** Matches the quick-roll tag ChatInput appends to a player message —
 *  `[ROLL:1d20=14]` or `[ROLL:1d20+3=17]` — see TWO_ROLES_INSTRUCTIONS
 *  (RISK AND COST). Exported so display code and any future consumer share
 *  one definition instead of duplicating the pattern. */
const ROLL_TAG_RE = /\[ROLL:([^\]=]+)=(-?\d+)\]/g;

/** Matches simple `NdM` dice notation (e.g. "1d4", "2d6") anywhere in a
 *  string — used to resolve unresolved dice notation the model writes into
 *  a [COND:+name:duration] tag (see resolveDiceNotation below). Doesn't
 *  handle modifiers (+3) or adv/dis — those aren't meaningful for a
 *  duration, just a plain roll total. */
const INLINE_DICE_RE = /(\d+)\s*d\s*(\d+)/i;

/** Resolves the first `NdM` dice notation found in `text` into its rolled
 *  total, in place — e.g. "1d4 dny" → "3 dny" — via the same Rust dice
 *  engine as the `/r` command and the quick-roll button, so there's exactly
 *  one source of randomness in the app. Text with no dice notation (e.g.
 *  already-resolved durations like "2 dny" or "until treated") passes
 *  through unchanged. Never throws — falls back to the original text if the
 *  roll fails for any reason. */
export async function resolveDiceNotation(text: string): Promise<string> {
  const match = text.match(INLINE_DICE_RE);
  if (!match) return text;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const expression = `${match[1]}d${match[2]}`;
    const result: string = await invoke("eval_dice", { expression });
    const total = result.slice(result.lastIndexOf("=") + 1).trim();
    if (!/^-?\d+$/.test(total)) return text;
    return `${text.slice(0, match.index)}${total}${text.slice((match.index ?? 0) + match[0].length)}`;
  } catch {
    return text;
  }
}

/** Rewrites raw `[ROLL:expr=total]` tags into a readable "🎲 expr → total"
 *  form for display only — the stored message content (and what the model
 *  reads) keeps the raw tag; only rendering is prettified. Safe to call on
 *  any message content, including ones with no roll tag (no-op). */
export function formatRollTagForDisplay(content: string): string {
  return content.replace(ROLL_TAG_RE, (_m, expression: string, total: string) => `🎲 ${expression} → ${total}`);
}
