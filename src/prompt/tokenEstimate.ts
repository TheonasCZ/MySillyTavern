/** Chars-per-token used by the estimate below. English-heavy text tokenizes
 * close to 4 chars/token with typical BPE tokenizers, but this app's chat
 * text is overwhelmingly Czech (diacritics, richer inflection — more
 * subword fragments per word), which measured consistently closer to
 * ~3.3 chars/token against real chat transcripts. Using 4 here systematically
 * undershoots the real prompt size, which matters because PromptBuilder's
 * budget trimming (and the memory panel's over-budget warning) both trust
 * this number — an undershoot means the trimmer stops cutting before the
 * prompt is actually back within the model's real context budget. */
const CHARS_PER_TOKEN = 3.3;

/** Shared rough token estimate used across the app (PromptBuilder, lorebook
 * activation budget, memory panel report). Pure, no DB/Tauri import — keeps
 * PromptBuilder unit-testable without booting the Tauri runtime (plan §6.2). */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}
