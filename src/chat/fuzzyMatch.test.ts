import { describe, expect, it } from "vitest";
import { levenshtein, namesMatch } from "./fuzzyMatch";

describe("levenshtein", () => {
  it("is 0 for identical strings", () => {
    expect(levenshtein("abc", "abc")).toBe(0);
  });

  it("counts a single substitution", () => {
    expect(levenshtein("vyčerpaný", "vyčerpaní")).toBe(1);
  });

  it("handles empty strings", () => {
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("abc", "")).toBe(3);
  });
});

describe("namesMatch", () => {
  it("matches identical names", () => {
    expect(namesMatch("Popálená ruka", "popálená ruka")).toBe(true);
  });

  it("matches Czech word-form variants (adjective vs noun)", () => {
    expect(namesMatch("vyčerpaný", "vyčerpání")).toBe(true);
  });

  it("does not merge different body parts", () => {
    expect(namesMatch("zraněná ruka", "zraněná noha")).toBe(false);
  });

  it("does not merge unrelated conditions", () => {
    expect(namesMatch("otřesený", "unavený")).toBe(false);
  });

  it("does not merge different word counts", () => {
    expect(namesMatch("popálená ruka", "popálená pravá ruka")).toBe(false);
  });

  it("does not fuzz very short words", () => {
    expect(namesMatch("bg", "bd")).toBe(false);
  });
});
