import { describe, expect, it } from "vitest";
import { parseDurationMinutes } from "./duration";

describe("parseDurationMinutes", () => {
  it("parses hours", () => {
    expect(parseDurationMinutes("6 hodin")).toBe(360);
    expect(parseDurationMinutes("1 hodina")).toBe(60);
  });

  it("parses days", () => {
    expect(parseDurationMinutes("2 dny")).toBe(2880);
    expect(parseDurationMinutes("3 dní")).toBe(4320);
  });

  it("parses the bare 'Nd' shorthand as N days", () => {
    expect(parseDurationMinutes("1d")).toBe(1440);
  });

  it("parses minutes", () => {
    expect(parseDurationMinutes("45 minut")).toBe(45);
  });

  it("parses weeks", () => {
    expect(parseDurationMinutes("1 týden")).toBe(10080);
  });

  it("returns null for a bare number with no unit", () => {
    expect(parseDurationMinutes("1")).toBeNull();
  });

  it("returns null for non-duration text", () => {
    expect(parseDurationMinutes("until treated")).toBeNull();
    expect(parseDurationMinutes("")).toBeNull();
  });
});
