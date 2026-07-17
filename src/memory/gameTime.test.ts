import { describe, expect, it } from "vitest";

import {
  advanceTime,
  defaultGameTimeState,
  nextWeather,
  seasonFromMonth,
  timeDescription,
  timeOfDay,
  type GameTimeState,
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

// ---- advanceTime --------------------------------------------------------

describe("advanceTime", () => {
  it("advances timestamp by messageCount * time_scale minutes", () => {
    const state = defaultGameTimeState();
    const result = advanceTime(state, 5);
    // 5 messages × scale 1 = 5 minutes = 300_000 ms
    expect(result.timestamp_ingame).toBe(state.timestamp_ingame + 5 * 60_000);
  });

  it("respects time_scale", () => {
    const state = { ...defaultGameTimeState(), time_scale: 3 };
    const result = advanceTime(state, 2);
    // 2 messages × scale 3 = 6 minutes = 360_000 ms
    expect(result.timestamp_ingame).toBe(state.timestamp_ingame + 6 * 60_000);
  });

  it("updates season and time_of_day as time advances", () => {
    // Start at Jan 1 noon (month 1, hour 12) → zima, poledne
    const state = defaultGameTimeState();
    // Advance by ~90 days worth of minutes (129600 minutes) to cross into April
    const result = advanceTime(state, 129600);
    expect(result.season).toBe("jaro");
    // After 90 days from noon, hour should still be around noon
    // (129600 * 60_000 ms / 3600000 ms_per_hour = 2160 hours = 90 days)
    expect(result.time_of_day).toBe("poledne");
  });

  it("never throws", () => {
    const state = defaultGameTimeState();
    expect(() => advanceTime(state, 0)).not.toThrow();
    expect(() => advanceTime(state, -5)).not.toThrow();
    expect(() => advanceTime(state, 1_000_000)).not.toThrow();
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

// ---- timeDescription ----------------------------------------------------

describe("timeDescription", () => {
  it("returns a non-empty Czech string", () => {
    const state = defaultGameTimeState();
    const desc = timeDescription(state);
    expect(desc.length).toBeGreaterThan(0);
    expect(desc).toContain("Je ");
  });

  it("contains time-of-day, season, and weather references", () => {
    // Morning in spring with clear skies
    const state: GameTimeState = {
      timestamp_ingame: new Date(Date.UTC(2024, 3, 1, 6, 0, 0)).getTime(),
      time_scale: 1,
      weather: "jasno",
      season: "jaro",
      time_of_day: "ráno",
    };
    const desc = timeDescription(state);
    expect(desc).toContain("časné ráno");
    expect(desc).toContain("jaro");
    // should mention clear sky
    expect(desc.toLowerCase()).toContain("obloha");
  });

  it("produces distinctive descriptions for different times", () => {
    const dayState: GameTimeState = {
      timestamp_ingame: 0, time_scale: 1,
      weather: "jasno", season: "léto", time_of_day: "poledne",
    };
    const nightState: GameTimeState = {
      timestamp_ingame: 0, time_scale: 1,
      weather: "jasno", season: "léto", time_of_day: "noc",
    };

    const dayDesc = timeDescription(dayState);
    const nightDesc = timeDescription(nightState);

    // Night description should differ from day
    expect(dayDesc).not.toBe(nightDesc);
    expect(nightDesc).toContain("hluboká noc");
  });
});

// ---- defaultGameTimeState -----------------------------------------------

describe("defaultGameTimeState", () => {
  it("returns a valid state with winter noon", () => {
    const state = defaultGameTimeState();
    expect(state.season).toBe("zima");
    expect(state.time_of_day).toBe("poledne");
    expect(state.weather).toBe("zataženo");
    expect(state.time_scale).toBe(1);
    expect(state.timestamp_ingame).toBeGreaterThan(0);
  });
});
