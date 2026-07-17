import { describe, expect, it } from "vitest";

import { extractDiceExpression, isDiceCommand } from "./diceCommand";

describe("isDiceCommand", () => {
  it("returns true for /r with a space", () => {
    expect(isDiceCommand("/r 2d6+3")).toBe(true);
  });

  it("returns true for /R (case-insensitive)", () => {
    expect(isDiceCommand("/R 1d20")).toBe(true);
  });

  it("returns false for plain text", () => {
    expect(isDiceCommand("Hello world")).toBe(false);
  });

  it("returns false for /r without a space", () => {
    expect(isDiceCommand("/r2d6")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isDiceCommand("")).toBe(false);
  });

  it("returns false for similar but different commands", () => {
    expect(isDiceCommand("/roll 2d6")).toBe(false);
    expect(isDiceCommand(" /r 2d6")).toBe(false); // leading space
  });
});

describe("extractDiceExpression", () => {
  it("extracts expression after /r ", () => {
    expect(extractDiceExpression("/r 2d6+3")).toBe("2d6+3");
  });

  it("extracts with extra whitespace", () => {
    expect(extractDiceExpression("/r   1d20")).toBe("1d20");
  });

  it("extracts complex expression", () => {
    expect(extractDiceExpression("/r 2d6+1d8+5")).toBe("2d6+1d8+5");
  });

  it("extracts with adv suffix", () => {
    expect(extractDiceExpression("/r 1d20 adv")).toBe("1d20 adv");
  });

  it("returns empty string for just /r", () => {
    expect(extractDiceExpression("/r ")).toBe("");
  });

  it("is case-insensitive", () => {
    expect(extractDiceExpression("/R 3d6")).toBe("3d6");
  });

  it("returns empty string for non-dice text", () => {
    expect(extractDiceExpression("hello")).toBe("");
  });
});
