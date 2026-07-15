import { invoke } from "@tauri-apps/api/core";

import { toConnectionDto } from "./dto";
import type { ChatMessage, ConnectionConfig } from "./types";

/** Non-streamed completion — used for the "test connection" button in M1.
 * Full streaming (`chatStream`) lands in M2. */
export async function chatComplete(
  connection: ConnectionConfig,
  messages: ChatMessage[],
): Promise<string> {
  return invoke<string>("chat_complete", {
    connection: toConnectionDto(connection),
    messages,
  });
}
