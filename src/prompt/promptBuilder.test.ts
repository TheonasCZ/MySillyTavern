import { describe, expect, it } from "vitest";

import type { LoreEntryLike } from "../lorebooks/activation";
import {
  buildPrompt,
  MIN_VERBATIM_MESSAGES,
  personaDisplayName,
  substitutePlaceholders,
  type CharacterLike,
  type LedgerFactLike,
  type PersonaLike,
  type PromptBuilderInput,
  type PromptMessage,
} from "./promptBuilder";

function makeCharacter(partial: Partial<CharacterLike> = {}): CharacterLike {
  return {
    name: "Elara",
    description: "A wandering mage.",
    personality: "Curious and blunt.",
    scenario: "A tavern at dusk.",
    systemPrompt: "",
    postHistoryInstructions: "",
    mesExample: "",
    ...partial,
  };
}

function makePersona(partial: Partial<PersonaLike> = {}): PersonaLike {
  return { name: "Kai", description: "", ...partial };
}

function makeFact(partial: Partial<LedgerFactLike> = {}): LedgerFactLike {
  return {
    id: Math.random().toString(36).slice(2),
    category: "world",
    subject: "Ashford",
    fact: "The capital city.",
    status: "active",
    locked: false,
    ...partial,
  };
}

function makeHistory(n: number): PromptMessage[] {
  const out: PromptMessage[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ role: i % 2 === 0 ? "user" : "assistant", content: `Message number ${i}.` });
  }
  return out;
}

function baseInput(overrides: Partial<PromptBuilderInput> = {}): PromptBuilderInput {
  return {
    character: makeCharacter(),
    persona: makePersona(),
    ledgerFacts: [],
    summary: null,
    loreEntries: [],
    history: makeHistory(6),
    contextBudget: 100_000,
    ...overrides,
  };
}

