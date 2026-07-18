/** Rolling summarizer (plan §6.3): folds messages that have scrolled past
 * the verbatim window into the chat's running summary, so PromptBuilder's
 * `[DOSAVADNÍ PŘÍBĚH]` block stays short instead of the prompt growing
 * without bound. */

import { chatComplete } from "../providers/chatComplete";
import type { ChatMessage, ConnectionConfig } from "../providers/types";
import { getSummary, upsertSummary } from "../db/repositories/summariesRepo";
import type { Message } from "../db/repositories/messagesRepo";
import { logUsage } from "../db/repositories/usageRepo";
import { estimateTokens } from "../prompt/tokenEstimate";
import { scoreImportance, formatScoredMessages } from "./importance";
import { SUMMARY_SYSTEM_PROMPT } from "../prompt/promptTexts";



/** Message with an optional group-chat speaker name (plan §M10) — additive
 * over `Message` so existing callers still typecheck. */
export type TranscriptMessage = Message & { speakerName?: string | null };

function formatMessages(messages: TranscriptMessage[]): string {
  return messages
    .map((m) => `${m.speakerName ?? (m.role === "assistant" ? "AI" : "Player")}: ${m.content}`)
    .join("\n");
}

/** Builds the messages array for the chat_complete call. Pure/testable in
 * isolation from the DB/provider wiring. */
export function buildSummaryPrompt(
  previousSummary: string,
  newMessages: TranscriptMessage[],
  scores?: Map<string, number>,
  lang?: string,
): ChatMessage[] {
  const language = lang ?? "cs";
  const formatted = scores
    ? formatScoredMessages(newMessages, scores)
    : formatMessages(newMessages);
  return [
    { role: "system", content: SUMMARY_SYSTEM_PROMPT(language) },
    {
      role: "user",
      content:
        `Previous summary:\n${previousSummary.trim() || "(none yet)"}\n\n` +
        `New events:\n${formatted}`,
    },
  ];
}

/** Runs one summarization pass: takes `messagesToFold` (already selected by
 * the caller as "messages older than the verbatim window that haven't been
 * summarized yet"), asks the model to fold them into the previous summary,
 * and persists the result along with the new `up_to_message_id`. Never
 * throws — failures are logged and left for the next scheduled attempt
 * (plan §6.3/§9). */
export async function runSummarization(
  chatId: string,
  connection: ConnectionConfig,
  messagesToFold: TranscriptMessage[],
  lang?: string,
): Promise<void> {
  if (messagesToFold.length === 0) return;
  try {
    const existing = await getSummary(chatId);
    const scores = scoreImportance(messagesToFold);
    const prompt = buildSummaryPrompt(existing?.text ?? "", messagesToFold, scores, lang);
    const text = await chatComplete(connection, prompt);
    const inputTokens = prompt.reduce((sum, m) => sum + estimateTokens(m.content), 0);
    void logUsage("memory", connection.id, inputTokens, estimateTokens(text)).catch(() => {});
    const trimmed = text.trim();
    if (!trimmed) return;
    const upToMessageId = messagesToFold[messagesToFold.length - 1].id;
    await upsertSummary(chatId, upToMessageId, trimmed);
  } catch (err) {
    console.warn("summarizer: summarization failed for chat", chatId, err);
  }
}
