import { invoke } from "@tauri-apps/api/core";

import type { Provider } from "./types";

/** Lists the provider's available model ids, authenticated with the API key
 * stored in the keyring for the given connection. */
export async function listModels(
  connectionId: string,
  provider: Provider,
  baseUrl: string | null,
): Promise<string[]> {
  return invoke<string[]>("list_models", { connectionId, provider, baseUrl });
}
