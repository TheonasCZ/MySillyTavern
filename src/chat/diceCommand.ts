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

/** Formats a dice roll result for the chat as a system message content.
 * The Rust `eval_dice` command already returns a fully formatted string
 * (e.g. `"2d6+3 = 8 (3+2+3) = 8"`), so we just prefix it with the dice
 * emoji. */
export function formatDiceSystemMessage(_expression: string, result: string): string {
  return `🎲 ${result}`;
}
