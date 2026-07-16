import { describe, expect, it } from "vitest";

import { extractInlineSuggestions } from "./inlineSuggestions";

describe("extractInlineSuggestions", () => {
  it("extracts a trailing numbered block after a question", () => {
    const reply =
      "Krystal se rozzáří.\n\nCo uděláš?\n1. Prozkoumám krystal.\n2. Schovám ho do brašny.\n3. Zeptám se Arkose.";
    expect(extractInlineSuggestions(reply)).toEqual([
      "Prozkoumám krystal.",
      "Schovám ho do brašny.",
      "Zeptám se Arkose.",
    ]);
  });

  it("supports bullets, letters and bold markers", () => {
    const reply = "…\n- Uteču.\n- Budu bojovat.";
    expect(extractInlineSuggestions(reply)).toEqual(["Uteču.", "Budu bojovat."]);
    const lettered = "…\na) Vlevo.\nb) Vpravo.\nc) Zpět.";
    expect(extractInlineSuggestions(lettered)).toHaveLength(3);
    const bold = "…\n**1.** Otevřu dveře.\n**2.** Zaklepu.";
    expect(extractInlineSuggestions(bold)).toEqual(["Otevřu dveře.", "Zaklepu."]);
  });

  it("ignores blank lines between options", () => {
    const reply = "Scéna.\n\n1. První.\n\n2. Druhá.\n";
    expect(extractInlineSuggestions(reply)).toEqual(["První.", "Druhá."]);
  });

  it("returns [] when the reply doesn't end with options", () => {
    expect(extractInlineSuggestions("Prostě vyprávění bez voleb.")).toEqual([]);
    expect(extractInlineSuggestions("1. Jen jedna volba na konci.")).toEqual([]);
    const listMidReply = "1. bod\n2. bod\nA pak se stalo tohle.";
    expect(extractInlineSuggestions(listMidReply)).toEqual([]);
  });

  it("returns [] for more than 4 trailing options (likely a list, not choices)", () => {
    const reply = "…\n1. a\n2. b\n3. c\n4. d\n5. e";
    expect(extractInlineSuggestions(reply)).toEqual([]);
  });
});
