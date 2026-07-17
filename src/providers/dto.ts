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
  top_k?: number;
  min_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  max_tokens: number;
}

export function toConnectionDto(config: ConnectionConfig): ConnectionDto {
  const dto: ConnectionDto = {
    id: config.id,
    provider: config.provider,
    base_url: config.baseUrl,
    model: config.model,
    temperature: config.temperature,
    top_p: config.topP,
    max_tokens: config.maxTokens,
  };
  if (config.topK !== undefined) dto.top_k = config.topK;
  if (config.minP !== undefined) dto.min_p = config.minP;
  if (config.frequencyPenalty !== undefined) dto.frequency_penalty = config.frequencyPenalty;
  if (config.presencePenalty !== undefined) dto.presence_penalty = config.presencePenalty;
  return dto;
}

export type ChatMessageDto = ChatMessage;
