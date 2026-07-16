import { describe, expect, it } from "vitest";

import { estimateTokens } from "./tokenEstimate";

describe("estimateTokens", () => {
  it("returns 0 for empty input", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("rounds up chars/4", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("a")).toBe(1);
  });

  it("scales linearly for longer text", () => {
    const text = "x".repeat(400);
    expect(estimateTokens(text)).toBe(100);
  });
});
