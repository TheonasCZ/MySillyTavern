export type Provider = "openai" | "gemini" | "claude";

export type ConnectionPurpose = "chat" | "image" | "embedding";

/** EXPERIMENTAL (function-calling prototype, see `src/chat/toolCalling.ts`):
 * one prior `functionCall` the model made, replayed in a following request
 * as an `assistant`-role turn's `function_call` field. */
export interface ChatFunctionCall {
  name: string;
  args: unknown;
  /** Gemini's opaque per-call token — must be replayed verbatim on the
   * follow-up request or the API rejects it with HTTP 400. */
  thoughtSignature?: string;
}

/** EXPERIMENTAL: the app's answer to a prior `ChatFunctionCall`, sent back
 * as a `user`-role turn's `function_response` field so the model can resume
 * generation with the looked-up detail in context. */
export interface ChatFunctionResponse {
  name: string;
  response: unknown;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
  /** EXPERIMENTAL: present only on the assistant turn that represents the
   * model's own prior tool call — `content` is normally empty then. */
  function_call?: ChatFunctionCall;
  /** EXPERIMENTAL: present only on the user turn that carries the app's
   * tool result back to the model — `content` is normally empty then. */
  function_response?: ChatFunctionResponse;
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
  topK?: number;
  minP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
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
  /** EXPERIMENTAL (function-calling prototype, Gemini only): terminal for
   * the current `chat_stream` call, same as `Done`/`Error` — the model
   * paused generation to invoke a tool. The caller must execute the tool,
   * append a function-call + function-response message pair, and issue a
   * fresh `chat_stream` call (with `tools: true`) to resume generation. */
  | { event: "FunctionCall"; data: { name: string; args: unknown; thoughtSignature?: string } }
  | { event: "Done"; data: { finish_reason: string } }
  | { event: "Error"; data: { message: string; retryable: boolean } };
