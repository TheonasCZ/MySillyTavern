import { describe, expect, it } from "vitest";

import { parseSuggestions } from "./chatStore";

describe("parseSuggestions", () => {
  it("parses a plain JSON array", () => {
    expect(parseSuggestions('["Prozkoumám krystal.", "Zeptám se hostinského.", "Odejdu."]')).toEqual([
      "Prozkoumám krystal.",
      "Zeptám se hostinského.",
      "Odejdu.",
    ]);
  });

  it("parses a JSON array wrapped in a markdown fence and prose", () => {
    const reply = 'Jasně, tady jsou:\n```json\n["A", "B", "C"]\n```';
    expect(parseSuggestions(reply)).toEqual(["A", "B", "C"]);
  });

  it("falls back to numbered lines when JSON is missing", () => {
    const reply = "1. Vytáhnu krystal.\n2) Schovám se.\n- Uteču.";
    expect(parseSuggestions(reply)).toEqual(["Vytáhnu krystal.", "Schovám se.", "Uteču."]);
  });

  it("caps the result at three items", () => {
    expect(parseSuggestions('["a","b","c","d"]')).toHaveLength(3);
  });

  it("ignores empty and non-string JSON entries", () => {
    expect(parseSuggestions('["a", "", 5, "b"]')).toEqual(["a", "b"]);
  });
});
