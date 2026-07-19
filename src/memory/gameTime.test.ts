import { describe, expect, it } from "vitest";

import {
  nextWeather,
  seasonFromMonth,
  timeOfDay,
  type Weather,
} from "./gameTime";

// ---- seasonFromMonth ----------------------------------------------------

describe("seasonFromMonth", () => {
  it("returns zima for Dec, Jan, Feb", () => {
    expect(seasonFromMonth(12)).toBe("zima");
    expect(seasonFromMonth(1)).toBe("zima");
    expect(seasonFromMonth(2)).toBe("zima");
  });

  it("returns jaro for Mar, Apr, May", () => {
    expect(seasonFromMonth(3)).toBe("jaro");
    expect(seasonFromMonth(4)).toBe("jaro");
    expect(seasonFromMonth(5)).toBe("jaro");
  });

  it("returns léto for Jun, Jul, Aug", () => {
    expect(seasonFromMonth(6)).toBe("léto");
    expect(seasonFromMonth(7)).toBe("léto");
    expect(seasonFromMonth(8)).toBe("léto");
  });

  it("returns podzim for Sep, Oct, Nov", () => {
    expect(seasonFromMonth(9)).toBe("podzim");
    expect(seasonFromMonth(10)).toBe("podzim");
    expect(seasonFromMonth(11)).toBe("podzim");
  });

  it("clamps out-of-range values", () => {
    expect(seasonFromMonth(0)).toBe("zima");
    expect(seasonFromMonth(13)).toBe("zima");
    expect(seasonFromMonth(-5)).toBe("zima");
  });
});

// ---- timeOfDay ----------------------------------------------------------

describe("timeOfDay", () => {
  it("returns ráno for 5–6", () => {
    expect(timeOfDay(5)).toBe("ráno");
    expect(timeOfDay(6)).toBe("ráno");
  });

  it("returns dopoledne for 7–10", () => {
    expect(timeOfDay(7)).toBe("dopoledne");
    expect(timeOfDay(10)).toBe("dopoledne");
  });

  it("returns poledne for 11–12", () => {
    expect(timeOfDay(11)).toBe("poledne");
    expect(timeOfDay(12)).toBe("poledne");
  });

  it("returns odpoledne for 13–16", () => {
    expect(timeOfDay(13)).toBe("odpoledne");
    expect(timeOfDay(16)).toBe("odpoledne");
  });

  it("returns podvečer for 17–18", () => {
    expect(timeOfDay(17)).toBe("podvečer");
    expect(timeOfDay(18)).toBe("podvečer");
  });

  it("returns večer for 19–21", () => {
    expect(timeOfDay(19)).toBe("večer");
    expect(timeOfDay(21)).toBe("večer");
  });

  it("returns noc for 0–4 and 22–23", () => {
    expect(timeOfDay(0)).toBe("noc");
    expect(timeOfDay(4)).toBe("noc");
    expect(timeOfDay(22)).toBe("noc");
    expect(timeOfDay(23)).toBe("noc");
  });

  it("clamps out-of-range values", () => {
    expect(timeOfDay(-1)).toBe("noc");
    expect(timeOfDay(24)).toBe("noc");
  });
});

// ---- nextWeather --------------------------------------------------------

describe("nextWeather", () => {
  it("returns a valid weather for every current+season combination", () => {
    const weathers: Weather[] = [
      "jasno", "polojasno", "zataženo", "déšť", "bouřka", "sníh", "mlha",
    ];
    const seasons = ["zima", "jaro", "léto", "podzim"] as const;

    for (const current of weathers) {
      for (const season of seasons) {
        const next = nextWeather(current, season);
        expect(weathers).toContain(next);
      }
    }
  });

  it("never returns sníh in léto (snow in summer)", () => {
    // Run many trials — snow should never appear in summer regardless
    // of starting state, because the transition matrix degrades it.
    for (let i = 0; i < 200; i++) {
      const result = nextWeather("sníh", "léto");
      expect(result).not.toBe("sníh");
    }
  });

  it("bouřka is more likely in léto than in zima", () => {
    let summerStorms = 0;
    let winterStorms = 0;
    const trials = 500;

    for (let i = 0; i < trials; i++) {
      if (nextWeather("zataženo", "léto") === "bouřka") summerStorms++;
      if (nextWeather("zataženo", "zima") === "bouřka") winterStorms++;
    }

    // Summer should produce more storms from "zataženo"
    expect(summerStorms).toBeGreaterThan(winterStorms);
  });
});
