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
            console.log(
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
    }
  };

  void invoke("chat_stream", {
    requestId,
    connection: toConnectionDto(connection),
    messages,
    onEvent: channel,
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
