import { describe, expect, it } from "vitest";

import {
  buildScanText,
  estimateTokens,
  isEntryActive,
  selectActiveEntries,
  type LoreEntryLike,
} from "./activation";

function entry(partial: Partial<LoreEntryLike>): LoreEntryLike {
  return {
    id: partial.id ?? "e1",
    keys: partial.keys ?? [],
    secondaryKeys: partial.secondaryKeys ?? [],
    content: partial.content ?? "",
    priority: partial.priority ?? 100,
    alwaysOn: partial.alwaysOn ?? false,
    caseSensitive: partial.caseSensitive ?? false,
    enabled: partial.enabled ?? true,
  };
}

describe("estimateTokens", () => {
  it("rounds up chars/4", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("a".repeat(800))).toBe(200);
  });
});

describe("buildScanText", () => {
  it("keeps only the last scanDepth messages, in order", () => {
    const messages = ["one", "two", "three", "four", "five"];
    expect(buildScanText(messages, 2)).toBe("four\nfive");
    expect(buildScanText(messages, 100)).toBe(messages.join("\n"));
  });

  it("defaults to the last 4 messages", () => {
    const messages = ["a", "b", "c", "d", "e"];
    expect(buildScanText(messages)).toBe("b\nc\nd\ne");
  });
});

describe("isEntryActive", () => {
  it("is never active when disabled, even if always_on", () => {
    const e = entry({ alwaysOn: true, enabled: false });
    expect(isEntryActive(e, "anything")).toBe(false);
  });

  it("is always active when always_on and enabled, regardless of keys", () => {
    const e = entry({ alwaysOn: true, keys: [] });
    expect(isEntryActive(e, "totally unrelated text")).toBe(true);
  });

  it("activates on a case-insensitive substring match by default", () => {
    const e = entry({ keys: ["Dragon"] });
    expect(isEntryActive(e, "a dragon appears")).toBe(true);
    expect(isEntryActive(e, "a DRAGON appears")).toBe(true);
    expect(isEntryActive(e, "no reptiles here")).toBe(false);
  });

  it("respects case_sensitive when set", () => {
    const e = entry({ keys: ["Dragon"], caseSensitive: true });
    expect(isEntryActive(e, "a Dragon appears")).toBe(true);
    expect(isEntryActive(e, "a dragon appears")).toBe(false);
  });

  it("activates if ANY key matches", () => {
    const e = entry({ keys: ["castle", "throne"] });
    expect(isEntryActive(e, "the throne room")).toBe(true);
    expect(isEntryActive(e, "nothing relevant")).toBe(false);
  });

  it("ignores blank keys", () => {
    const e = entry({ keys: ["", "  "] });
    expect(isEntryActive(e, "some text")).toBe(false);
  });
});

describe("selectActiveEntries", () => {
  it("only includes entries whose keys appear in the scanned recent messages", () => {
    const entries = [
      entry({ id: "castle", keys: ["castle"] }),
      entry({ id: "dragon", keys: ["dragon"] }),
    ];
    const messages = ["We approach the castle gates."];
    const selected = selectActiveEntries(entries, messages);
    expect(selected.map((e) => e.id)).toEqual(["castle"]);
  });

  it("only scans the last `scanDepth` messages", () => {
    const entries = [entry({ id: "old", keys: ["griffin"] })];
    // "griffin" only appears in a message older than the scan window.
    const messages = ["griffin sighted", "b", "c", "d", "e"];
    expect(selectActiveEntries(entries, messages, { scanDepth: 4 })).toHaveLength(0);
    expect(selectActiveEntries(entries, messages, { scanDepth: 5 })).toHaveLength(1);
  });

  it("sorts activated entries by priority descending", () => {
    const entries = [
      entry({ id: "low", keys: ["x"], priority: 1 }),
      entry({ id: "high", keys: ["x"], priority: 50 }),
      entry({ id: "mid", keys: ["x"], priority: 10 }),
    ];
    const selected = selectActiveEntries(entries, ["x"]);
    expect(selected.map((e) => e.id)).toEqual(["high", "mid", "low"]);
  });

  it("always_on entries activate without any key mention", () => {
    const entries = [entry({ id: "world-rule", alwaysOn: true, keys: [] })];
    const selected = selectActiveEntries(entries, ["completely unrelated chat"]);
    expect(selected.map((e) => e.id)).toEqual(["world-rule"]);
  });

  it("stops adding entries once the token budget would be exceeded", () => {
    // Each entry's content is 40 chars -> 10 tokens (Math.ceil(40/4)).
    const content40 = "x".repeat(40);
    const entries = [
      entry({ id: "a", keys: ["x"], priority: 3, content: content40 }),
      entry({ id: "b", keys: ["x"], priority: 2, content: content40 }),
      entry({ id: "c", keys: ["x"], priority: 1, content: content40 }),
    ];
    // Budget of 25 tokens fits entry "a" (10) + "b" (10) = 20, but not "c" (would be 30).
    const selected = selectActiveEntries(entries, ["x"], { tokenBudget: 25 });
    expect(selected.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("excludes disabled entries even if their keys match", () => {
    const entries = [entry({ id: "off", keys: ["x"], enabled: false })];
    expect(selectActiveEntries(entries, ["x"])).toHaveLength(0);
  });
});
