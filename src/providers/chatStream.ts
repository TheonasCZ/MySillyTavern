import { Channel, invoke } from "@tauri-apps/api/core";

import { toConnectionDto } from "./dto";
import type { ChatMessage, ConnectionConfig, StreamEvent } from "./types";

export interface StreamDoneInfo {
  finishReason: string;
}

export interface StreamErrorInfo {
  message: string;
  retryable: boolean;
}

export interface StreamCallbacks {
  onToken(text: string): void;
  onDone(info: StreamDoneInfo): void;
  onError(err: StreamErrorInfo): void;
  /** EXPERIMENTAL (function-calling prototype): fires instead of `onDone`/
   * `onError` when the model paused generation to invoke a tool (only
   * possible when `tools: true` was passed to `chatStream`). The caller is
   * responsible for executing the tool and resuming with a fresh
   * `chatStream` call — see `src/chat/toolCalling.ts`. */
  onFunctionCall?(name: string, args: unknown, thoughtSignature?: string): void;
}

export interface ChatStreamHandle {
  requestId: string;
  abort(): Promise<void>;
}

/** Thin wrapper over the Rust `chat_stream` command. Tokens are delivered
 * to `onToken` as soon as they arrive — no debounce/batching, per the "word
 * by word" UX requirement. Logs time-to-first-token in dev builds. */
export function chatStream(
  connection: ConnectionConfig,
  messages: ChatMessage[],
  callbacks: StreamCallbacks,
  /** EXPERIMENTAL (function-calling prototype): when true, offers the
   * `get_item_detail` tool (Gemini connections only — silently ignored by
   * other providers). Defaults to false. */
  tools = false,
): ChatStreamHandle {
  const requestId = crypto.randomUUID();
  const channel = new Channel<StreamEvent>();
  const startedAt = performance.now();
  let firstTokenLogged = false;

  channel.onmessage = (event) => {
    switch (event.event) {
      case "Start":
        break;
      case "Token":
        if (!firstTokenLogged) {
          firstTokenLogged = true;
          if (import.meta.env.DEV) {
            console.debug(
              `[chatStream] first token after ${(performance.now() - startedAt).toFixed(0)}ms`,
            );
          }
        }
        callbacks.onToken(event.data.text);
        break;
      case "Done":
        callbacks.onDone({ finishReason: event.data.finish_reason });
        break;
      case "Error":
        callbacks.onError(event.data);
        break;
      case "FunctionCall":
        if (callbacks.onFunctionCall) {
          callbacks.onFunctionCall(event.data.name, event.data.args, event.data.thoughtSignature);
        } else {
          // No handler wired up (shouldn't happen when `tools` is true) —
          // fail safe rather than leave the UI hanging forever.
          callbacks.onError({
            message: `Model zavolal nástroj „${event.data.name}“, ale volání nástrojů zde není zapojeno.`,
            retryable: false,
          });
        }
        break;
    }
  };

  void invoke("chat_stream", {
    requestId,
    connection: toConnectionDto(connection),
    messages,
    onEvent: channel,
    tools,
  }).catch((err) => {
    callbacks.onError({ message: String(err), retryable: false });
  });

  return {
    requestId,
    abort: async () => {
      await invoke("chat_abort", { requestId });
    },
  };
}
