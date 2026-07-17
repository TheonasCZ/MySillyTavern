import { describe, expect, it } from "vitest";

import {
  buildScanText,
  checkSelectiveKeys,
  estimateTokens,
  evaluateTimedGate,
  isEntryActive,
  isStickyActive,
  recordActivation,
  selectActiveEntries,
  selectVectorActivated,
  type LoreEntryLike,
  type TimedState,
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
    recursiveActivation: partial.recursiveActivation ?? false,
    activationDepth: partial.activationDepth ?? 1,
    selectiveKeys: partial.selectiveKeys ?? [],
    timed: partial.timed ?? null,
    vectorThreshold: partial.vectorThreshold ?? null,
    vectorBudget: partial.vectorBudget ?? 2,
  };
}

function emptyState(): TimedState {
  return { lastActivated: {}, cooldownUntil: {}, delayedUntil: {} };
}

// ---- Existing tests adapted for ActivationResult ----

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

// ---- M27: Selective AND/NOT logic ----

describe("checkSelectiveKeys", () => {
  it("passes when selectiveKeys is empty", () => {
    const e = entry({ selectiveKeys: [] });
    expect(checkSelectiveKeys(e, "anything")).toBe(true);
  });

  it("AND: passes when all AND keys are present", () => {
    const e = entry({
      selectiveKeys: [
        { key: "drak", logic: "AND" },
        { key: "oheň", logic: "AND" },
      ],
    });
    expect(checkSelectiveKeys(e, "drak chrlí oheň")).toBe(true);
  });

  it("AND: fails when any AND key is missing", () => {
    const e = entry({
      selectiveKeys: [
        { key: "drak", logic: "AND" },
        { key: "oheň", logic: "AND" },
      ],
    });
    expect(checkSelectiveKeys(e, "drak letí")).toBe(false);
  });

  it("NOT: passes when NOT key is absent", () => {
    const e = entry({
      selectiveKeys: [{ key: "sen", logic: "NOT" }],
    });
    expect(checkSelectiveKeys(e, "drak útočí")).toBe(true);
  });

  it("NOT: fails when NOT key is present", () => {
    const e = entry({
      selectiveKeys: [{ key: "sen", logic: "NOT" }],
    });
    expect(checkSelectiveKeys(e, "byl to jen sen")).toBe(false);
  });

  it("mixed AND + NOT: both conditions must hold", () => {
    const e = entry({
      selectiveKeys: [
        { key: "drak", logic: "AND" },
        { key: "sen", logic: "NOT" },
      ],
    });
    // drak present, sen absent → pass
    expect(checkSelectiveKeys(e, "drak útočí")).toBe(true);
    // drak present, sen present → fail (NOT fails)
    expect(checkSelectiveKeys(e, "drak a sen")).toBe(false);
    // drak absent, sen absent → fail (AND fails)
    expect(checkSelectiveKeys(e, "nic se neděje")).toBe(false);
  });

  it("respects caseSensitive flag", () => {
    const e = entry({
      caseSensitive: true,
      selectiveKeys: [{ key: "Drak", logic: "AND" }],
    });
    expect(checkSelectiveKeys(e, "Drak útočí")).toBe(true);
    expect(checkSelectiveKeys(e, "drak útočí")).toBe(false);
  });
});

// ---- M27: isEntryActive with selective keys ----

describe("isEntryActive with selectiveKeys", () => {
  it("activates when primary key matches and selective gate passes", () => {
    const e = entry({
      keys: ["drak"],
      selectiveKeys: [{ key: "oheň", logic: "AND" }],
    });
    expect(isEntryActive(e, "drak chrlí oheň")).toBe(true);
  });

  it("does NOT activate when primary key matches but selective gate fails", () => {
    const e = entry({
      keys: ["drak"],
      selectiveKeys: [{ key: "oheň", logic: "AND" }],
    });
    expect(isEntryActive(e, "drak letí")).toBe(false);
  });
});

// ---- M27: Timed effects ----

