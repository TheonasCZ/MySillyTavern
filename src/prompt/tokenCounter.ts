/** Model-specific token counting (plan §A3).
 *
 * Different models tokenize differently — a fixed chars-per-token estimate
 * systematically undershoots the real prompt size, which means the
 * PromptBuilder trimmer stops cutting before the prompt fits the model's
 * real context budget.
 *
 * This module provides:
 * - `countTokens()` (async): tries tiktoken (OpenAI), falls back to estimate
 * - `syncCountTokens()` (sync): uses a preloaded tiktoken module if available
 * - `preloadTokenCounter()`: warms the tiktoken cache for sync use
 *
 * Gemini's countTokens API and Anthropic's token-counting endpoint are not
 * yet implemented — those models fall back to chars-per-token. */

import type { ConnectionConfig } from "../providers/types";
import { estimateTokens } from "./tokenEstimate";

// ---------------------------------------------------------------------------
// tiktoken lazy-loading (dynamic import — no hard dependency)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let tiktokenModule: any = null;
let tiktokenLoadAttempted = false;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let tiktokenLoadPromise: Promise<any> | null = null;

async function ensureTiktoken(): Promise<unknown> {
  if (tiktokenModule) return tiktokenModule;
  if (tiktokenLoadAttempted) return null;
  if (tiktokenLoadPromise) return tiktokenLoadPromise;

  tiktokenLoadAttempted = true;
  tiktokenLoadPromise = (async () => {
    try {
      tiktokenModule = await import("tiktoken");
      return tiktokenModule;
    } catch {
      return null;
    }
  })();
  return tiktokenLoadPromise;
}

// ---------------------------------------------------------------------------
// simple hash for cache keys
// ---------------------------------------------------------------------------

function hashText(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + ch;
    hash |= 0; // 32-bit int
  }
  return hash;
}

// ---------------------------------------------------------------------------
// token-count cache
// ---------------------------------------------------------------------------

const tokenCache = new Map<string, number>();
const MAX_CACHE_SIZE = 200;

function cacheGet(model: string, text: string): number | undefined {
  return tokenCache.get(`${model}:${hashText(text)}`);
}

function cacheSet(model: string, text: string, count: number): void {
  if (tokenCache.size >= MAX_CACHE_SIZE) {
    // Evict oldest half.
    const keys = [...tokenCache.keys()].slice(0, Math.floor(MAX_CACHE_SIZE / 2));
    for (const k of keys) tokenCache.delete(k);
  }
  tokenCache.set(`${model}:${hashText(text)}`, count);
}

// ---------------------------------------------------------------------------
// OpenAI model detection
// ---------------------------------------------------------------------------

function isOpenAIModel(model: string): boolean {
  return /^(gpt-|o1-|o3-)/i.test(model);
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

/**
 * Count tokens for `text` using the most accurate method available for
 * `model`.  For OpenAI models this tries the local `tiktoken` WASM package;
 * for Gemini / Claude it currently falls back to `estimateTokens` (TODO:
 * implement the Gemini `countTokens` API and Anthropic's token-counting
 * endpoint).  Safe to call many times — results are cached per
 * (model, text_hash). */
export async function countTokens(
  model: string,
  text: string,
  _connection?: ConnectionConfig,
): Promise<number> {
  if (!text) return 0;

  const cached = cacheGet(model, text);
  if (cached !== undefined) return cached;

  let tokens: number;

  if (isOpenAIModel(model)) {
    const tk = await ensureTiktoken();
    if (tk) {
      try {
        const enc = tk.encoding_for_model(model);
        tokens = enc.encode(text).length;
      } catch {
        // Model not recognised by tiktoken — fall back.
        tokens = estimateTokens(text);
      }
    } else {
      tokens = estimateTokens(text);
    }
  } else {
    // Gemini / Claude: TODO — call provider token-counting APIs.
    tokens = estimateTokens(text);
  }

  cacheSet(model, text, tokens);
  return tokens;
}

/**
 * Synchronous best-effort token count.  Uses tiktoken when the module has
 * already been preloaded (via `preloadTokenCounter`), otherwise falls back
 * to `estimateTokens`.  Designed for use inside the synchronous
 * `buildPrompt` hot loop. */
export function syncCountTokens(model: string, text: string): number {
  if (!text) return 0;

  if (isOpenAIModel(model) && tiktokenModule) {
    try {
      const enc = tiktokenModule.encoding_for_model(model);
      return enc.encode(text).length;
    } catch {
      return estimateTokens(text);
    }
  }

  return estimateTokens(text);
}

/**
 * Preload the tiktoken WASM module in the background so that subsequent
 * `syncCountTokens` calls can use real BPE token counts.  Idempotent —
 * safe to call from any component that knows an OpenAI model is in use. */
export async function preloadTokenCounter(): Promise<void> {
  await ensureTiktoken();
}
