import { describe, expect, it } from "vitest";

import {
  mergeExtractedFacts,
  parseExtractorOutput,
  type ExtractedFact,
  type LedgerSnapshotFact,
} from "./extractor";

describe("parseExtractorOutput", () => {
  it("parses a plain JSON array", () => {
    const raw = '[{"category":"world","subject":"Ashford","fact":"The capital.","action":"upsert"}]';
    expect(parseExtractorOutput(raw)).toEqual([
      { category: "world", subject: "Ashford", fact: "The capital.", action: "upsert" },
    ]);
  });

  it("strips ```json code fences", () => {
    const raw = '```json\n[{"category":"npc","subject":"Innkeeper","fact":"Runs the tavern.","action":"upsert"}]\n```';
    expect(parseExtractorOutput(raw)).toHaveLength(1);
  });

  it("strips plain ``` fences without a language tag", () => {
    const raw = '```\n[{"category":"npc","subject":"Innkeeper","fact":"Runs the tavern.","action":"upsert"}]\n```';
    expect(parseExtractorOutput(raw)).toHaveLength(1);
  });

  it("finds the array even with leading/trailing prose", () => {
    const raw =
      'Here is the extracted data:\n[{"category":"quest","subject":"MainQuest","fact":"Find the relic.","action":"upsert"}]\nLet me know if you need more.';
    expect(parseExtractorOutput(raw)).toHaveLength(1);
  });

  it("returns [] for unparseable input instead of throwing", () => {
    expect(parseExtractorOutput("not json at all")).toEqual([]);
    expect(parseExtractorOutput("")).toEqual([]);
    expect(parseExtractorOutput("[{broken json")).toEqual([]);
  });

  it("drops elements with an invalid category or missing fields", () => {
    const raw = JSON.stringify([
      { category: "world", subject: "Ashford", fact: "Ok.", action: "upsert" },
      { category: "bogus", subject: "X", fact: "Y", action: "upsert" },
      { category: "npc", subject: "", fact: "No subject.", action: "upsert" },
      { category: "npc", subject: "Y", fact: "Bad action.", action: "delete" },
    ]);
    const result = parseExtractorOutput(raw);
    expect(result).toEqual([{ category: "world", subject: "Ashford", fact: "Ok.", action: "upsert" }]);
  });

  it("trims subject/fact whitespace", () => {
    const raw = '[{"category":"world","subject":"  Ashford  ","fact":"  The capital.  ","action":"upsert"}]';
    expect(parseExtractorOutput(raw)[0]).toEqual({
      category: "world",
      subject: "Ashford",
      fact: "The capital.",
      action: "upsert",
    });
  });

  it("returns [] when there's no array at all", () => {
    expect(parseExtractorOutput('{"category":"world"}')).toEqual([]);
  });
});

function fact(partial: Partial<LedgerSnapshotFact> = {}): LedgerSnapshotFact {
  return {
    id: "id1",
    category: "world",
    subject: "Ashford",
    fact: "The capital.",
    status: "active",
    locked: false,
    ...partial,
  };
}

function extracted(partial: Partial<ExtractedFact> = {}): ExtractedFact {
  return { category: "world", subject: "Ashford", fact: "The capital city.", action: "upsert", ...partial };
}

describe("mergeExtractedFacts", () => {
  it("inserts a new fact that has no existing match", () => {
    const ops = mergeExtractedFacts([], [extracted({ subject: "Ashford" })]);
    expect(ops).toEqual([{ kind: "insert", category: "world", subject: "Ashford", fact: "The capital city." }]);
  });

  it("updates an existing unlocked fact on upsert", () => {
    const ops = mergeExtractedFacts([fact()], [extracted({ fact: "Updated capital info." })]);
    expect(ops).toEqual([
      { kind: "update", category: "world", subject: "Ashford", fact: "Updated capital info.", factId: "id1" },
    ]);
  });

  it("skips a locked fact on upsert instead of updating it", () => {
    const ops = mergeExtractedFacts([fact({ locked: true })], [extracted({ fact: "Drift attempt." })]);
    expect(ops).toEqual([
      {
        kind: "skip",
        category: "world",
        subject: "Ashford",
        fact: "Drift attempt.",
        factId: "id1",
        reason: "locked",
      },
    ]);
  });

  it("matches subjects case-insensitively", () => {
    const ops = mergeExtractedFacts(
      [fact({ subject: "ashford" })],
      [extracted({ subject: "ASHFORD", fact: "Case-insensitive match." })],
    );
    expect(ops[0].kind).toBe("update");
    expect(ops[0].factId).toBe("id1");
  });

  it("only matches within the same category", () => {
    const ops = mergeExtractedFacts(
      [fact({ category: "world" })],
      [extracted({ category: "npc", subject: "Ashford" })],
    );
    expect(ops[0].kind).toBe("insert");
  });

  it("archives an existing unlocked fact on remove", () => {
    const ops = mergeExtractedFacts([fact()], [extracted({ action: "remove" })]);
    expect(ops).toEqual([
      { kind: "archive", category: "world", subject: "Ashford", fact: "The capital city.", factId: "id1" },
    ]);
  });

  it("skips remove of a locked fact", () => {
    const ops = mergeExtractedFacts([fact({ locked: true })], [extracted({ action: "remove" })]);
    expect(ops[0]).toEqual({
      kind: "skip",
      category: "world",
      subject: "Ashford",
      fact: "The capital city.",
      factId: "id1",
      reason: "locked",
    });
  });

  it("skips remove of a fact that doesn't exist", () => {
    const ops = mergeExtractedFacts([], [extracted({ action: "remove" })]);
    expect(ops[0]).toEqual({
      kind: "skip",
      category: "world",
      subject: "Ashford",
      fact: "The capital city.",
      reason: "not-found",
    });
  });

  it("processes a batch of mixed actions independently", () => {
    const existing = [fact({ id: "a", subject: "Ashford" }), fact({ id: "b", subject: "Kai", category: "player", locked: true })];
    const ops = mergeExtractedFacts(existing, [
      extracted({ subject: "Ashford", fact: "New info." }),
      extracted({ category: "player", subject: "Kai", fact: "Drift.", action: "upsert" }),
      extracted({ category: "npc", subject: "Innkeeper", fact: "New NPC.", action: "upsert" }),
    ]);
    expect(ops.map((o) => o.kind)).toEqual(["update", "skip", "insert"]);
  });
});