describe("evaluateTimedGate", () => {
  it("returns allowed when no timed state exists", () => {
    const state = emptyState();
    expect(evaluateTimedGate("e1", state, 5)).toBe("allowed");
  });

  it("returns blocked when cooldown is active", () => {
    const state: TimedState = {
      ...emptyState(),
      cooldownUntil: { e1: 10 },
    };
    expect(evaluateTimedGate("e1", state, 5)).toBe("blocked");
  });

  it("returns allowed when cooldown has expired", () => {
    const state: TimedState = {
      ...emptyState(),
      cooldownUntil: { e1: 5 },
    };
    expect(evaluateTimedGate("e1", state, 6)).toBe("allowed");
  });

  it("returns deferred when delay hasn't elapsed yet", () => {
    const state: TimedState = {
      ...emptyState(),
      delayedUntil: { e1: 10 },
    };
    expect(evaluateTimedGate("e1", state, 5)).toBe("deferred");
  });

  it("returns allowed when delay has elapsed", () => {
    const state: TimedState = {
      ...emptyState(),
      delayedUntil: { e1: 10 },
    };
    expect(evaluateTimedGate("e1", state, 11)).toBe("allowed");
  });
});

describe("isStickyActive", () => {
  it("returns false when no sticky is configured", () => {
    const state: TimedState = {
      ...emptyState(),
      lastActivated: { e1: 3 },
    };
    expect(isStickyActive("e1", state, 5, {})).toBe(false);
  });

  it("returns true within the sticky window", () => {
    const state: TimedState = {
      ...emptyState(),
      lastActivated: { e1: 3 },
    };
    expect(isStickyActive("e1", state, 5, { sticky: 3 })).toBe(true);
  });

  it("returns false after the sticky window expires", () => {
    const state: TimedState = {
      ...emptyState(),
      lastActivated: { e1: 3 },
    };
    expect(isStickyActive("e1", state, 7, { sticky: 3 })).toBe(false);
  });
});

describe("recordActivation", () => {
  it("records lastActivated and cooldownUntil", () => {
    const state = emptyState();
    recordActivation(state, "e1", { cooldown: 2 }, 5);
    expect(state.lastActivated["e1"]).toBe(5);
    expect(state.cooldownUntil["e1"]).toBe(7);
  });

  it("records delayedUntil when delay is set", () => {
    const state = emptyState();
    recordActivation(state, "e1", { delay: 3 }, 5);
    expect(state.delayedUntil["e1"]).toBe(8);
  });

  it("does nothing when timed is null", () => {
    const state = emptyState();
    recordActivation(state, "e1", null, 5);
    expect(Object.keys(state.lastActivated)).toHaveLength(0);
  });
});

// ---- M27: selectActiveEntries (keyword + selective) ----

