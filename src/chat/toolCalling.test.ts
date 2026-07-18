import { describe, expect, it } from "vitest";

import { lookupItemDetail, type ChatStateLists } from "./toolCalling";

const state: ChatStateLists = {
  inventory: [
    { item: "Rezavý meč", qty: 1, note: "Nalezen v kryptě, +1 k zastrašení" },
    { item: "Pochodeň", qty: 3 },
  ],
  skills: [{ name: "Šerm", level: 4 }],
  conditions: [
    {
      name: "Krvácení",
      description: "Ztrácíš 2 životy za kolo.",
      expiresAt: "2026-07-20",
      modifiers: [{ stat: "síla", value: -1 }],
    },
  ],
  modifications: [{ name: "Jizva na tváři", description: "Připomínka souboje s vlkodlakem." }],
};

describe("lookupItemDetail", () => {
  it("finds an inventory item by exact name, case-insensitive", () => {
    const result = lookupItemDetail(state, "rezavý meč");
    expect(result).toContain("Rezavý meč");
    expect(result).toContain("Nalezen v kryptě");
  });

  it("finds an inventory item by a partial/paraphrased name", () => {
    const result = lookupItemDetail(state, "meč");
    expect(result).toContain("Rezavý meč");
  });

  it("finds a skill", () => {
    const result = lookupItemDetail(state, "Šerm");
    expect(result).toContain("úroveň 4");
  });

  it("finds a condition with duration and modifiers", () => {
    const result = lookupItemDetail(state, "krvácení");
    expect(result).toContain("Ztrácíš 2 životy");
    expect(result).toContain("2026-07-20");
    expect(result).toContain("síla -1");
  });

  it("finds a modification", () => {
    const result = lookupItemDetail(state, "jizva");
    expect(result).toContain("vlkodlakem");
  });

  it("returns a clear not-found result instead of throwing", () => {
    const result = lookupItemDetail(state, "neexistující věc");
    expect(result).toContain("Nenalezeno");
  });

  it("never throws on empty/garbage input", () => {
    expect(() => lookupItemDetail(state, "")).not.toThrow();
    expect(() => lookupItemDetail(state, "   ")).not.toThrow();
  });
});
