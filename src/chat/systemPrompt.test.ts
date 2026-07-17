import { describe, expect, it } from "vitest";

import type { LoreEntryLike } from "../lorebooks/activation";
import {
  buildCharacterSystemPrompt,
  buildLoreSection,
  personaDisplayName,
  resolveGreeting,
  substitutePlaceholders,
} from "./systemPrompt";
import type { Character } from "../db/repositories/charactersRepo";
import type { Persona } from "../db/repositories/personasRepo";

function makeCharacter(partial: Partial<Character> = {}): Character {
  return {
    id: "c1",
    name: "Elara",
    description: "A wandering mage.",
    personality: "Curious and blunt.",
    scenario: "A tavern at dusk.",
    firstMes: "Hello, {{user}}, I am {{char}}.",
    mesExample: "",
    alternateGreetings: [],
    systemPrompt: "",
    postHistoryInstructions: "",
    creatorNotes: "",
    tags: [],
    avatarPath: null,
    cardJson: null,
    specVersion: "v2",
    createdAt: "",
    updatedAt: "",
    ...partial,
  };
}

function makePersona(partial: Partial<Persona> = {}): Persona {
  return {
    id: "p1",
    name: "Kai",
    description: "",
    gender: "",
    age: null,
    race: "",
    appearance: "",
    progression: "skill",
    skills: [],
    inventory: [],
    avatarPath: null,
    isDefault: false,
    createdAt: "",
    updatedAt: "",
    ...partial,
  };
}

describe("substitutePlaceholders", () => {
  it("replaces {{char}} and {{user}} case-insensitively, everywhere they occur", () => {
    const text = "{{Char}} greets {{user}}. Then {{CHAR}} and {{User}} talk.";
    expect(substitutePlaceholders(text, "Elara", "Kai")).toBe(
      "Elara greets Kai. Then Elara and Kai talk.",
    );
  });
});

describe("personaDisplayName", () => {
  it("falls back to 'User' when there's no persona", () => {
    expect(personaDisplayName(null)).toBe("User");
  });

  it("falls back to 'User' when the persona's name is blank", () => {
    expect(personaDisplayName(makePersona({ name: "   " }))).toBe("User");
  });

  it("uses the persona's trimmed name otherwise", () => {
    expect(personaDisplayName(makePersona({ name: " Kai " }))).toBe("Kai");
  });
});

describe("buildCharacterSystemPrompt", () => {
  it("substitutes {{char}}/{{user}} in the default RP instructions when the card has no system_prompt", () => {
    const prompt = buildCharacterSystemPrompt(makeCharacter(), makePersona({ name: "Kai" }));
    expect(prompt).toContain("Elara");
    expect(prompt).toContain("Kai");
    expect(prompt).not.toContain("{{char}}");
    expect(prompt).not.toContain("{{user}}");
  });

  it("includes the persona's structured fields as a labeled block", () => {
    const prompt = buildCharacterSystemPrompt(
      makeCharacter(),
      makePersona({ name: "Kai", gender: "female", appearance: "{{char}}'s old friend, a retired sellsword." }),
    );
    expect(prompt).toContain("Elara's old friend, a retired sellsword.");
  });

  it("omits the persona block entirely when there's no persona", () => {
    const prompt = buildCharacterSystemPrompt(makeCharacter(), null);
    expect(prompt).toContain("User");
  });
});

describe("buildLoreSection", () => {
  const character = makeCharacter();

  it("returns an empty string when nothing activated", () => {
    expect(buildLoreSection([], character, null)).toBe("");
  });

  it("substitutes placeholders in each entry's content", () => {
    const entries: LoreEntryLike[] = [
      {
        id: "1",
        keys: ["keep"],
        secondaryKeys: [],
        content: "{{char}} once defended this keep for {{user}}.",
        priority: 100,
        alwaysOn: false,
        caseSensitive: false,
        enabled: true,
      },
    ];
    const section = buildLoreSection(entries, character, makePersona({ name: "Kai" }));
    expect(section).toContain("Elara once defended this keep for Kai.");
  });
});

describe("resolveGreeting", () => {
  it("substitutes both placeholders in the chosen greeting", () => {
    const greeting = resolveGreeting(makeCharacter(), null, makePersona({ name: "Kai" }));
    expect(greeting).toBe("Hello, Kai, I am Elara.");
  });

  it("falls back to the default user name when there's no persona", () => {
    const greeting = resolveGreeting(makeCharacter(), null, null);
    expect(greeting).toBe("Hello, User, I am Elara.");
  });
});
