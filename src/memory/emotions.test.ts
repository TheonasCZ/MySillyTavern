import { describe, expect, it } from "vitest";

import {
  MOOD_CATEGORY,
  MOOD_SUB_KEY,
  decayMoodFact,
  detectMood,
  moodDescription,
} from "./emotions";

// ---- detectMood ---------------------------------------------------------

describe("detectMood", () => {
  it("returns null for empty or non-emotional content", () => {
    expect(detectMood("")).toBeNull();
    expect(detectMood("Šel jsem do lesa a našel meč.")).toBeNull();
    expect(detectMood("12345")).toBeNull();
  });

  it("detects vyděšený and its forms", () => {
    expect(detectMood("Byl jsem vyděšený.")).toBe("vyděšený");
    expect(detectMood("Byla vyděšená a třásla se.")).toBe("vyděšený");
    expect(detectMood("Děti byly vystrašené.")).toBe("vyděšený");
    expect(detectMood("Zděšeně vykřikl.")).toBe("vyděšený");
  });

  it("detects rozzlobený and its forms", () => {
    expect(detectMood("Byl rozzlobený na celý svět.")).toBe("rozzlobený");
    expect(detectMood("Byla naštvaná a nedala to najevo.")).toBe("rozzlobený");
    expect(detectMood("Zuřivě hleděl.")).toBe("rozzlobený");
  });

  it("detects smutný and its forms", () => {
    expect(detectMood("Cítil se smutný a opuštěný.")).toBe("smutný");
    expect(detectMood("Byla nešťastná z té zprávy.")).toBe("smutný");
    expect(detectMood("Sklíčeně svěsil hlavu.")).toBe("smutný");
  });

  it("detects radostný and its forms", () => {
    expect(detectMood("Byl radostný jako dítě.")).toBe("radostný");
    expect(detectMood("Byla veselá a smála se.")).toBe("radostný");
    expect(detectMood("Nadšeně zatleskal.")).toBe("radostný");
  });

  it("detects zmatený and its forms", () => {
    expect(detectMood("Byl zmatený z té situace.")).toBe("zmatený");
    expect(detectMood("Byla zmatená a nevěděla co říct.")).toBe("zmatený");
    expect(detectMood("Dezorientovaně se rozhlížel.")).toBe("zmatený");
  });

  it("detects klidný and its forms", () => {
    expect(detectMood("Zůstal klidný i v nebezpečí.")).toBe("klidný");
    expect(detectMood("Byla vyrovnaná a nic ji nerozhodilo.")).toBe("klidný");
  });

  it("detects napjatý and its forms", () => {
    expect(detectMood("Atmosféra byla napjatá.")).toBe("napjatý");
    expect(detectMood("Byl nervózní z výsledku.")).toBe("napjatý");
    expect(detectMood("Neklidně přecházel po místnosti.")).toBe("napjatý");
  });

  it("detects zamilovaný and its forms", () => {
    expect(detectMood("Byl do ní zamilovaný.")).toBe("zamilovaný");
    expect(detectMood("Byla okouzlená jeho šarmem.")).toBe("zamilovaný");
  });

  it("detects zvědavý and its forms", () => {
    expect(detectMood("Byl zvědavý, co se stane.")).toBe("zvědavý");
    expect(detectMood("Zvídavě nakoukla dovnitř.")).toBe("zvědavý");
  });

  it("detects unavený and its forms", () => {
    expect(detectMood("Byl unavený po dlouhé cestě.")).toBe("unavený");
    expect(detectMood("Byla vyčerpaná a potřebovala spát.")).toBe("unavený");
    expect(detectMood("Znaveně si protřel oči.")).toBe("unavený");
  });

  it("is case-insensitive", () => {
    expect(detectMood("Byl VYDĚŠENÝ.")).toBe("vyděšený");
    expect(detectMood("Byla SmUtNá.")).toBe("smutný");
  });

  it("returns the first matching mood when multiple emotions appear", () => {
    // "vyděšený" is checked first in MOOD_PATTERNS order
    const text = "Byl vyděšený a pak se rozzlobil.";
    expect(detectMood(text)).toBe("vyděšený");
  });
});

// ---- decayMoodFact ------------------------------------------------------

describe("decayMoodFact", () => {
  it("returns true when messageAge exceeds the decay threshold", () => {
    const fact = { updated_at: new Date().toISOString() };
    const now = new Date();
    expect(decayMoodFact(fact, now, 11)).toBe(true);
    expect(decayMoodFact(fact, now, 20)).toBe(true);
  });

  it("returns false when messageAge is at or below the threshold", () => {
    const fact = { updated_at: new Date().toISOString() };
    const now = new Date();
    expect(decayMoodFact(fact, now, 10)).toBe(false);
    expect(decayMoodFact(fact, now, 5)).toBe(false);
    expect(decayMoodFact(fact, now, 0)).toBe(false);
  });

  it("returns true when fact is older than 7 days in wall-clock time", () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const fact = { updated_at: eightDaysAgo.toISOString() };
    const now = new Date();
    // Even with low message count, wall-clock age triggers decay
    expect(decayMoodFact(fact, now, 1)).toBe(true);
  });

  it("returns false for unparseable timestamps (safe)", () => {
    const fact = { updated_at: "not-a-date" };
    const now = new Date();
    // messageAge is low and timestamp is unparseable → keep
    expect(decayMoodFact(fact, now, 3)).toBe(false);
  });
});

// ---- moodDescription ----------------------------------------------------

describe("moodDescription", () => {
  it("returns an empty map for empty input", () => {
    const map = moodDescription([]);
    expect(map.size).toBe(0);
  });

  it("maps character name to mood fact", () => {
    const facts = [
      { subject: "Eliška", fact: "vyděšená a nedůvěřivá" },
      { subject: "Karel", fact: "klidný a vyrovnaný" },
    ];
    const map = moodDescription(facts);
    expect(map.get("Eliška")).toBe("vyděšená a nedůvěřivá");
    expect(map.get("Karel")).toBe("klidný a vyrovnaný");
  });

  it("first fact wins for duplicates", () => {
    const facts = [
      { subject: "Eliška", fact: "vyděšená" },
      { subject: "Eliška", fact: "radostná" },
    ];
    const map = moodDescription(facts);
    expect(map.get("Eliška")).toBe("vyděšená");
  });
});

// ---- Constants ----------------------------------------------------------

describe("MOOD_CATEGORY and MOOD_SUB_KEY", () => {
  it("uses npc as the ledger category for mood facts", () => {
    expect(MOOD_CATEGORY).toBe("npc");
  });

  it("uses mood as the sub_key for mood facts", () => {
    expect(MOOD_SUB_KEY).toBe("mood");
  });
});
