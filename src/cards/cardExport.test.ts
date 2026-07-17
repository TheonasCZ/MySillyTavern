import { describe, expect, it } from "vitest";

import { mergeCharacterIntoCardJson } from "./cardExport";
import { extractMstExtensions } from "./cardImport";
import {
  buildCardV2Json,
  blankNormalizedCard,
  parseCardJson,
  type MySillyTavernExtensions,
  type NormalizedCard,
} from "./cardTypes";

function makeCharacter(overrides: Partial<{
  name: string;
  ttsVoice: string | null;
  cardJson: string | null;
  description: string;
  personality: string;
}> = {}): Parameters<typeof mergeCharacterIntoCardJson>[0] {
  return {
    id: "test-char-1",
    name: overrides.name ?? "Testovací postava",
    description: overrides.description ?? "",
    personality: overrides.personality ?? "",
    scenario: "",
    firstMes: "",
    mesExample: "",
    alternateGreetings: [],
    systemPrompt: "",
    postHistoryInstructions: "",
    creatorNotes: "",
    tags: [],
    avatarPath: null,
    cardJson: overrides.cardJson ?? null,
    specVersion: "v2",
    ttsVoice: overrides.ttsVoice ?? null,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
  };
}

describe("buildCardV2Json extensions", () => {
  it("omits extensions when none are provided", () => {
    const card: NormalizedCard = blankNormalizedCard("Test");
    const json = buildCardV2Json(card);
    expect(json.data.extensions).toBeUndefined();
  });

  it("populates extensions.mysillytavern when provided", () => {
    const card: NormalizedCard = blankNormalizedCard("Test");
    const ext: MySillyTavernExtensions = {
      ttsVoice: "edge-tts://cs-CZ-AntoninNeural",
      recommendedPreset: "preset-abc",
      directorDefaults: { pace: "fast", tone: "dark", focus: "exploration" },
    };
    const json = buildCardV2Json(card, ext);
    expect(json.data.extensions?.mysillytavern).toEqual(ext);
  });

  it("populates only provided extension fields", () => {
    const card: NormalizedCard = blankNormalizedCard("Test");
    const ext: MySillyTavernExtensions = { ttsVoice: "test-voice" };
    const json = buildCardV2Json(card, ext);
    const mst = json.data.extensions?.mysillytavern as Record<string, unknown>;
    expect(mst.ttsVoice).toBe("test-voice");
    expect(mst.recommendedPreset).toBeUndefined();
    expect(mst.directorDefaults).toBeUndefined();
  });
});

describe("mergeCharacterIntoCardJson extensions", () => {
  it("includes ttsVoice in extensions.mysillytavern when set", () => {
    const char = makeCharacter({ ttsVoice: "edge-tts://cs-CZ-VlastaNeural" });
    const card = mergeCharacterIntoCardJson(char);
    const mst = card.data.extensions?.mysillytavern as Record<string, unknown> | undefined;
    expect(mst?.ttsVoice).toBe("edge-tts://cs-CZ-VlastaNeural");
  });

  it("omits extensions entirely when ttsVoice is null", () => {
    const char = makeCharacter({ ttsVoice: null });
    const card = mergeCharacterIntoCardJson(char);
    // buildMstExtensions returns undefined when no fields are set,
    // so no extensions block is written at all.
    expect(card.data.extensions).toBeUndefined();
  });

  it("preserves other extension namespaces when merging with original cardJson", () => {
    const originalCardJson = JSON.stringify({
      spec: "chara_card_v2",
      spec_version: "2.0",
      data: {
        name: "Původní",
        description: "Původní popis",
        extensions: {
          third_party: { someField: "keep-me" },
          another: { value: 42 },
        },
      },
    });
    const char = makeCharacter({
      name: "Aktualizovaná",
      description: "Nový popis",
      ttsVoice: "my-voice",
      cardJson: originalCardJson,
    });
    const card = mergeCharacterIntoCardJson(char);
    const ext = card.data.extensions as Record<string, unknown>;
    expect(ext.third_party).toEqual({ someField: "keep-me" });
    expect(ext.another).toEqual({ value: 42 });
    expect(ext.mysillytavern).toBeDefined();
    expect((ext.mysillytavern as Record<string, unknown>).ttsVoice).toBe("my-voice");
  });

  it("overwrites stale mysillytavern with current character state", () => {
    const originalCardJson = JSON.stringify({
      spec: "chara_card_v2",
      spec_version: "2.0",
      data: {
        name: "Původní",
        extensions: {
          mysillytavern: { ttsVoice: "old-voice" },
        },
      },
    });
    const char = makeCharacter({
      ttsVoice: "new-voice",
      cardJson: originalCardJson,
    });
    const card = mergeCharacterIntoCardJson(char);
    const mst = card.data.extensions?.mysillytavern as Record<string, unknown>;
    expect(mst.ttsVoice).toBe("new-voice");
  });
});

