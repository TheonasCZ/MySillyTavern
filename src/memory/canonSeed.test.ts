import { describe, expect, it } from "vitest";

import { parseSeedOutput } from "./canonSeed";

describe("parseSeedOutput (M25.5)", () => {
  it("parses fenced JSON and trims fields", () => {
    const raw = '```json\n[{"category":"world","subject":" Žánr a tón světa ","fact":" Nízká fantasy bez technologie. "}]\n```';
    expect(parseSeedOutput(raw)).toEqual([
      { category: "world", subject: "Žánr a tón světa", fact: "Nízká fantasy bez technologie." },
    ]);
  });

  it("drops invalid categories and malformed entries, caps at 5", () => {
    const rules = Array.from({ length: 8 }, (_, i) => ({
      category: "world",
      subject: `Pravidlo ${i}`,
      fact: "Platí.",
    }));
    const raw = JSON.stringify([
      ...rules,
      { category: "bogus", subject: "X", fact: "Y" },
      { subject: "chybí kategorie", fact: "Z" },
    ]);
    const out = parseSeedOutput(raw);
    expect(out).toHaveLength(5);
    expect(out.every((r) => r.category === "world")).toBe(true);
  });

  it("returns [] on garbage", () => {
    expect(parseSeedOutput("")).toEqual([]);
    expect(parseSeedOutput("Nemohu vytvořit pravidla.")).toEqual([]);
  });
});