describe("buildPrompt — composition order & placeholders", () => {
  it("places sections in order: system core, facts, lore, summary, then history verbatim, then post_history_instructions", () => {
    const input = baseInput({
      character: makeCharacter({ postHistoryInstructions: "Stay in character, {{char}}." }),
      ledgerFacts: [makeFact({ category: "world", subject: "Ashford", fact: "The capital." })],
      loreEntries: [
        {
          id: "l1",
          keys: ["keep"],
          secondaryKeys: [],
          content: "The old keep stands north of town.",
          priority: 10,
          alwaysOn: false,
          caseSensitive: false,
          enabled: true,
        },
      ],
      summary: "Elara arrived in Ashford and met the innkeeper.",
      history: makeHistory(2),
    });

    const { messages } = buildPrompt(input);
    const system = messages[0];
    expect(system.role).toBe("system");

    const factsIdx = system.content.indexOf("[FAKTA SVĚTA");
    const loreIdx = system.content.indexOf("keep stands north");
    const summaryIdx = system.content.indexOf("[DOSAVADNÍ PŘÍBĚH]");
    const descriptionIdx = system.content.indexOf("A wandering mage");

    expect(descriptionIdx).toBeGreaterThanOrEqual(0);
    expect(factsIdx).toBeGreaterThan(descriptionIdx);
    expect(loreIdx).toBeGreaterThan(factsIdx);
    expect(summaryIdx).toBeGreaterThan(loreIdx);

    // History follows the system message, verbatim, oldest first.
    expect(messages[1]).toEqual({ role: "user", content: "Message number 0." });
    expect(messages[2]).toEqual({ role: "assistant", content: "Message number 1." });

    // post_history_instructions is the final message.
    const last = messages[messages.length - 1];
    expect(last.role).toBe("system");
    expect(last.content).toBe("Stay in character, Elara.");
  });

  it("groups active facts by category in order world, player, npc, quest, event", () => {
    const input = baseInput({
      ledgerFacts: [
        makeFact({ category: "event", subject: "Storm", fact: "A storm hit the coast." }),
        makeFact({ category: "world", subject: "Ashford", fact: "The capital." }),
        makeFact({ category: "quest", subject: "MainQuest", fact: "Find the relic." }),
        makeFact({ category: "player", subject: "Kai", fact: "Is a novice mage." }),
        makeFact({ category: "npc", subject: "Innkeeper", fact: "Runs the tavern." }),
      ],
    });
    const { messages } = buildPrompt(input);
    const text = messages[0].content;
    const idx = (needle: string) => text.indexOf(needle);

    expect(idx("Ashford")).toBeLessThan(idx("(player/Kai)"));
    expect(idx("(player/Kai)")).toBeLessThan(idx("Innkeeper"));
    expect(idx("Innkeeper")).toBeLessThan(idx("MainQuest"));
    expect(idx("MainQuest")).toBeLessThan(idx("Storm"));
  });

  it("formats each fact line as `- (category/subject) fact`", () => {
    const input = baseInput({
      ledgerFacts: [makeFact({ category: "npc", subject: "Innkeeper", fact: "Runs the tavern." })],
    });
    const { messages } = buildPrompt(input);
    expect(messages[0].content).toContain("- (npc/Innkeeper) Runs the tavern.");
  });

  it("ignores archived facts entirely", () => {
    const input = baseInput({
      ledgerFacts: [makeFact({ status: "archived", subject: "Ghost", fact: "No longer true." })],
    });
    const { messages, report } = buildPrompt(input);
    expect(messages[0].content).not.toContain("Ghost");
    expect(report.sections.factsTotal).toBe(0);
  });

  it("substitutes {{char}}/{{user}} in the system core, facts and lore", () => {
    const input = baseInput({
      character: makeCharacter({ systemPrompt: "You are {{char}}, companion to {{user}}." }),
      ledgerFacts: [makeFact({ subject: "{{char}}'s home", fact: "{{user}} visited it once." })],
      loreEntries: [
        {
          id: "l1",
          keys: [],
          secondaryKeys: [],
          content: "{{char}} once fought here for {{user}}.",
          priority: 5,
          alwaysOn: true,
          caseSensitive: false,
          enabled: true,
        },
      ],
    });
    const { messages } = buildPrompt(input);
    const text = messages[0].content;
    expect(text).toContain("You are Elara, companion to Kai.");
    expect(text).toContain("Elara's home");
    expect(text).toContain("Kai visited it once.");
    expect(text).toContain("Elara once fought here for Kai.");
    expect(text).not.toMatch(/\{\{char\}\}|\{\{user\}\}/i);
  });

  it("falls back to the default RP instructions and 'User' name when card/persona are minimal", () => {
    const input = baseInput({ character: makeCharacter({ systemPrompt: "" }), persona: null });
    const { messages } = buildPrompt(input);
    expect(messages[0].content).toContain("Elara");
    expect(messages[0].content).toContain("User");
  });

  it("takes only the last `verbatimWindow` messages of history", () => {
    const input = baseInput({ history: makeHistory(10), verbatimWindow: 3 });
    const { messages, report } = buildPrompt(input);
    const historyMessages = messages.filter((m) => m.role !== "system");
    expect(historyMessages).toHaveLength(3);
    expect(historyMessages[0].content).toBe("Message number 7.");
    expect(report.sections.historyMessagesIncluded).toBe(3);
    expect(report.sections.historyMessagesTotal).toBe(10);
  });

  it("reports total estimated tokens and budget, not over budget when everything fits", () => {
    const { report } = buildPrompt(baseInput());
    expect(report.overBudget).toBe(false);
    expect(report.estimatedTokens).toBeGreaterThan(0);
    expect(report.budget).toBe(100_000);
  });
});

