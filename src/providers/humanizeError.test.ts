import { describe, expect, it } from "vitest";

import { humanizeProviderError } from "./humanizeError";

const GEMINI_QUOTA = `provider error (0): { "error": { "code": 429, "message": "You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits. \\n* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20, model: gemini-3.5-flash\\nPlease retry in 52.219837044s.", "status": "RESOURCE_EXHAUSTED", "details": [ { "@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": "52s" } ] } }`;

describe("humanizeProviderError", () => {
  it("detects Gemini free-tier quota errors with retry delay", () => {
    const err = humanizeProviderError(GEMINI_QUOTA);
    expect(err).toEqual({ kind: "rateLimit", retrySeconds: 53 });
  });

  it("detects OpenAI-style rate limits without a delay", () => {
    const err = humanizeProviderError(
      'provider error (429): {"error":{"message":"Rate limit reached for gpt-4o","type":"tokens"}}',
    );
    expect(err.kind).toBe("rateLimit");
  });

  it("detects rejected API keys", () => {
    expect(
      humanizeProviderError('provider error (400): {"error":{"message":"API key not valid."}}').kind,
    ).toBe("badKey");
    expect(humanizeProviderError("provider error (401): Unauthorized").kind).toBe("badKey");
  });

  it("detects overloaded/unavailable services", () => {
    expect(
      humanizeProviderError('provider error (503): {"error":{"message":"The model is overloaded."}}')
        .kind,
    ).toBe("overloaded");
  });

  it("detects unknown models", () => {
    const err = humanizeProviderError(
      'provider error (404): {"error":{"message":"models/gemini-9.9-ultra is not found for API version v1beta","status":"NOT_FOUND"}}',
    );
    expect(err).toEqual({ kind: "modelNotFound", model: "gemini-9.9-ultra" });
  });

  it("falls back to the extracted message, not the raw JSON blob", () => {
    const err = humanizeProviderError(
      'provider error (418): {"error":{"message":"something odd happened"}}',
    );
    expect(err).toEqual({ kind: "unknown", message: "something odd happened" });
  });

  it("passes through plain messages", () => {
    const err = humanizeProviderError("connection reset by peer");
    expect(err).toEqual({ kind: "unknown", message: "connection reset by peer" });
  });
});