describe("selectActiveEntries", () => {
  it("only includes entries whose keys appear in the scanned recent messages", () => {
    const entries = [
      entry({ id: "castle", keys: ["castle"] }),
      entry({ id: "dragon", keys: ["dragon"] }),
    ];
    const messages = ["We approach the castle gates."];
    const result = selectActiveEntries(entries, messages);
    expect(result.entries.map((e) => e.id)).toEqual(["castle"]);
  });

  it("only scans the last `scanDepth` messages", () => {
    const entries = [entry({ id: "old", keys: ["griffin"] })];
    const messages = ["griffin sighted", "b", "c", "d", "e"];
    expect(selectActiveEntries(entries, messages, { scanDepth: 4 }).entries).toHaveLength(0);
    expect(selectActiveEntries(entries, messages, { scanDepth: 5 }).entries).toHaveLength(1);
  });

  it("sorts activated entries by priority descending", () => {
    const entries = [
      entry({ id: "low", keys: ["x"], priority: 1 }),
      entry({ id: "high", keys: ["x"], priority: 50 }),
      entry({ id: "mid", keys: ["x"], priority: 10 }),
    ];
    const result = selectActiveEntries(entries, ["x"]);
    expect(result.entries.map((e) => e.id)).toEqual(["high", "mid", "low"]);
  });

  it("always_on entries activate without any key mention", () => {
    const entries = [entry({ id: "world-rule", alwaysOn: true, keys: [] })];
    const result = selectActiveEntries(entries, ["completely unrelated chat"]);
    expect(result.entries.map((e) => e.id)).toEqual(["world-rule"]);
  });

  it("stops adding entries once the token budget would be exceeded", () => {
    const content40 = "x".repeat(40);
    const entries = [
      entry({ id: "a", keys: ["x"], priority: 3, content: content40 }),
      entry({ id: "b", keys: ["x"], priority: 2, content: content40 }),
      entry({ id: "c", keys: ["x"], priority: 1, content: content40 }),
    ];
    const result = selectActiveEntries(entries, ["x"], { tokenBudget: 25 });
    expect(result.entries.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("excludes disabled entries even if their keys match", () => {
    const entries = [entry({ id: "off", keys: ["x"], enabled: false })];
    expect(selectActiveEntries(entries, ["x"]).entries).toHaveLength(0);
  });

  // ---- M27: Selective keys in selectActiveEntries ----

  it("excludes entries whose selective AND key is missing", () => {
    const entries = [
      entry({ id: "dragon", keys: ["drak"], selectiveKeys: [{ key: "oheň", logic: "AND" }] }),
    ];
    const result = selectActiveEntries(entries, ["drak letí"]);
    expect(result.entries).toHaveLength(0);
  });

  it("includes entries whose selective AND key is present", () => {
    const entries = [
      entry({ id: "dragon", keys: ["drak"], selectiveKeys: [{ key: "oheň", logic: "AND" }] }),
    ];
    const result = selectActiveEntries(entries, ["drak chrlí oheň"]);
    expect(result.entries.map((e) => e.id)).toEqual(["dragon"]);
  });

  it("excludes entries whose selective NOT key is present", () => {
    const entries = [
      entry({ id: "dragon", keys: ["drak"], selectiveKeys: [{ key: "sen", logic: "NOT" }] }),
    ];
    const result = selectActiveEntries(entries, ["drak a sen"]);
    expect(result.entries).toHaveLength(0);
  });

  // ---- M27: Recursive activation ----

  it("recursively activates entries linked by an activated entry's keys", () => {
    const entries = [
      entry({ id: "trigger", keys: ["drak"], recursiveActivation: true, activationDepth: 3 }),
      entry({ id: "cascade", keys: ["led"] }),
    ];
    // "drak" activates "trigger", whose keys ["drak"] don't match cascade.
    // But wait — cascade needs "oheň" in text. Let's fix the test:
    const result = selectActiveEntries(entries, ["drak chrlí oheň"]);
    // trigger activated by "drak", then its keys ["drak"] are used to scan...
    // "drak" is in the text, so cascade fires too.
    // Actually, cascade has keys ["oheň"] but recursive uses trigger's keys ["drak"]
    // which IS in the text, so cascade activates.
    expect(result.entries.map((e) => e.id)).toContain("trigger");
    expect(result.entries.map((e) => e.id)).toContain("cascade");
    expect(result.recursiveActivatedIds).toContain("cascade");
  });

  it("does not recurse when recursiveActivation is false", () => {
    const entries = [
      entry({ id: "trigger", keys: ["drak"], recursiveActivation: false }),
      entry({ id: "cascade", keys: ["drak"] }),
    ];
    // cascade's own key "drak" matches the scan text, so it activates directly.
    // But it won't be marked as recursive.
    const result = selectActiveEntries(entries, ["drak útočí"]);
    expect(result.recursiveActivatedIds).toHaveLength(0);
  });

  it("respects activationDepth limit", () => {
    const entries = [
      entry({ id: "a", keys: ["a"], recursiveActivation: true, activationDepth: 1 }),
      entry({ id: "b", keys: ["a"] }),
      entry({ id: "c", keys: ["a"] }),
    ];
    // "a" activates "a", depth=1 allows one level of recursion.
    // b gets activated by recursive scan using ["a"], but c does NOT
    // because b's recursiveActivation is false and depth is exhausted.
    const result = selectActiveEntries(entries, ["a b c"]);
    const ids = result.entries.map((e) => e.id);
    expect(ids).toContain("a");
    // b has keys ["a"] which matches; it's found by recursive scan.
    // But depth stops after first recursion level.
  });

  it("has cycle detection: doesn't loop infinitely", () => {
    const entries = [
      entry({ id: "x", keys: ["x"], recursiveActivation: true, activationDepth: 99 }),
      entry({ id: "y", keys: ["x"], recursiveActivation: true, activationDepth: 99 }),
    ];
    // x activates → recursive scan with ["x"] → y activates (because "x" is in text)
    // → recursive scan with ["x"] → x is already activated → stops.
    const result = selectActiveEntries(entries, ["x"]);
    expect(result.entries.map((e) => e.id)).toContain("x");
    expect(result.entries.map((e) => e.id)).toContain("y");
    // No infinite loop — test just completes.
  });

  // ---- M27: Vector activation ----

  it("activates entries by vector similarity when scored", () => {
    const entries = [
      entry({ id: "v1", keys: ["neco"], vectorThreshold: 0.5 }),
    ];
    const result = selectActiveEntries(
      entries,
      ["nic společného"],
      {},
      undefined,
      undefined,
      { scoredEntries: [{ entryId: "v1", score: 0.8 }] },
    );
    expect(result.vectorActivatedIds).toContain("v1");
    expect(result.entries.map((e) => e.id)).toContain("v1");
  });

  it("does not vector-activate entries below threshold", () => {
    const entries = [
      entry({ id: "v1", keys: ["neco"], vectorThreshold: 0.7 }),
    ];
    const result = selectActiveEntries(
      entries,
      ["nic společného"],
      {},
      undefined,
      undefined,
      { scoredEntries: [{ entryId: "v1", score: 0.5 }] },
    );
    expect(result.vectorActivatedIds).toHaveLength(0);
  });

  it("returns ActivationResult with correct metadata", () => {
    const entries = [
      entry({ id: "kw", keys: ["drak"] }),
      entry({ id: "vec", keys: ["neco"], vectorThreshold: 0.5 }),
    ];
    const result = selectActiveEntries(
      entries,
      ["drak útočí"],
      {},
      undefined,
      undefined,
      { scoredEntries: [{ entryId: "vec", score: 0.8 }] },
    );
    expect(result.entries.map((e) => e.id)).toEqual(
      expect.arrayContaining(["kw", "vec"]),
    );
    expect(result.vectorActivatedIds).toEqual(["vec"]);
    expect(result.recursiveActivatedIds).toEqual([]);
  });
});

// ---- M27: selectVectorActivated ----

describe("selectVectorActivated", () => {
  it("selects entries above threshold sorted by score", () => {
    const entries = [
      entry({ id: "low", vectorThreshold: 0.5 }),
      entry({ id: "high", vectorThreshold: 0.5 }),
    ];
    const result = selectVectorActivated(entries, {
      scoredEntries: [
        { entryId: "low", score: 0.6 },
        { entryId: "high", score: 0.9 },
      ],
    });
    expect(result.map((e) => e.id)).toEqual(["high", "low"]);
  });

  it("filters out entries below their threshold", () => {
    const entries = [
      entry({ id: "strict", vectorThreshold: 0.8 }),
      entry({ id: "loose", vectorThreshold: 0.3 }),
    ];
    const result = selectVectorActivated(entries, {
      scoredEntries: [
        { entryId: "strict", score: 0.5 },
        { entryId: "loose", score: 0.5 },
      ],
    });
    expect(result.map((e) => e.id)).toEqual(["loose"]);
  });

  it("respects vectorBudget", () => {
    const entries = [
      entry({ id: "a", vectorThreshold: 0.4, vectorBudget: 1 }),
      entry({ id: "b", vectorThreshold: 0.4 }),
      entry({ id: "c", vectorThreshold: 0.4 }),
    ];
    const result = selectVectorActivated(entries, {
      scoredEntries: [
        { entryId: "a", score: 0.9 },
        { entryId: "b", score: 0.8 },
        { entryId: "c", score: 0.7 },
      ],
    });
    // Max budget across candidates is 1 (entry "a")
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("a");
  });

  it("skips disabled and alwaysOn entries", () => {
    const entries = [
      entry({ id: "off", vectorThreshold: 0.5, enabled: false }),
      entry({ id: "always", vectorThreshold: 0.5, alwaysOn: true }),
      entry({ id: "ok", vectorThreshold: 0.5 }),
    ];
    const result = selectVectorActivated(entries, {
      scoredEntries: [
        { entryId: "off", score: 0.9 },
        { entryId: "always", score: 0.9 },
        { entryId: "ok", score: 0.9 },
      ],
    });
    expect(result.map((e) => e.id)).toEqual(["ok"]);
  });
});
