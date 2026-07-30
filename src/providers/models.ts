import { invoke } from "@tauri-apps/api/core";

import type { ConnectionPurpose, Provider } from "./types";

/** Lists the provider's available model ids, authenticated with the API key
 * stored in the keyring for the given connection. `purpose` narrows Gemini's
 * result to embedding-capable models instead of chat-capable ones — the two
 * are disjoint on Gemini. */
export async function listModels(
  connectionId: string,
  provider: Provider,
  baseUrl: string | null,
  purpose?: ConnectionPurpose,
): Promise<string[]> {
  return invoke<string[]>("list_models", { connectionId, provider, baseUrl, purpose });
}
