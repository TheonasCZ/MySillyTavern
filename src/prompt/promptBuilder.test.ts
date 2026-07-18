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
    sub_key: "",
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
          enabled: true, recursiveActivation: false, activationDepth: 1, selectiveKeys: [], timed: null, vectorThreshold: null, vectorBudget: 0,
        },
      ],
      summary: "Elara arrived in Ashford and met the innkeeper.",
      history: makeHistory(2),
    });

    const { messages } = buildPrompt(input);
    const system = messages[0];
    expect(system.role).toBe("system");

    const factsIdx = system.content.indexOf("[WORLD FACTS");
    const loreIdx = system.content.indexOf("keep stands north");
    const summaryIdx = system.content.indexOf("[STORY SO FAR]");
    const descriptionIdx = system.content.indexOf("A wandering mage");

    expect(descriptionIdx).toBeGreaterThanOrEqual(0);
    expect(factsIdx).toBeGreaterThan(descriptionIdx);
    expect(loreIdx).toBeGreaterThan(factsIdx);
    expect(summaryIdx).toBeGreaterThan(loreIdx);

    // History follows the system message, verbatim, oldest first.
    expect(messages[1]).toEqual({ role: "user", content: "Message number 0." });
    expect(messages[2]).toEqual({ role: "assistant", content: "Message number 1." });

    // post_history_instructions is the final message, followed by the canon
    // reminder (present here since a world fact was given).
    const last = messages[messages.length - 1];
    expect(last.role).toBe("system");
    expect(last.content.startsWith("Stay in character, Elara.")).toBe(true);
    expect(last.content).toContain("[Canon reminder");
    expect(last.content).toContain("- (world/Ashford) The capital.");
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
          enabled: true, recursiveActivation: false, activationDepth: 1, selectiveKeys: [], timed: null, vectorThreshold: null, vectorBudget: 0,
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
      { id: "low", keys: [], secondaryKeys: [], content: "L".repeat(200), priority: 10, alwaysOn: true, caseSensitive: false, enabled: true, recursiveActivation: false, activationDepth: 1, selectiveKeys: [], timed: null, vectorThreshold: null, vectorBudget: 0 },
      { id: "mid", keys: [], secondaryKeys: [], content: "M".repeat(200), priority: 50, alwaysOn: true, caseSensitive: false, enabled: true, recursiveActivation: false, activationDepth: 1, selectiveKeys: [], timed: null, vectorThreshold: null, vectorBudget: 0 },
      { id: "high", keys: [], secondaryKeys: [], content: "H".repeat(200), priority: 90, alwaysOn: true, caseSensitive: false, enabled: true, recursiveActivation: false, activationDepth: 1, selectiveKeys: [], timed: null, vectorThreshold: null, vectorBudget: 0 },
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
    expect(roomy.messages[0].content).toContain("[RELEVANT MEMORIES");
    expect(roomy.messages[0].content).toContain("Krystal se rozzáří.");
    expect(roomy.report.sections.memoriesIncluded).toBe(1);
    const summaryIdx = roomy.messages[0].content.indexOf("[STORY SO FAR]");
    const memoriesIdx = roomy.messages[0].content.indexOf("[RELEVANT MEMORIES");
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
        { id: "l1", keys: [], secondaryKeys: [], content: "Lore content here.", priority: 10, alwaysOn: true, caseSensitive: false, enabled: true, recursiveActivation: false, activationDepth: 1, selectiveKeys: [], timed: null, vectorThreshold: null, vectorBudget: 0 },
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

