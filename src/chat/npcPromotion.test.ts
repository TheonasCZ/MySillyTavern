import { describe, expect, it } from "vitest";

import {
  buildPromotionPrompt,
  parsePromotedCard,
  truncateTranscript,
  type TranscriptEntry,
} from "./npcPromotion";

describe("parsePromotedCard", () => {
  it("parses a plain JSON object", () => {
    const raw =
      '{"name":"Elarion","description":"A wandering scout.","personality":"Cautious.","scenario":"Meets the party at the crossroads.","first_mes":""}';
    expect(parsePromotedCard(raw)).toEqual({
      name: "Elarion",
      description: "A wandering scout.",
      personality: "Cautious.",
      scenario: "Meets the party at the crossroads.",
      firstMes: "",
    });
  });

  it("strips ```json code fences", () => {
    const raw =
      '```json\n{"name":"Elarion","description":"Scout.","personality":"Cautious.","scenario":"Crossroads.","first_mes":""}\n```';
    expect(parsePromotedCard(raw)).toMatchObject({ name: "Elarion" });
  });

  it("strips plain ``` fences without a language tag", () => {
    const raw =
      '```\n{"name":"Elarion","description":"Scout.","personality":"Cautious.","scenario":"Crossroads.","first_mes":""}\n```';
    expect(parsePromotedCard(raw)).toMatchObject({ name: "Elarion" });
  });

  it("finds the object even with leading/trailing prose", () => {
    const raw =
      'Here is the card:\n{"name":"Elarion","description":"Scout.","personality":"Cautious.","scenario":"Crossroads.","first_mes":""}\nLet me know if you need changes.';
    expect(parsePromotedCard(raw)).toMatchObject({ name: "Elarion" });
  });

  it("always forces firstMes to empty even if the model filled it in", () => {
    const raw =
      '{"name":"Elarion","description":"Scout.","personality":"Cautious.","scenario":"Crossroads.","first_mes":"Hello there!"}';
    expect(parsePromotedCard(raw)?.firstMes).toBe("");
  });

  it("returns null for unparseable input instead of throwing", () => {
    expect(parsePromotedCard("not json at all")).toBeNull();
    expect(parsePromotedCard("")).toBeNull();
    expect(parsePromotedCard("{broken json")).toBeNull();
  });

  it("returns null when a required field is missing", () => {
    const raw = '{"name":"Elarion","description":"Scout.","scenario":"Crossroads.","first_mes":""}';
    expect(parsePromotedCard(raw)).toBeNull();
  });

  it("returns null when there's no object at all", () => {
    expect(parsePromotedCard('["name","Elarion"]')).toBeNull();
  });
});

describe("truncateTranscript", () => {
  function msg(i: number): TranscriptEntry {
    return { role: "assistant", content: `message ${i}` };
  }

  it("keeps only the last `max` messages, oldest first", () => {
    const messages = Array.from({ length: 50 }, (_, i) => msg(i));
    const result = truncateTranscript(messages, 40);
    expect(result).toHaveLength(40);
    expect(result[0].content).toBe("message 10");
    expect(result[39].content).toBe("message 49");
  });

  it("returns everything when there are fewer than `max` messages", () => {
    const messages = [msg(0), msg(1)];
    expect(truncateTranscript(messages, 40)).toHaveLength(2);
  });

  it("truncates overly long message content", () => {
    const long = "x".repeat(1000);
    const [result] = truncateTranscript([{ role: "user", content: long }], 40);
    expect(result.content.length).toBeLessThan(1000);
    expect(result.content.endsWith("…")).toBe(true);
  });
});

describe("buildPromotionPrompt", () => {
  it("includes the NPC name, facts, and transcript in the user message", () => {
    const messages = buildPromotionPrompt(
      "Elarion",
      [{ subject: "Elarion", fact: "A scout who knows the forest paths." }],
      [{ role: "user", content: "Elarion waves at us." }],
    );
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");
    expect(messages[1].content).toContain("Elarion");
    expect(messages[1].content).toContain("A scout who knows the forest paths.");
    expect(messages[1].content).toContain("Elarion waves at us.");
  });

  it("caps the transcript included in the prompt to MAX_CONTEXT_MESSAGES", () => {
    const many = Array.from({ length: 100 }, (_, i) => ({
      role: "assistant" as const,
      content: `line ${i}`,
    }));
    const messages = buildPromotionPrompt("NPC", [], many);
    expect(messages[1].content).not.toContain("line 0\n");
    expect(messages[1].content).toContain("line 99");
  });
});