describe("extractMstExtensions", () => {
  it("returns empty object for missing extensions", () => {
    expect(extractMstExtensions({ data: { name: "Test" } })).toEqual({});
  });

  it("returns empty object for card without data", () => {
    expect(extractMstExtensions({})).toEqual({});
  });

  it("returns empty object for null/undefined card", () => {
    expect(extractMstExtensions(null)).toEqual({});
    expect(extractMstExtensions(undefined)).toEqual({});
  });

  it("extracts ttsVoice from extensions.mysillytavern", () => {
    const card = {
      spec: "chara_card_v2",
      spec_version: "2.0",
      data: {
        name: "Test",
        extensions: {
          mysillytavern: { ttsVoice: "edge-tts://test" },
        },
      },
    };
    expect(extractMstExtensions(card)).toEqual({ ttsVoice: "edge-tts://test" });
  });

  it("extracts all known fields", () => {
    const card = {
      spec: "chara_card_v2",
      spec_version: "2.0",
      data: {
        name: "Test",
        extensions: {
          mysillytavern: {
            ttsVoice: "voice-1",
            recommendedPreset: "preset-1",
            directorDefaults: { pace: "slow", tone: "light", focus: "combat" },
          },
        },
      },
    };
    expect(extractMstExtensions(card)).toEqual({
      ttsVoice: "voice-1",
      recommendedPreset: "preset-1",
      directorDefaults: { pace: "slow", tone: "light", focus: "combat" },
    });
  });

  it("ignores unknown fields in mysillytavern", () => {
    const card = {
      data: {
        extensions: {
          mysillytavern: {
            ttsVoice: "voice-1",
            unknownField: "should-be-ignored",
            nestedUnknown: { a: 1 },
          },
        },
      },
    };
    const ext = extractMstExtensions(card);
    expect(ext).toEqual({ ttsVoice: "voice-1" });
    expect((ext as Record<string, unknown>).unknownField).toBeUndefined();
  });

  it("filters out non-string values for typed fields", () => {
    const card = {
      data: {
        extensions: {
          mysillytavern: {
            ttsVoice: 123,
            recommendedPreset: true,
          },
        },
      },
    };
    expect(extractMstExtensions(card)).toEqual({});
  });
});

describe("roundtrip: build → parse → extract", () => {
  it("preserves all extension fields through a full roundtrip", () => {
    const card: NormalizedCard = blankNormalizedCard("Test");
    const originalExt: MySillyTavernExtensions = {
      ttsVoice: "edge-tts://cs-CZ-AntoninNeural",
      recommendedPreset: "preset-abc",
      directorDefaults: { pace: "fast", tone: "dark", focus: "exploration" },
    };

    // 1. Build card JSON with extensions
    const v2Card = buildCardV2Json(card, originalExt);
    const json = JSON.stringify(v2Card);

    // 2. Parse back (simulates reading from a PNG chunk)
    const parsed = parseCardJson(json);

    // 3. Verify ST-compatible fields survived
    expect(parsed.data.name).toBe("Test");

    // 4. Extract extensions
    const extracted = extractMstExtensions(parsed);
    expect(extracted).toEqual(originalExt);
  });

  it("roundtrips with mergeCharacterIntoCardJson", () => {
    const char = makeCharacter({
      name: "Kolemjdoucí",
      ttsVoice: "edge-tts://cs-CZ-VlastaNeural",
      description: "Popis",
      personality: "Osobnost",
    });

    // Export
    const exported = mergeCharacterIntoCardJson(char);
    const json = JSON.stringify(exported);

    // Import path: parse → extract
    const parsed = parseCardJson(json);
    const mstExt = extractMstExtensions(parsed);

    expect(parsed.data.name).toBe("Kolemjdoucí");
    expect(parsed.data.description).toBe("Popis");
    expect(parsed.data.personality).toBe("Osobnost");
    expect(mstExt.ttsVoice).toBe("edge-tts://cs-CZ-VlastaNeural");
  });

  it("ST compatibility: card without mysillytavern imports cleanly", () => {
    // Simulates importing a card from vanilla ST (no MST extensions)
    const stCard = {
      spec: "chara_card_v2",
      spec_version: "2.0",
      data: {
        name: "ST Character",
        description: "A vanilla ST card",
        personality: "",
        scenario: "",
        first_mes: "Hello!",
        mes_example: "",
        creator_notes: "",
        system_prompt: "",
        post_history_instructions: "",
        tags: ["fantasy"],
      },
    };

    const parsed = parseCardJson(JSON.stringify(stCard));
    expect(parsed.data.name).toBe("ST Character");
    expect(parsed.data.first_mes).toBe("Hello!");

    const mstExt = extractMstExtensions(parsed);
    expect(mstExt).toEqual({});
  });

  it("ST compatibility: card with third-party extensions but no MST is fine", () => {
    const stCard = {
      spec: "chara_card_v2",
      spec_version: "2.0",
      data: {
        name: "Third Party",
        description: "Has extensions but not ours",
        extensions: {
          third_party: { mood: "happy" },
          some_other: { version: 2 },
        },
      },
    };

    const parsed = parseCardJson(JSON.stringify(stCard));
    const mstExt = extractMstExtensions(parsed);
    expect(mstExt).toEqual({});

    // And our export of an import from such a card preserves third-party ext
    const char = makeCharacter({
      name: "Updated Third Party",
      ttsVoice: "voice-x",
      cardJson: JSON.stringify(stCard),
    });
    const exported = mergeCharacterIntoCardJson(char);
    const ext = exported.data.extensions as Record<string, unknown>;
    expect(ext.third_party).toEqual({ mood: "happy" });
    expect(ext.some_other).toEqual({ version: 2 });
    expect(ext.mysillytavern).toBeDefined();
  });
});
