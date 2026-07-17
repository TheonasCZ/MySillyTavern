import { describe, expect, it } from "vitest";

import { expandKeys } from "./stemming";

describe("expandKeys", () => {
  it("includes the original key in the result", () => {
    const result = expandKeys(["meč"]);
    expect(result).toContain("meč");
  });

  it("generates common inflected forms for a consonant-final masculine noun", () => {
    const result = expandKeys(["meč"]);
    // Some expected forms (not exhaustive — just sanity).
    expect(result).toContain("meče");
    expect(result).toContain("meči");
    expect(result).toContain("mečem");
    expect(result).toContain("mečů");
    expect(result).toContain("mečům");
  });

  it("generates forms for a vowel-final feminine noun by stripping and suffixing", () => {
    const result = expandKeys(["žena"]);
    // Stem "žen" + "y" = "ženy" (valid accusative/genitive plural).
    expect(result).toContain("ženy");
    // Stem "žen" + "e" = "žene" (valid vocative).
    expect(result).toContain("žene");
    // Stem "žen" + "ou" = "ženou" (valid instrumental singular).
    expect(result).toContain("ženou");
    // Also forms from full word: "žena" + "y" = "ženay" (nonsense but harmless).
    expect(result).toContain("ženay");
    // The original key is always present.
    expect(result).toContain("žena");
  });

  it("handles multi-word keys — only stems the last word", () => {
    const result = expandKeys(["černý meč"]);
    expect(result).toContain("černý meč"); // original
    expect(result).toContain("černý meče");
    expect(result).toContain("černý mečem");
    // First word "černý" should NOT be stemmed — no "čern meč" etc.
    expect(result).not.toContain("čern meč");
  });

  it("skips keys shorter than 3 characters", () => {
    const result = expandKeys(["a", "ab", "abc"]);
    expect(result).toContain("a");
    expect(result).toContain("ab");
    expect(result).toContain("abc");
    // "abc" gets expanded, "a" and "ab" don't.
    const expanded = result.filter((k) => k !== "a" && k !== "ab" && k !== "abc");
    // All expanded forms should start with "abc"
    for (const form of expanded) {
      expect(form.startsWith("abc")).toBe(true);
    }
  });

  it("deduplicates identical forms", () => {
    const result = expandKeys(["meč", "meč"]);
    const count = result.filter((k) => k === "meč").length;
    expect(count).toBe(1);
  });

  it("filters out blank keys", () => {
    const result = expandKeys(["", "  ", "meč"]);
    expect(result).not.toContain("");
    expect(result).not.toContain("  ");
    expect(result).toContain("meč");
  });

  it("caps the total at 100 per entry", () => {
    // Each key with 2 stems × 20 suffixes = ~40 forms; 3 keys → ~120 but capped.
    const result = expandKeys(["meč", "drak", "hrad"]);
    expect(result.length).toBeLessThanOrEqual(100);
  });

  it("is pure — returns a new array without mutating input", () => {
    const input = ["meč"];
    const result = expandKeys(input);
    expect(result).not.toBe(input);
    expect(input).toEqual(["meč"]);
  });

  it("handles an empty key list gracefully", () => {
    expect(expandKeys([])).toEqual([]);
  });
});
