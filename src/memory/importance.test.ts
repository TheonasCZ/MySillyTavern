import { describe, expect, it } from "vitest";

import {
  IMPORTANCE_THRESHOLD,
  formatScoredMessages,
  scoreImportance,
  type TranscriptMessage,
} from "./importance";

/** Tiny helper to build a minimal TranscriptMessage. */
function msg(
  id: string,
  content: string,
  role: "user" | "assistant" = "user",
  speakerName?: string | null,
): TranscriptMessage {
  return {
    id,
    chatId: "test-chat",
    role,
    content,
    swipes: [],
    activeSwipe: 0,
    characterId: null,
    createdAt: new Date().toISOString(),
    speakerName: speakerName ?? null,
  };
}

// ---------------------------------------------------------------------------
// scoreImportance
// ---------------------------------------------------------------------------

describe("scoreImportance", () => {
  it("returns empty Map for empty input", () => {
    expect(scoreImportance([]).size).toBe(0);
  });

  it("returns a score for every message", () => {
    const messages = [
      msg("1", "Ahoj"),
      msg("2", "Dobrý den, jak se máš?"),
      msg("3", "Našel jsem meč v jeskyni."),
    ];
    const scores = scoreImportance(messages);
    expect(scores.size).toBe(3);
    for (const m of messages) {
      const s = scores.get(m.id);
      expect(s).toBeDefined();
      expect(s!).toBeGreaterThanOrEqual(0);
      expect(s!).toBeLessThanOrEqual(1);
    }
  });

  it("scores content-rich messages higher than trivial ones", () => {
    const trivial = msg("t", "ok");
    const rich = msg(
      "r",
      "Strážný jménem Aldric mi prozradil, že král Karel IV. je pod vlivem temné magie z Černé věže. Musíme najít Artefakt Světla v Jeskyni Zapomnění.",
    );

    const scores = scoreImportance([trivial, rich]);
    expect(scores.get("r")!).toBeGreaterThan(scores.get("t")!);
  });

  it("scores messages with named entities higher", () => {
    const noEntities = msg("ne", "byla to dlouhá cesta přes les a pole");
    const withEntities = msg(
      "we",
      "Potkal jsem Gandalfa u řeky Anduiny poblíž Roklinky.",
    );

    const scores = scoreImportance([noEntities, withEntities]);
    expect(scores.get("we")!).toBeGreaterThan(scores.get("ne")!);
  });

  it("detects sentiment shift between consecutive messages", () => {
    const positive = msg("p", "To je skvělé! Mám z toho velkou radost.");
    const negative = msg("n", "To je hrozné. Jsem strašně smutný a zoufalý.");

    // First message gets neutral shift (0.5), second gets high shift
    const scores = scoreImportance([positive, negative]);
    // The second message should have a reasonable shift contribution
    expect(scores.get("n")!).toBeGreaterThan(0);
  });

  it("correlates with fact subjects when provided", () => {
    const messages = [
      msg("1", "Král Artuš vytáhl meč z kamene."),
      msg("2", "Počasí je dnes pěkné."),
    ];

    const withoutFacts = scoreImportance(messages);
    const withFacts = scoreImportance(messages, {
      factSubjects: ["Král Artuš", "meč", "kámen"],
    });

    // Message 1 should score higher when fact subjects are provided
    expect(withFacts.get("1")!).toBeGreaterThan(withoutFacts.get("1")!);
    // Message 2 should be unaffected
    expect(withFacts.get("2")!).toBe(withoutFacts.get("2")!);
  });

  it("never throws on malformed input", () => {
    // @ts-expect-error testing runtime safety
    expect(() => scoreImportance(null)).not.toThrow();
    // @ts-expect-error testing runtime safety
    expect(() => scoreImportance(undefined)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// formatScoredMessages
// ---------------------------------------------------------------------------

describe("formatScoredMessages", () => {
  it("returns empty string for empty input", () => {
    expect(formatScoredMessages([], new Map())).toBe("");
  });

  it("prefixes important messages with [důležité]", () => {
    const messages = [msg("1", "Našel jsem meč v jeskyni.", "user", "Hráč")];
    const scores = new Map([["1", 0.9]]);

    const result = formatScoredMessages(messages, scores);
    expect(result).toContain("[důležité]");
    expect(result).toContain("Našel jsem meč v jeskyni.");
  });

  it("compresses adjacent routine messages", () => {
    const messages = [
      msg("1", "ok", "user", "Hráč"),
      msg("2", "dobře", "assistant", "AI"),
      msg("3", "jo", "user", "Hráč"),
    ];
    const scores = new Map([
      ["1", 0.1],
      ["2", 0.2],
      ["3", 0.1],
    ]);

    const result = formatScoredMessages(messages, scores);
    expect(result).toContain("[rutinní]");
    expect(result).not.toContain("ok");
    expect(result).not.toContain("dobře");
    expect(result).not.toContain("jo");
    // Should mention speaker names and message count
    expect(result).toContain("Hráč");
    expect(result).toContain("AI");
    expect(result).toContain("3");
  });

  it("handles mixed important and routine messages", () => {
    const messages = [
      msg("1", "ok", "user", "Hráč"),
      msg("2", "Našel jsem artefakt.", "user", "Hráč"),
      msg("3", "ahoj", "assistant", "AI"),
    ];
    const scores = new Map([
      ["1", 0.1],
      ["2", 0.8],
      ["3", 0.2],
    ]);

    const result = formatScoredMessages(messages, scores);
    const lines = result.split("\n");

    // First line should be routine (msg 1)
    expect(lines[0]).toContain("[rutinní]");
    // Second line should be important (msg 2)
    expect(lines[1]).toContain("[důležité]");
    expect(lines[1]).toContain("Našel jsem artefakt.");
    // Third line should be routine (msg 3)
    expect(lines[2]).toContain("[rutinní]");
  });

  it("falls back to role-based speaker name", () => {
    const messages = [msg("1", "Hello", "assistant", null)];
    const scores = new Map([["1", 0.9]]);

    const result = formatScoredMessages(messages, scores);
    expect(result).toContain("AI:");
  });

  it("respects IMPORTANCE_THRESHOLD boundary", () => {
    const messages = [msg("1", "Test message.")];
    const justBelow = new Map([["1", IMPORTANCE_THRESHOLD]]);
    const justAbove = new Map([["1", IMPORTANCE_THRESHOLD + 0.001]]);

    expect(formatScoredMessages(messages, justBelow)).toContain("[rutinní]");
    expect(formatScoredMessages(messages, justAbove)).toContain("[důležité]");
  });

  it("uses correct Czech plural for message counts", () => {
    const single = [msg("1", "ok")];
    const singleScores = new Map([["1", 0.1]]);
    expect(formatScoredMessages(single, singleScores)).toContain("1 zpráva");

    const two = [msg("1", "ok"), msg("2", "jo")];
    const twoScores = new Map([["1", 0.1], ["2", 0.1]]);
    expect(formatScoredMessages(two, twoScores)).toContain("2 zprávy");

    const five = [
      msg("1", "ok"), msg("2", "ok"), msg("3", "ok"),
      msg("4", "ok"), msg("5", "ok"),
    ];
    const fiveScores = new Map([
      ["1", 0.1], ["2", 0.1], ["3", 0.1], ["4", 0.1], ["5", 0.1],
    ]);
    expect(formatScoredMessages(five, fiveScores)).toContain("5 zpráv");
  });
});
