/** Rolling summarizer (plan §6.3): folds messages that have scrolled past
 * the verbatim window into the chat's running summary, so PromptBuilder's
 * `[DOSAVADNÍ PŘÍBĚH]` block stays short instead of the prompt growing
 * without bound. */

import { chatComplete } from "../providers/chatComplete";
import type { ChatMessage, ConnectionConfig } from "../providers/types";
import { getSummary, upsertSummary } from "../db/repositories/summariesRepo";
import type { Message } from "../db/repositories/messagesRepo";

const SUMMARY_SYSTEM_PROMPT =
  "Jsi nástroj, který udržuje stručné shrnutí dosavadního příběhu RP hry. Dostaneš " +
  "dosavadní shrnutí (může být prázdné) a nové události od poslední aktualizace. Vrať " +
  "aktualizované shrnutí v maximálně přibližně 300 slovech, které zahrnuje staré i nové " +
  "podstatné události v chronologickém pořadí. Piš věcně, ve třetí osobě, bez uvozovek a " +
  "bez nadpisů — jen souvislý text shrnutí, nic jiného.";

function formatMessages(messages: Message[]): string {
  return messages.map((m) => `${m.role === "assistant" ? "AI" : "Hráč"}: ${m.content}`).join("\n");
}

/** Builds the messages array for the chat_complete call. Pure/testable in
 * isolation from the DB/provider wiring. */
export function buildSummaryPrompt(previousSummary: string, newMessages: Message[]): ChatMessage[] {
  return [
    { role: "system", content: SUMMARY_SYSTEM_PROMPT },
    {
      role: "user",
      content:
        `Dosavadní shrnutí:\n${previousSummary.trim() || "(zatím žádné)"}\n\n` +
        `Nové události:\n${formatMessages(newMessages)}`,
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
  messagesToFold: Message[],
): Promise<void> {
  if (messagesToFold.length === 0) return;
  try {
    const existing = await getSummary(chatId);
    const prompt = buildSummaryPrompt(existing?.text ?? "", messagesToFold);
    const text = await chatComplete(connection, prompt);
    const trimmed = text.trim();
    if (!trimmed) return;
    const upToMessageId = messagesToFold[messagesToFold.length - 1].id;
    await upsertSummary(chatId, upToMessageId, trimmed);
  } catch (err) {
    console.warn("summarization failed", err);
  }
}