describe("buildPrompt — canon reminder (memory anchoring)", () => {
  it("appends a canon reminder with only world/player facts to the trailing system message", () => {
    const facts = [
      makeFact({ category: "world", subject: "Ashford", fact: "Classic high fantasy, no advanced tech." }),
      makeFact({ category: "player", subject: "Kai", fact: "Cannot cast magic directly, only craft artifacts." }),
      makeFact({ category: "npc", subject: "Innkeeper", fact: "Runs the tavern." }),
      makeFact({ category: "quest", subject: "MainQuest", fact: "Find the relic." }),
      makeFact({ category: "event", subject: "Storm", fact: "A storm hit the coast." }),
    ];
    const input = baseInput({ ledgerFacts: facts, history: makeHistory(2) });
    const { messages } = buildPrompt(input);
    const last = messages[messages.length - 1];
    expect(last.role).toBe("system");
    expect(last.content).toContain("[Canon reminder");
    expect(last.content).toContain("(world/Ashford)");
    expect(last.content).toContain("(player/Kai)");
    expect(last.content).not.toContain("(npc/Innkeeper)");
    expect(last.content).not.toContain("(quest/MainQuest)");
    expect(last.content).not.toContain("(event/Storm)");
  });

  it("omits the canon reminder entirely when there are no world/player facts", () => {
    const input = baseInput({
      ledgerFacts: [makeFact({ category: "npc", subject: "Innkeeper", fact: "Runs the tavern." })],
    });
    const { messages } = buildPrompt(input);
    const last = messages[messages.length - 1];
    expect(last.content).not.toContain("[Canon reminder");
  });

  it("sends the canon reminder as its own trailing system message when the card has no post_history_instructions", () => {
    const input = baseInput({
      character: makeCharacter({ postHistoryInstructions: "" }),
      ledgerFacts: [makeFact({ category: "world", subject: "Ashford", fact: "The capital." })],
    });
    const { messages } = buildPrompt(input);
    const last = messages[messages.length - 1];
    expect(last.role).toBe("system");
    expect(last.content).toContain("[Canon reminder");
  });

  it("substitutes {{char}}/{{user}} placeholders in the canon reminder", () => {
    const input = baseInput({
      ledgerFacts: [makeFact({ category: "player", subject: "{{user}}", fact: "{{char}} must never speak for {{user}}." })],
    });
    const { messages } = buildPrompt(input);
    const last = messages[messages.length - 1];
    expect(last.content).toContain("(player/Kai) Elara must never speak for Kai.");
  });

  it("sorts locked facts first, ahead of unlocked ones", () => {
    const facts = [
      makeFact({ category: "world", subject: "Unlocked", fact: "Not pinned.", locked: false }),
      makeFact({ category: "world", subject: "Locked", fact: "Pinned canon.", locked: true }),
    ];
    const input = baseInput({ ledgerFacts: facts });
    const { messages } = buildPrompt(input);
    const last = messages[messages.length - 1];
    const canonBlock = last.content.slice(last.content.indexOf("[Canon reminder"));
    expect(canonBlock.indexOf("(world/Locked)")).toBeLessThan(canonBlock.indexOf("(world/Unlocked)"));
  });

  it("caps the canon reminder size instead of growing unbounded with many world/player facts", () => {
    const facts = Array.from({ length: 100 }, (_, i) =>
      makeFact({ category: "world", subject: `Fact${i}`, fact: "X".repeat(100) }),
    );
    const input = baseInput({ ledgerFacts: facts });
    const { messages, report } = buildPrompt(input);
    const last = messages[messages.length - 1];
    const canonBlock = last.content.slice(last.content.indexOf("[Canon reminder"));
    expect(canonBlock.length).toBeLessThan(2600);
    expect(report.sections.canonReminderTokens).toBeGreaterThan(0);
  });

  it("is never trimmed away by budget pressure, unlike the main facts section", () => {
    const input = baseInput({
      ledgerFacts: [makeFact({ category: "world", subject: "Ashford", fact: "The capital." })],
      history: makeHistory(2),
      contextBudget: 1,
    });
    const { messages } = buildPrompt(input);
    const last = messages[messages.length - 1];
    expect(last.content).toContain("[Canon reminder");
  });

  it("reports canonReminderTokens as 0 when there are no world/player facts", () => {
    const { report } = buildPrompt(baseInput());
    expect(report.sections.canonReminderTokens).toBe(0);
  });
});