describe("buildPrompt — trimming under budget pressure", () => {
  it("(a) trims lore from the lowest priority first when over budget", () => {
    const entries: LoreEntryLike[] = [
      { id: "low", keys: [], secondaryKeys: [], content: "L".repeat(200), priority: 10, alwaysOn: true, caseSensitive: false, enabled: true },
      { id: "mid", keys: [], secondaryKeys: [], content: "M".repeat(200), priority: 50, alwaysOn: true, caseSensitive: false, enabled: true },
      { id: "high", keys: [], secondaryKeys: [], content: "H".repeat(200), priority: 90, alwaysOn: true, caseSensitive: false, enabled: true },
    ];
    const fits = baseInput({ loreEntries: entries, history: makeHistory(2) });
    const baseline = buildPrompt(fits).report.estimatedTokens;

    const tight = buildPrompt({ ...fits, contextBudget: baseline - 1 });
    expect(tight.report.sections.loreIncluded).toBeLessThan(3);
    expect(tight.report.trimmedNotes.some((n) => n.includes("Lorebook"))).toBe(true);
    // The lowest-priority entry is the one that must be gone.
    expect(tight.messages[0].content).not.toContain("LLLLL");
  });

  it("(b) trims older verbatim messages before touching the system core, never below the minimum", () => {
    const input = baseInput({ history: makeHistory(20), contextBudget: 1 });
    const { report } = buildPrompt(input);
    expect(report.sections.historyMessagesIncluded).toBe(MIN_VERBATIM_MESSAGES);
  });

  it("keeps the most recent messages when trimming history", () => {
    const input = baseInput({ history: makeHistory(20), contextBudget: 1 });
    const { messages } = buildPrompt(input);
    const historyMessages = messages.filter((m) => m.role !== "system");
    expect(historyMessages[historyMessages.length - 1].content).toBe("Message number 19.");
  });

  it("(c) trims the summary from its start, keeping the tail", () => {
    const summary = Array.from({ length: 40 }, (_, i) => `Event ${i} happened in the story.`).join(" ");
    const fits = baseInput({ summary, history: makeHistory(2) });
    const baseline = buildPrompt(fits).report.estimatedTokens;

    const tight = buildPrompt({ ...fits, contextBudget: baseline - 5 });
    expect(tight.report.sections.summaryTruncated).toBe(true);
    // The tail (most recent events) survives; the earliest is cut.
    expect(tight.messages[0].content).not.toContain("Event 0 happened");
    expect(tight.messages[0].content).toContain("Event 39 happened");
  });

  it("(d) trims facts event -> quest -> npc, never world or player", () => {
    const facts = [
      makeFact({ category: "world", subject: "Ashford", fact: "The capital city, seat of the old kings." }),
      makeFact({ category: "player", subject: "Kai", fact: "A novice mage learning the basics of fire." }),
      makeFact({ category: "npc", subject: "Innkeeper", fact: "Runs the Sleepy Dragon tavern in town." }),
      makeFact({ category: "quest", subject: "MainQuest", fact: "Must find the lost relic of Ashford." }),
      makeFact({ category: "event", subject: "Storm", fact: "A great storm recently hit the coastline." }),
    ];
    const input = baseInput({ ledgerFacts: facts, history: makeHistory(2), contextBudget: 1 });
    const { report, messages } = buildPrompt(input);

    expect(report.sections.factsIncluded).toBe(2);
    expect(messages[0].content).toContain("(world/Ashford)");
    expect(messages[0].content).toContain("(player/Kai)");
    expect(messages[0].content).not.toContain("(npc/Innkeeper)");
    expect(messages[0].content).not.toContain("(quest/MainQuest)");
    expect(messages[0].content).not.toContain("(event/Storm)");
  });

  it("(d) with factRelevance cuts the least relevant fact in a category first", () => {
    const facts = [
      makeFact({ id: "f-high", category: "event", subject: "Crystal", fact: "Found a strange crystal." }),
      makeFact({ id: "f-low", category: "event", subject: "Weather", fact: "It rained last week." }),
      makeFact({ id: "f-mid", category: "event", subject: "Feast", fact: "A feast was held." }),
    ];
    const input = baseInput({
      ledgerFacts: facts,
      history: makeHistory(2),
      contextBudget: 1,
      factRelevance: { "f-high": 0.9, "f-low": 0.1, "f-mid": 0.5 },
    });
    const { report } = buildPrompt(input);

    const cutOrder = report.trimmedNotes
      .filter((n) => n.startsWith("Fakta:"))
      .map((n) => /event\/(\w+)/.exec(n)?.[1]);
    expect(cutOrder).toEqual(["Weather", "Feast", "Crystal"]);
  });

  it("(d) cuts facts missing from factRelevance before scored ones", () => {
    const facts = [
      makeFact({ id: "f-scored", category: "event", subject: "Crystal", fact: "Found a strange crystal." }),
      makeFact({ id: "f-unscored", category: "event", subject: "Feast", fact: "A feast was held." }),
    ];
    const input = baseInput({
      ledgerFacts: facts,
      history: makeHistory(2),
      contextBudget: 1,
      factRelevance: { "f-scored": 0.2 },
    });
    const { report } = buildPrompt(input);

    const cutOrder = report.trimmedNotes
      .filter((n) => n.startsWith("Fakta:"))
      .map((n) => /event\/(\w+)/.exec(n)?.[1]);
    expect(cutOrder).toEqual(["Feast", "Crystal"]);
  });

  it("renders retrieved memories after the summary and trims them first", () => {
    const roomy = buildPrompt(
      baseInput({
        summary: "Kai found a strange crystal months ago.",
        retrievedMemories: ["Hráč: Vytáhnu krystal.\nVypravěč: Krystal se rozzáří."],
      }),
    );
    expect(roomy.messages[0].content).toContain("[RELEVANTNÍ VZPOMÍNKY");
    expect(roomy.messages[0].content).toContain("Krystal se rozzáří.");
    expect(roomy.report.sections.memoriesIncluded).toBe(1);
    const summaryIdx = roomy.messages[0].content.indexOf("[DOSAVADNÍ PŘÍBĚH]");
    const memoriesIdx = roomy.messages[0].content.indexOf("[RELEVANTNÍ VZPOMÍNKY");
    expect(memoriesIdx).toBeGreaterThan(summaryIdx);

    const tight = buildPrompt(
      baseInput({
        retrievedMemories: ["První vzpomínka.", "Druhá vzpomínka."],
        history: makeHistory(2),
        contextBudget: 1,
      }),
    );
    expect(tight.report.sections.memoriesIncluded).toBe(0);
    expect(tight.report.sections.memoriesTotal).toBe(2);
    expect(tight.messages[0].content).not.toContain("VZPOMÍNKY");
    // Memories go before lore/history/summary in the trim order.
    expect(tight.report.trimmedNotes[0]).toContain("Vzpomínky");
  });

  it("(e) drops mes_example only as a last resort", () => {
    const input = baseInput({
      character: makeCharacter({ mesExample: "Elara: *draws her blade* Stand back." }),
      history: makeHistory(2),
      contextBudget: 1,
    });
    const { report, messages } = buildPrompt(input);
    expect(report.sections.mesExampleIncluded).toBe(false);
    expect(messages[0].content).not.toContain("draws her blade");
  });

  it("never trims below the system core and the minimum verbatim messages, even far under budget", () => {
    const input = baseInput({
      character: makeCharacter({ mesExample: "Example dialogue line." }),
      ledgerFacts: [makeFact({ category: "world", subject: "Ashford", fact: "The capital." })],
      loreEntries: [
        { id: "l1", keys: [], secondaryKeys: [], content: "Lore content here.", priority: 10, alwaysOn: true, caseSensitive: false, enabled: true },
      ],
      summary: "Something happened once.",
      history: makeHistory(20),
      contextBudget: 1,
    });
    const { messages, report } = buildPrompt(input);
    expect(messages[0].content).toContain("A wandering mage"); // system core survives
    expect(report.sections.historyMessagesIncluded).toBe(MIN_VERBATIM_MESSAGES);
    expect(report.overBudget).toBe(true);
  });
});

describe("personaDisplayName / substitutePlaceholders", () => {
  it("falls back to 'User' when there's no persona", () => {
    expect(personaDisplayName(null)).toBe("User");
  });

  it("replaces both placeholders case-insensitively everywhere", () => {
    expect(substitutePlaceholders("{{Char}} and {{USER}}", "Elara", "Kai")).toBe("Elara and Kai");
  });
});
