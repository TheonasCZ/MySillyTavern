import { describe, expect, it } from "vitest";

import { estimateTokens } from "./tokenEstimate";

describe("estimateTokens", () => {
  it("returns 0 for empty input", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("rounds up chars/3.3", () => {
    expect(estimateTokens("abc")).toBe(1);
    expect(estimateTokens("abcd")).toBe(2);
    expect(estimateTokens("a")).toBe(1);
  });

  it("scales linearly for longer text", () => {
    const text = "x".repeat(330);
    expect(estimateTokens(text)).toBe(100);
  });

  it("estimates higher than the old 4-chars/token heuristic — Czech RP text " +
    "measured closer to ~3.3 chars/token, and undershooting the real prompt " +
    "size defeats PromptBuilder's budget trimming", () => {
    const text = "Toto je ukázka delšího českého textu s diakritikou pro test odhadu tokenů.";
    const old4CharEstimate = Math.ceil(text.length / 4);
    expect(estimateTokens(text)).toBeGreaterThan(old4CharEstimate);
  });
});
