import { describe, expect, it } from "vitest";

import { parseGameTags } from "./inventoryTags";

describe("parseGameTags — quest tags", () => {
  it("parses documented start/complete/fail forms", () => {
    expect(parseGameTags("[QUEST:+Najít klíč]").questMutations).toEqual([
      { op: "start", name: "Najít klíč", note: undefined },
    ]);
    expect(parseGameTags("[QUEST:✓Najít klíč]").questMutations).toEqual([
      { op: "complete", name: "Najít klíč", note: undefined },
    ]);
    expect(parseGameTags("[QUEST:-Najít klíč]").questMutations).toEqual([
      { op: "fail", name: "Najít klíč", note: undefined },
    ]);
  });

  it("parses the loose model output with a status suffix", () => {
    const { questMutations, cleanText } = parseGameTags(
      "Text před. [QUEST: Hledání prastarých runových fragmentů (aktivní)] Text po.",
    );
    expect(questMutations).toEqual([
      { op: "start", name: "Hledání prastarých runových fragmentů", note: undefined },
    ]);
    expect(cleanText).not.toContain("[QUEST");
  });

  it("maps completion suffixes and notes", () => {
    expect(parseGameTags("[QUEST: Runy (splněno)]").questMutations[0].op).toBe("complete");
    expect(parseGameTags("[QUEST:Runy: našel jsi první fragment]").questMutations[0]).toEqual({
      op: "note",
      name: "Runy",
      note: "našel jsi první fragment",
    });
  });

  it("strips quest tags from the visible text", () => {
    const { cleanText } = parseGameTags("Jdeš dál. [QUEST:+Cesta na sever]");
    expect(cleanText.trim()).toBe("Jdeš dál.");
  });
});

describe("parseGameTags — condition tags", () => {
  it("parses add with optional duration and remove", () => {
    expect(parseGameTags("[COND:+Otrava:3 dny]").conditionMutations).toEqual([
      { op: "add", name: "Otrava", duration: "3 dny" },
    ]);
    expect(parseGameTags("[COND:-Otrava]").conditionMutations).toEqual([
      { op: "remove", name: "Otrava", duration: undefined },
    ]);
  });
});

describe("parseGameTags — skill tags", () => {
  it("parses the documented +/- forms", () => {
    expect(parseGameTags("[SKILL:+Pěst]").skillChanges).toEqual([
      { name: "Pěst", delta: 1, absolute: null },
    ]);
    expect(parseGameTags("[SKILL:Pěst+2]").skillChanges).toEqual([
      { name: "Pěst", delta: 2, absolute: null },
    ]);
  });

  it("parses the loose progress format the model actually emits", () => {
    const { skillChanges, cleanText } = parseGameTags(
      "Text. [SKILL: Rozebírání artefaktů 3/10] Text.",
    );
    expect(skillChanges).toEqual([{ name: "Rozebírání artefaktů", delta: 0, absolute: 3 }]);
    expect(cleanText).not.toContain("[SKILL");
  });
});

describe("parseGameTags — time tags", () => {
  it("parses [TIME:+Nd] as a day-advance mutation", () => {
    expect(parseGameTags("[TIME:+1d]").timeMutations).toEqual([{ days: 1 }]);
    expect(parseGameTags("[TIME:+3d]").timeMutations).toEqual([{ days: 3 }]);
  });

  it("strips an unsupported clock-time tag without producing a mutation", () => {
    const { timeMutations, cleanText } = parseGameTags("Scéna. [TIME: 14:00] Pokračuje.");
    expect(timeMutations).toEqual([]);
    expect(cleanText).not.toContain("[TIME");
  });
});
