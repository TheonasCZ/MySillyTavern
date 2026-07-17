/**
 * Turns raw provider error strings (often a dumped JSON body like Google's
 * RESOURCE_EXHAUSTED blob) into something a player can act on. The chat UI
 * maps the returned kind to a friendly i18n message; `unknown` falls back
 * to the generic message with a cleaned-up (non-JSON) text.
 */

export type HumanProviderError =
  | { kind: "rateLimit"; retrySeconds?: number }
  | { kind: "badKey" }
  | { kind: "overloaded" }
  | { kind: "modelNotFound"; model?: string }
  | { kind: "unknown"; message: string };

/** Pulls the innermost human-readable message out of a JSON error body. */
function extractJsonMessage(raw: string): string | null {
  const start = raw.indexOf("{");
  if (start === -1) return null;
  try {
    const parsed = JSON.parse(raw.slice(start)) as Record<string, unknown>;
    const err = (parsed.error ?? parsed) as Record<string, unknown>;
    if (typeof err.message === "string") return err.message;
  } catch {
    // not valid JSON — ignore
  }
  return null;
}

export function humanizeProviderError(raw: string): HumanProviderError {
  const msg = extractJsonMessage(raw) ?? raw;
  const lower = `${raw}\n${msg}`.toLowerCase();

  if (
    lower.includes("resource_exhausted") ||
    lower.includes("rate limit") ||
    lower.includes("rate_limit") ||
    lower.includes("quota") ||
    lower.includes("(429)") ||
    lower.includes("\"code\": 429") ||
    lower.includes("code: 429") ||
    lower.includes("too many requests")
  ) {
    // Google: "Please retry in 52.219837044s." / RetryInfo "retryDelay": "52s"
    const m = msg.match(/retry in ([\d.]+)\s*s/i) ?? raw.match(/"retryDelay":\s*"([\d.]+)s"/i);
    const retrySeconds = m ? Math.ceil(parseFloat(m[1])) : undefined;
    return { kind: "rateLimit", retrySeconds };
  }

  if (
    lower.includes("api key not valid") ||
    lower.includes("invalid api key") ||
    lower.includes("invalid_api_key") ||
    lower.includes("incorrect api key") ||
    lower.includes("unauthenticated") ||
    lower.includes("permission_denied") ||
    lower.includes("(401)") ||
    lower.includes("(403)")
  ) {
    return { kind: "badKey" };
  }

  if (
    lower.includes("overloaded") ||
    lower.includes("unavailable") ||
    lower.includes("(500)") ||
    lower.includes("(502)") ||
    lower.includes("(503)") ||
    lower.includes("(529)") ||
    lower.includes("internal error")
  ) {
    return { kind: "overloaded" };
  }

  if (lower.includes("not found") && lower.includes("model")) {
    const m = msg.match(/models?\/([\w.:-]+)/i);
    return { kind: "modelNotFound", model: m?.[1] };
  }

  // Fallback: show the extracted message rather than the raw JSON blob,
  // trimmed to something that fits an error banner.
  const clean = msg.replace(/\s+/g, " ").trim();
  return { kind: "unknown", message: clean.length > 220 ? `${clean.slice(0, 220)}…` : clean };
}
