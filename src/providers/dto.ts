import type { ChatMessage, ConnectionConfig } from "./types";

/** Rust's `ConnectionDto` deserializes with plain (snake_case) field names —
 * unlike the camelCase `ConnectionConfig` used in the rest of the app. */
export interface ConnectionDto {
  id: string;
  provider: string;
  base_url: string | null;
  model: string;
  temperature: number;
  top_p: number;
  max_tokens: number;
}

export function toConnectionDto(config: ConnectionConfig): ConnectionDto {
  return {
    id: config.id,
    provider: config.provider,
    base_url: config.baseUrl,
    model: config.model,
    temperature: config.temperature,
    top_p: config.topP,
    max_tokens: config.maxTokens,
  };
}

export type ChatMessageDto = ChatMessage;
