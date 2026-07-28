// Chat log — records every prompt sent to the AI and every response
// received into per-chat files (`chat-{chatId}.log`) in the same
// `$APPDATA/logs/` directory as `app.log`. When a chat is deleted its
// log file is deleted too. The user can inspect what the model actually
// saw vs what it returned directly from the Diagnostics panel.
//
// Fire-and-forget: a failed write never surfaces to the user — same
// reliability posture as the error logger (`src/logging.ts`).

import { invoke } from "@tauri-apps/api/core";
import type { ChatMessage } from "../providers/types";

// Connections here run context budgets up to 50,000 tokens (~150,000+ chars
// for Czech text — see memory-anchoring-tuning notes on chars/token). The
// old 16,000 cap was far smaller than a real prompt, so it silently cut
// into the character card/canon block on essentially every exchange once a
// campaign had any history — never even reaching later sections. Generous
// but still bounded; see formatPrompt for why truncation now keeps the
// *tail*, not the head, of an oversized prompt.
const MAX_SECTION_CHARS = 100_000; // per section (prompt / response), before the Rust cap (see logging.rs)

/** Formats `apiMessages` (the exact array sent to the model) into a
 *  human-readable text block. System/user/assistant roles are labeled;
 *  tool calls and function responses are included but collapsed to one
 *  line each to keep the prompt block compact. */
function formatPrompt(apiMessages: ChatMessage[]): string {
  const lines: string[] = [];
  for (const msg of apiMessages) {
    const role = msg.role;
    const content = msg.content ?? "";

    if (msg.function_call) {
      lines.push(
        `[assistant → function_call ${msg.function_call.name}(${JSON.stringify(msg.function_call.args)})]`,
      );
      continue;
    }
    if (msg.function_response) {
      const resp = msg.function_response.response;
      const summary =
        typeof resp === "object" && resp !== null && "result" in resp
          ? String((resp as { result: unknown }).result).slice(0, 120)
          : JSON.stringify(resp).slice(0, 120);
      lines.push(`[function_response ${msg.function_response.name}: ${summary}]`);
      continue;
    }

    const label = role === "system" ? "SYSTEM" : role === "assistant" ? "ASSISTANT" : "USER";
    const body = content.slice(0, MAX_SECTION_CHARS);
    lines.push(`--- ${label} ---\n${body}`);
  }
  const full = lines.join("\n");
  if (full.length <= MAX_SECTION_CHARS) return full;
  // Keep the *tail*, not the head. The array is ordered system → history →
  // newest user turn last, and the mostly-static character card/canon
  // block at the front repeats near-identically across every exchange —
  // the least useful thing to preserve when something has to give. The
  // newest player message and the trailing canon reminder are always at
  // the end and are what a debugging session actually needs.
  const omittedChars = full.length - MAX_SECTION_CHARS;
  return `…[${omittedChars} chars trimmed from the start of the prompt]…\n${full.slice(-MAX_SECTION_CHARS)}`;
}

/** Formats a single prompt+response exchange into one log block. Each
 *  block is delimited by `══════` lines so the viewer can jump between
 *  exchanges visually. The frontend calls `invoke("append_chat_log")`
 *  with the full block — the Rust side handles rotation + truncation. */
export function logChatExchange(
  connectionName: string,
  modelName: string,
  chatId: string | null | undefined,
  apiMessages: ChatMessage[],
  responseText: string,
) {
  const ts = new Date().toISOString();
  const conn = `${connectionName}/${modelName}`;
  const chatTag = chatId ? ` chat=${chatId}` : "";
  const promptBlock = formatPrompt(apiMessages);
  const respBlock = responseText.slice(0, MAX_SECTION_CHARS);

  const block = [
    `══════ PROMPT ${ts} ${conn}${chatTag} ══════`,
    promptBlock,
    `══════ RESPONSE ${ts} ${conn}${chatTag} (${responseText.length} chars) ══════`,
    respBlock,
    "", // trailing newline so the next exchange starts on a fresh line
  ].join("\n");

  if (!chatId) return; // per-chat file requires a chat ID
  void invoke("append_chat_log", { chatId, line: block }).catch(() => {});
}
