export type Provider = "openai" | "gemini" | "claude";

export type ConnectionPurpose = "chat" | "image" | "embedding";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Mirrors the `connections` table row. The API key never lives here — it
 * stays in the secrets file and is looked up by `id` on the Rust side. */
export interface ConnectionConfig {
  id: string;
  name: string;
  provider: Provider;
  purposes: ConnectionPurpose[];
  baseUrl: string | null;
  model: string;
  temperature: number;
  topP: number;
  maxTokens: number;
  contextBudget: number;
  createdAt: string;
  updatedAt: string;
}

export type ConnectionDraft = Omit<ConnectionConfig, "id" | "createdAt" | "updatedAt">;

export interface ChatParams {
  temperature: number;
  topP: number;
  maxTokens: number;
}

/** Streaming events emitted by the future `chat_stream` command (M2). Kept
 * here now so the shape is settled ahead of time. */
export type StreamEvent =
  | { event: "Start" }
  | { event: "Token"; data: { text: string } }
  | { event: "Done"; data: { finish_reason: string } }
  | { event: "Error"; data: { message: string; retryable: boolean } };