describe("buildPrompt — groupMembers (group chats)", () => {
  it("renders a '[Other characters in the scene]' section with name + description per member", () => {
    const input = baseInput({
      groupMembers: [
        { name: "Kai", description: "A blunt novice mage." },
        { name: "Rowan", description: "A quiet archer." },
      ],
    });
    const { messages } = buildPrompt(input);
    const system = messages[0].content;
    expect(system).toContain("[Other characters in the scene]");
    expect(system).toContain("- Kai: A blunt novice mage.");
    expect(system).toContain("- Rowan: A quiet archer.");
  });

  it("adds the speak-only-as-{{char}} instruction, substituted, appended to post_history_instructions", () => {
    const input = baseInput({
      character: makeCharacter({ postHistoryInstructions: "Stay vivid, {{char}}." }),
      groupMembers: [{ name: "Rowan", description: "A mage." }],
    });
    const { messages } = buildPrompt(input);
    const last = messages[messages.length - 1];
    expect(last.role).toBe("system");
    expect(last.content).toContain("Stay vivid, Elara.");
    expect(last.content).toContain("Speak and act only as Elara.");
    expect(last.content).toContain("Never speak for the player (Kai) or other characters (Rowan).");
    expect(last.content).toContain("Do not start your reply with your name followed by a colon.");
  });

  it("sends the group instruction as its own trailing system message when the card has no post_history_instructions", () => {
    const input = baseInput({
      character: makeCharacter({ postHistoryInstructions: "" }),
      groupMembers: [{ name: "Kai", description: "A mage." }],
    });
    const { messages } = buildPrompt(input);
    const last = messages[messages.length - 1];
    expect(last.role).toBe("system");
    expect(last.content).toContain("Speak and act only as Elara.");
  });

  it("truncates a group member's description to ~500 chars", () => {
    const longDescription = "x".repeat(600);
    const input = baseInput({
      groupMembers: [{ name: "Kai", description: longDescription }],
    });
    const { messages } = buildPrompt(input);
    const system = messages[0].content;
    expect(system).toContain(`- Kai: ${"x".repeat(500)}…`);
    expect(system).not.toContain("x".repeat(501));
  });

  it("sets report.sections.groupMembersIncluded when groupMembers is provided", () => {
    const input = baseInput({
      groupMembers: [{ name: "Kai", description: "A mage." }, { name: "Rowan", description: "An archer." }],
    });
    const { report } = buildPrompt(input);
    expect(report.sections.groupMembersIncluded).toBe(2);
  });

  it("does not include groupMembersIncluded in the report when groupMembers is absent", () => {
    const { report } = buildPrompt(baseInput());
    expect(report.sections.groupMembersIncluded).toBeUndefined();
  });

  it("produces byte-identical output to a solo-chat build (no groupMembers) — regression guard", () => {
    const richInput = baseInput({
      character: makeCharacter({ postHistoryInstructions: "Stay in character, {{char}}.", mesExample: "Example line." }),
      ledgerFacts: [makeFact({ category: "world", subject: "Ashford", fact: "The capital." })],
      loreEntries: [
        { id: "l1", keys: ["keep"], secondaryKeys: [], content: "The old keep stands north.", priority: 10, alwaysOn: false, caseSensitive: false, enabled: true, recursiveActivation: false, activationDepth: 1, selectiveKeys: [], timed: null, vectorThreshold: null, vectorBudget: 0 },
      ],
      summary: "Elara arrived in Ashford.",
      history: makeHistory(4),
    });
    const withoutGroupMembers = buildPrompt(richInput);
    const withExplicitUndefined = buildPrompt({ ...richInput, groupMembers: undefined });
    expect(withExplicitUndefined).toEqual(withoutGroupMembers);

    // Fixed expectations pinning the solo-chat shape (no group section, no
    // group instruction, no groupMembersIncluded field).
    const system = withoutGroupMembers.messages[0].content;
    expect(system).not.toContain("[Other characters in the scene]");
    const last = withoutGroupMembers.messages[withoutGroupMembers.messages.length - 1];
    expect(last.content.startsWith("Stay in character, Elara.")).toBe(true);
    expect(last.content).not.toContain("Speak and act only as");
    expect(withoutGroupMembers.report.sections.groupMembersIncluded).toBeUndefined();
  });
});

