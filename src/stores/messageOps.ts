import type { ChatMessage, ConnectionConfig } from "../providers/types";
import { chatStream, type ChatStreamHandle } from "../providers/chatStream";
import { lookupItemDetailForChat } from "../chat/toolCalling";
import { processGameResponse } from "../chat/inventoryProcessor";
import { logChatUsage, resolveChatPersona, MAX_FUNCTION_CALL_ROUND_TRIPS } from "./configOps";
import type { Setter, Getter } from "./chatStoreTypes";

export function startStream(
  connection: ConnectionConfig,
  apiMessages: ChatMessage[],
  set: Setter,
  get: Getter,
  finalize: (content: string, interrupted: boolean) => Promise<void>,
  retry: () => void,
  refreshChatState: (chatId: string) => Promise<void>,
  // EXPERIMENTAL: number of `get_item_detail` round trips already spent on
  // this reply — see `MAX_FUNCTION_CALL_ROUND_TRIPS`.
  functionCallDepth = 0,
) {
  set({
    streaming: true,
    streamingText: "",
    error: null,
    errorRetryable: false,
    retry: null,
    // Only invoked by `stop()` (manual abort) — always a partial response,
    // so it's always flagged as interrupted.
    pendingFinalize: (text) => finalize(text, true),
  });

  // EXPERIMENTAL (function-calling prototype): only Gemini connections get
  // the `get_item_detail` tool offered (see gemini.rs — the other providers
  // don't implement it), and only up to the round-trip cap.
  const offerTools = connection.provider === "gemini" && functionCallDepth < MAX_FUNCTION_CALL_ROUND_TRIPS;

  // `streaming` stays true until `finalize` has actually persisted the
  // message and updated `messages` — clearing it earlier would make the
  // streaming bubble disappear for a frame before the real message row
  // takes its place.
  const handle: ChatStreamHandle = chatStream(
    connection,
    apiMessages,
    {
      onToken: (text) => {
        set((s) => ({ streamingText: s.streamingText + text }));
      },
      onDone: () => {
        const text = get().streamingText;
        set({ handle: null, pendingFinalize: null });
        logChatUsage(connection.id, apiMessages, text);
        // Process inventory tags — resolve persona and clean text
        const chat = get().chat;
        void (async () => {
          const persona = chat ? await resolveChatPersona(chat) : null;
          const finalText = await processGameResponse(persona, text, chat?.id);
          // processGameResponse may have mutated the chat's inventory/skills/
          // conditions/xp/level in the DB directly (bypassing this store) —
          // refresh so InventoryPanel and any other live-state UI re-render
          // instead of showing a stale snapshot.
          if (chat?.id) void refreshChatState(chat.id);
          void finalize(finalText, false);
        })();
      },
      onError: (err) => {
        const text = get().streamingText;
        const isOffline = typeof navigator !== "undefined" && !navigator.onLine;
        set({
          handle: null,
          pendingFinalize: null,
          error: isOffline ? "offline" : err.message,
          errorRetryable: isOffline || err.retryable,
          retry: isOffline || err.retryable ? retry : null,
        });
        // A stream that errored out mid-response still leaves useful partial
        // text — persist it (flagged as interrupted) instead of discarding it,
        // so the user can pick it up with "continue"/"regenerate" (plan §9).
        logChatUsage(connection.id, apiMessages, text);
        void finalize(text, true);
      },
      // EXPERIMENTAL (function-calling prototype): the model paused to call
      // `get_item_detail`. Look the name up against the chat's live state,
      // append the call + its result to the conversation, and issue a fresh
      // `chat_stream` call to resume generation — this is the whole
      // round-trip this prototype exists to prove out.
      onFunctionCall: (name, args, thoughtSignature) => {
        const chat = get().chat;
        const startedAt = performance.now();
        if (import.meta.env.DEV) {
          console.info(`[toolCalling] model called ${name}(${JSON.stringify(args)}) — round trip ${functionCallDepth + 1}/${MAX_FUNCTION_CALL_ROUND_TRIPS}`);
        }
        void (async () => {
          const argName =
            args && typeof args === "object" && "name" in args && typeof (args as { name: unknown }).name === "string"
              ? (args as { name: string }).name
              : String(args ?? "");

          let result: string;
          if (!chat?.id) {
            result = "Nelze vyhledat — chat není načten.";
          } else {
            try {
              result = await lookupItemDetailForChat(chat.id, argName);
            } catch (err) {
              result = `Vyhledání selhalo: ${String(err)}`;
            }
          }

          if (import.meta.env.DEV) {
            console.info(`[toolCalling] lookup for "${argName}" resolved in ${(performance.now() - startedAt).toFixed(0)}ms: ${result}`);
          }

          const nextMessages: ChatMessage[] = [
            ...apiMessages,
            { role: "assistant", content: "", function_call: { name, args, thoughtSignature } },
            { role: "user", content: "", function_response: { name, response: { result } } },
          ];
          startStream(connection, nextMessages, set, get, finalize, retry, refreshChatState, functionCallDepth + 1);
        })();
      },
    },
    offerTools,
  );

  set({ handle });
}

/** Extracts up to 3 suggestion strings from the model's reply. Prefers the
 *  requested JSON array (tolerating markdown fences / surrounding prose);
 *  falls back to numbered or bulleted lines when the model ignores the
 *  format, so the button still works with weaker models. */
export function parseSuggestions(reply: string): string[] {
  const jsonMatch = reply.match(/\[[\s\S]*\]/);
  if (jsonMatch) {
    try {
      const parsed: unknown = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed)) {
        const items = parsed.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
        if (items.length > 0) return items.slice(0, 3).map((s) => s.trim());
      }
    } catch {
      // fall through to line-based parsing
    }
  }
  return reply
    .split("\n")
    .map((line) => line.replace(/^\s*(?:\d+[.)]\s*|[-*•]\s*)/, "").trim())
    .filter((line) => line.length > 0 && !/^```/.test(line))
    .slice(0, 3);
}
