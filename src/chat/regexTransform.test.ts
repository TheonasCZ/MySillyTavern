import { describe, expect, it } from "vitest";
import { applyRegexRules } from "./regexTransform";

describe("applyRegexRules", () => {
  it("returns text unchanged when rulesJson is empty string", () => {
    const result = applyRegexRules("hello world", "");
    expect(result).toBe("hello world");
  });

  it("returns text unchanged when rulesJson is []", () => {
    const result = applyRegexRules("hello world", "[]");
    expect(result).toBe("hello world");
  });

  it("replaces a simple pattern", () => {
    const rules = JSON.stringify([
      { id: "1", pattern: "hello", replacement: "hi", enabled: true },
    ]);
    const result = applyRegexRules("hello world", rules);
    expect(result).toBe("hi world");
  });

  it("replaces all occurrences with global flag", () => {
    const rules = JSON.stringify([
      { id: "1", pattern: "cat", replacement: "dog", enabled: true },
    ]);
    const result = applyRegexRules("cat cat cat", rules);
    expect(result).toBe("dog dog dog");
  });

  it("applies multiple rules in order", () => {
    const rules = JSON.stringify([
      { id: "1", pattern: "cat", replacement: "dog", enabled: true },
      { id: "2", pattern: "dog", replacement: "bird", enabled: true },
    ]);
    const result = applyRegexRules("a cat sat", rules);
    expect(result).toBe("a bird sat");
  });

  it("skips disabled rules", () => {
    const rules = JSON.stringify([
      { id: "1", pattern: "cat", replacement: "dog", enabled: false },
      { id: "2", pattern: "sat", replacement: "slept", enabled: true },
    ]);
    const result = applyRegexRules("a cat sat", rules);
    expect(result).toBe("a cat slept");
  });

  it("skips rules with empty pattern", () => {
    const rules = JSON.stringify([
      { id: "1", pattern: "", replacement: "x", enabled: true },
      { id: "2", pattern: "cat", replacement: "dog", enabled: true },
    ]);
    const result = applyRegexRules("a cat sat", rules);
    expect(result).toBe("a dog sat");
  });

  it("skips rules with invalid regex pattern", () => {
    const rules = JSON.stringify([
      { id: "1", pattern: "[invalid(", replacement: "x", enabled: true },
      { id: "2", pattern: "cat", replacement: "dog", enabled: true },
    ]);
    const result = applyRegexRules("a cat sat", rules);
    expect(result).toBe("a dog sat");
  });

  it("returns text unchanged for invalid JSON", () => {
    const result = applyRegexRules("hello world", "{not valid json}");
    expect(result).toBe("hello world");
  });

  it("returns text unchanged for non-array JSON", () => {
    const result = applyRegexRules("hello world", '{"id":"1"}');
    expect(result).toBe("hello world");
  });

  it("handles regex special characters in pattern", () => {
    const rules = JSON.stringify([
      { id: "1", pattern: "\\bhello\\b", replacement: "hi", enabled: true },
    ]);
    const result = applyRegexRules("hello world, hellos are nice", rules);
    expect(result).toBe("hi world, hellos are nice");
  });

  it("handles replacement with capture groups", () => {
    const rules = JSON.stringify([
      { id: "1", pattern: "(cat)", replacement: "nice $1", enabled: true },
    ]);
    const result = applyRegexRules("a cat sat", rules);
    expect(result).toBe("a nice cat sat");
  });
});