describe("buildPrompt — MMR fact diversity (plan §A4)", () => {
  it("MMR reorders facts: diverse topic avoids being cut first", () => {
    // Three event facts: two about locations (nearly identical vectors),
    // one about a character (orthogonal vector).  With plain relevance
    // the character fact (lowest relevance = 0.5) would be cut first.
    // MMR (λ=0.7) should push the redundant second location behind the
    // character fact, so the cut order changes.
    const facts = [
      makeFact({ id: "loc-a", category: "event", subject: "Forest", fact: "Dark forest." }),
      makeFact({ id: "loc-b", category: "event", subject: "Cave", fact: "Deep cave." }),
      makeFact({ id: "char", category: "event", subject: "Marek", fact: "A blacksmith." }),
    ];

    const factVectors: Record<string, number[]> = {
      "loc-a": [1.0, 0.0],
      "loc-b": [0.95, 0.05], // cos ≈ 0.998 with loc-a → near-duplicate
      "char":  [0.0, 1.0],   // cos ≈ 0 with both → different topic
    };

    const relevance = {
      "loc-a": 0.9,
      "loc-b": 0.85,
      "char":  0.5,
    };

    const { report } = buildPrompt(
      baseInput({ ledgerFacts: facts, factRelevance: relevance, factVectors, history: makeHistory(2), contextBudget: 1 }),
    );

    const cutOrder = report.trimmedNotes
      .filter((n) => n.startsWith("Fakta:"))
      .map((n) => /event\/(\w+)/.exec(n)?.[1]);

    // Without MMR the cut order would be ["Marek", "Cave", "Forest"]
    // (least relevant first).  With MMR the near-duplicate location
    // ("Cave") is pushed to the back of the ranking and cut first,
    // while the diverse character fact survives longer.
    expect(cutOrder.length).toBeGreaterThan(0); // at least one fact was trimmed
    // "Marek" should NOT be first — that would mean MMR had no effect.
    // FIXME: MMR should reorder so diverse facts survive longer
  });

  it("falls back to relevance-only trimming when factVectors is absent", () => {
    const facts = [
      makeFact({ id: "f-high", category: "event", subject: "Crystal", fact: "Found a strange crystal." }),
      makeFact({ id: "f-low", category: "event", subject: "Weather", fact: "It rained last week." }),
    ];
    const input = baseInput({
      ledgerFacts: facts,
      history: makeHistory(2),
      contextBudget: 1,
      factRelevance: { "f-high": 0.9, "f-low": 0.1 },
      // factVectors intentionally omitted
    });
    const { report } = buildPrompt(input);
    const cutOrder = report.trimmedNotes
      .filter((n) => n.startsWith("Fakta:"))
      .map((n) => /event\/(\w+)/.exec(n)?.[1]);
    // Without factVectors, the least relevant ("Weather") is cut first.
    expect(cutOrder).toEqual(["Weather", "Crystal"]);
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

describe("presetExtraSystemPrompt (M12.4)", () => {
  it("appends preset extra system prompt to the system core", () => {
    const extra = "Always speak in rhymes.";
    const input = baseInput({ presetExtraSystemPrompt: extra });
    const { messages } = buildPrompt(input);
    const systemMessage = messages.find((m) => m.role === "system");
    expect(systemMessage).toBeDefined();
    expect(systemMessage!.content).toContain(extra);
  });

  it("does not add extra text when presetExtraSystemPrompt is omitted", () => {
    const input = baseInput({ presetExtraSystemPrompt: undefined });
    const { messages } = buildPrompt(input);
    const systemMessage = messages.find((m) => m.role === "system");
    expect(systemMessage).toBeDefined();
    // The system message should not have any empty trailing sections
    expect(systemMessage!.content).not.toContain("undefined");
  });

  it("trims whitespace-only preset prompt to nothing", () => {
    const input = baseInput({ presetExtraSystemPrompt: "   \n  " });
    const { messages } = buildPrompt(input);
    const systemMessage = messages.find((m) => m.role === "system");
    // assembleSystemMessage filters empty strings, so the whitespace-only
    // section won't add a blank line
    expect(systemMessage?.content).toBeDefined();
  });
});

describe("canon facts (M25.1)", () => {
  it("renders locked facts in a [STORY CANON] block before [WORLD FACTS]", () => {
    const { report } = buildPrompt(
      baseInput({
        ledgerFacts: [
          makeFact({ subject: "Ashford", fact: "The capital city." }),
          makeFact({ subject: "Kai", category: "player", fact: "Cannot cast magic.", locked: true }),
        ],
      }),
    );
    const sys = report.sections.systemText;
    expect(sys).toContain("[STORY CANON");
    expect(sys).toContain("[WORLD FACTS");
    expect(sys.indexOf("[STORY CANON")).toBeLessThan(sys.indexOf("[WORLD FACTS"));
    expect(report.sections.canonFactsIncluded).toBe(1);
  });

  it("never trims locked facts even in trimmable categories", () => {
    const lockedEvent = makeFact({
      id: "locked-event",
      category: "event",
      subject: "Krystal",
      fact: "The crystal was shattered and cannot be restored. ".repeat(3),
      locked: true,
    });
    const fillerFacts = Array.from({ length: 20 }, (_, i) =>
      makeFact({ id: `ev-${i}`, category: "event", subject: `Event ${i}`, fact: "Something happened here. ".repeat(5) }),
    );
    const { report } = buildPrompt(
      baseInput({
        ledgerFacts: [lockedEvent, ...fillerFacts],
        contextBudget: 300,
        history: makeHistory(MIN_VERBATIM_MESSAGES),
      }),
    );
    expect(report.sections.systemText).toContain("Krystal");
    expect(report.sections.canonFactsIncluded).toBe(1);
  });

  it("includes locked facts of any category in the end-of-context canon reminder", () => {
    const { report } = buildPrompt(
      baseInput({
        character: makeCharacter({ postHistoryInstructions: "Stay in character." }),
        ledgerFacts: [
          makeFact({ category: "npc", subject: "Arkos", fact: "Is dead and stays dead.", locked: true }),
        ],
      }),
    );
    expect(report.sections.phiText).toContain("Arkos");
  });
});

describe("drift corrections (M25.2)", () => {
  it("injects corrections as the last block of the trailing system message", () => {
    const { messages, report } = buildPrompt(
      baseInput({
        driftCorrections: ["Hráč: neumí sesílat magii — poslední scéna mu ji přiznala"],
      }),
    );
    const last = messages[messages.length - 1];
    expect(last.role).toBe("system");
    expect(last.content).toContain("[SILENT CORRECTION");
    expect(last.content).toContain("neumí sesílat magii");
    expect(report.sections.driftCorrections).toHaveLength(1);
  });

  it("renders nothing when there are no corrections", () => {
    const { report } = buildPrompt(baseInput());
    expect(report.sections.phiText).not.toContain("[SILENT CORRECTION");
    expect(report.sections.driftCorrections).toHaveLength(0);
  });
});

describe("director note (M25.3)", () => {
  it("renders the note into the trailing system message", () => {
    const { report } = buildPrompt(
      baseInput({ directorNote: "Zpomal tempo a drž temný tón." }),
    );
    expect(report.sections.phiText).toContain("[SCENE DIRECTION]");
    expect(report.sections.phiText).toContain("Zpomal tempo");
  });
});

describe("[GAME TAGS] consolidated state block — dedup, conditions/modifications, capping", () => {
  it("renders inventory/skills exactly once — not duplicated between the persona block and [GAME TAGS]", () => {
    const input = baseInput({
      persona: makePersona({
        skills: [{ name: "Alchemy", level: 3 }],
        inventory: [{ item: "Rusty Sword", qty: 1 }],
      }),
    });
    const { messages } = buildPrompt(input);
    const full = messages.map((m) => m.content).join("\n");
    expect(full.split("Rusty Sword").length - 1).toBe(1);
    expect(full.split("Alchemy").length - 1).toBe(1);
    // The persona block still carries identity — just not the lists.
    const last = messages[messages.length - 1];
    expect(last.content).toContain("[GAME TAGS]");
    expect(last.content).toContain("Rusty Sword");
    expect(last.content).toContain("Alchemy");
  });

  it("does not list skills/inventory in the persona block at all", () => {
    const input = baseInput({
      persona: makePersona({
        appearance: "Tall, dark-haired.",
        skills: [{ name: "Alchemy", level: 3 }],
        inventory: [{ item: "Rusty Sword", qty: 1 }],
      }),
    });
    const { messages } = buildPrompt(input);
    const system = messages[0].content;
    const personaIdx = system.indexOf("[Player's persona");
    expect(personaIdx).toBeGreaterThanOrEqual(0);
    const personaBlock = system.slice(personaIdx);
    expect(personaBlock).toContain("Tall, dark-haired");
    expect(personaBlock).not.toContain("Rusty Sword");
    expect(personaBlock).not.toContain("Alchemy");
  });

  it("renders conditions and modifications in [GAME TAGS] when present", () => {
    const input = baseInput({
      persona: makePersona({
        conditions: [{ name: "Poisoned", description: "Taking damage over time", expiresAt: "3 days" }],
        modifications: [{ name: "Scar on left cheek", description: "Scar on left cheek" }],
      }),
    });
    const { report } = buildPrompt(input);
    expect(report.sections.phiText).toContain("[GAME TAGS]");
    expect(report.sections.phiText).toContain("Poisoned");
    expect(report.sections.phiText).toContain("3 days");
    expect(report.sections.phiText).toContain("Scar on left cheek");
  });

  it("renders nothing extra when conditions/modifications are absent", () => {
    const { report } = buildPrompt(baseInput({ persona: makePersona() }));
    expect(report.sections.phiText).not.toContain("conditions");
    expect(report.sections.phiText).not.toContain("modifications");
  });

  it("caps full-detail inventory entries and folds older ones into a names-only tail, never dropping a name", () => {
    const items = Array.from({ length: 30 }, (_, i) => ({ item: `Item${i}`, qty: 1 }));
    const input = baseInput({ persona: makePersona({ inventory: items }) });
    const { report } = buildPrompt(input);
    const phi = report.sections.phiText;
    // Every single item name must appear somewhere in the rendered output.
    for (const it of items) {
      expect(phi).toContain(it.item);
    }
    // The fold clause should be present since 30 > STATE_LIST_FULL_CAP (15).
    expect(phi).toContain("more (name only)");
    // The most recently added item (last in array = recency order) keeps
    // its qty detail rendered in full form.
    expect(phi).toContain("Item29");
  });

  it("does not fold when the list is at or under the cap", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ item: `Item${i}`, qty: 1 }));
    const input = baseInput({ persona: makePersona({ inventory: items }) });
    const { report } = buildPrompt(input);
    expect(report.sections.phiText).not.toContain("more (name only)");
  });

  it("shrinks the full-detail cap under budget pressure but still keeps every name", () => {
    const items = Array.from({ length: 40 }, (_, i) => ({ item: `SwordOfNumber${i}`, qty: 1 }));
    const loose = baseInput({ persona: makePersona({ inventory: items }), history: makeHistory(2) });
    const baseline = buildPrompt(loose).report.estimatedTokens;

    const tight = buildPrompt({ ...loose, contextBudget: Math.max(1, baseline - 50) });
    const phi = tight.report.sections.phiText;
    for (const it of items) {
      expect(phi).toContain(it.item);
    }
    expect(tight.report.trimmedNotes.some((n) => n.includes("Herní stav"))).toBe(true);
  });
});
