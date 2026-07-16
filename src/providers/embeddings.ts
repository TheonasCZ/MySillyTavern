import { invoke } from "@tauri-apps/api/core";

import type { ConnectionConfig } from "./types";

export interface EmbedResult {
  model: string;
  vectors: number[][];
}

/** Embeds a batch of texts via the connection's provider (Gemini/OpenAI;
 * Claude has no embedding API and rejects). Returns the embedding model id
 * plus one vector per text, in input order. `model` overrides the
 * per-provider default (the `embedding_model` setting). */
export async function embedTexts(
  connection: ConnectionConfig,
  texts: string[],
  model?: string | null,
): Promise<EmbedResult> {
  const [usedModel, vectors] = await invoke<[string, number[][]]>("embed_texts", {
    connectionId: connection.id,
    provider: connection.provider,
    baseUrl: connection.baseUrl,
    model: model ?? null,
    texts,
  });
  return { model: usedModel, vectors };
}
