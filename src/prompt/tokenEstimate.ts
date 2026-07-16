/** Shared rough token estimate used across the app (PromptBuilder, lorebook
 * activation budget, memory panel report): ~4 chars/token. Pure, no
 * DB/Tauri import — keeps PromptBuilder unit-testable without booting the
 * Tauri runtime (plan §6.2). */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}
