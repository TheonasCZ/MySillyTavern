import { describe, expect, it } from "vitest";

import {
  advanceDay,
  advanceHour,
  calendarDateFromDays,
  calendarDescription,
  calendarFromJSON,
  calendarToJSON,
  dayPeriod,
  defaultCalendarDate,
  formatCalendarDate,
  formatCalendarDateShort,
  getSeason,
  MONTHS,
  seasonIcon,
  SEASON_EFFECTS,
  timeIcon,
  weatherIcon,
} from "./calendar";

// ---- getSeason ------------------------------------------------------------

describe("getSeason", () => {
  it("returns Jaro for days 1–90", () => {
    expect(getSeason(1)).toBe("Jaro");
    expect(getSeason(45)).toBe("Jaro");
    expect(getSeason(90)).toBe("Jaro");
  });

  it("returns Léto for days 91–180", () => {
    expect(getSeason(91)).toBe("Léto");
    expect(getSeason(135)).toBe("Léto");
    expect(getSeason(180)).toBe("Léto");
  });

  it("returns Podzim for days 181–270", () => {
    expect(getSeason(181)).toBe("Podzim");
    expect(getSeason(225)).toBe("Podzim");
    expect(getSeason(270)).toBe("Podzim");
  });

  it("returns Zima for days 271–360", () => {
    expect(getSeason(271)).toBe("Zima");
    expect(getSeason(315)).toBe("Zima");
    expect(getSeason(360)).toBe("Zima");
  });

  it("clamps out-of-range values", () => {
    expect(getSeason(0)).toBe("Jaro");
    expect(getSeason(361)).toBe("Zima");
    expect(getSeason(-5)).toBe("Jaro");
    expect(getSeason(1000)).toBe("Zima");
  });
});

// ---- calendarDateFromDays -------------------------------------------------

describe("calendarDateFromDays", () => {
  it("builds correct date for day 1 (first day of year)", () => {
    const d = calendarDateFromDays(847, 1);
    expect(d.year).toBe(847);
    expect(d.dayOfYear).toBe(1);
    expect(d.day).toBe(1);
    expect(d.month).toBe("Měsíce probuzení");
    expect(d.season).toBe("Jaro");
  });

  it("builds correct date for a mid-month day", () => {
    const d = calendarDateFromDays(847, 45);
    expect(d.year).toBe(847);
    expect(d.dayOfYear).toBe(45);
    expect(d.day).toBe(15);
    expect(d.month).toBe("Jarního větru");
    expect(d.season).toBe("Jaro");
  });

  it("builds correct date for last day of a month", () => {
    // day 30 = last day of Měsíc probuzení
    const d = calendarDateFromDays(847, 30);
    expect(d.day).toBe(30);
    expect(d.month).toBe("Měsíce probuzení");
    // day 60 = last day of Jarní vítr
    const d2 = calendarDateFromDays(847, 60);
    expect(d2.day).toBe(30);
    expect(d2.month).toBe("Jarního větru");
  });

  it("builds correct date for first day of a later month", () => {
    const d = calendarDateFromDays(847, 91);
    expect(d.day).toBe(1);
    expect(d.month).toBe("Měsíce slunce");
    expect(d.season).toBe("Léto");
  });

  it("handles day 360 (last day of year)", () => {
    const d = calendarDateFromDays(847, 360);
    expect(d.year).toBe(847);
    expect(d.dayOfYear).toBe(360);
    expect(d.day).toBe(30);
    expect(d.month).toBe("Měsíce temnoty");
    expect(d.season).toBe("Zima");
  });

  it("clamps out-of-range dayOfYear", () => {
    const d0 = calendarDateFromDays(847, 0);
    expect(d0.dayOfYear).toBe(1);
    const dBig = calendarDateFromDays(847, 400);
    expect(dBig.dayOfYear).toBe(360);
  });
});

// ---- advanceDay -----------------------------------------------------------

describe("advanceDay", () => {
  it("advances by one day within the same month and year", () => {
    const d = calendarDateFromDays(847, 45);
    const next = advanceDay(d);
    expect(next.year).toBe(847);
    expect(next.dayOfYear).toBe(46);
    expect(next.day).toBe(16);
    expect(next.month).toBe("Jarního větru");
  });

  it("advances across month boundary", () => {
    const d = calendarDateFromDays(847, 90);
    expect(d.month).toBe("Měsíce květů");
    expect(d.day).toBe(30);
    const next = advanceDay(d);
    expect(next.year).toBe(847);
    expect(next.dayOfYear).toBe(91);
    expect(next.day).toBe(1);
    expect(next.month).toBe("Měsíce slunce");
    expect(next.season).toBe("Léto");
  });

  it("advances across year boundary", () => {
    const d = calendarDateFromDays(847, 360);
    const next = advanceDay(d);
    expect(next.year).toBe(848);
    expect(next.dayOfYear).toBe(1);
    expect(next.day).toBe(1);
    expect(next.month).toBe("Měsíce probuzení");
    expect(next.season).toBe("Jaro");
  });
});

// ---- formatCalendarDate / formatCalendarDateShort --------------------------

describe("formatCalendarDate", () => {
  it("formats a spring date correctly", () => {
    const d = calendarDateFromDays(847, 45);
    expect(formatCalendarDate(d)).toBe("15. Jarního větru, Rok 847");
  });

  it("formats a winter date correctly", () => {
    const d = calendarDateFromDays(847, 360);
    expect(formatCalendarDate(d)).toBe("30. Měsíce temnoty, Rok 847");
  });
});

describe("formatCalendarDateShort", () => {
  it("includes time icon, season icon, and date", () => {
    const d = calendarDateFromDays(847, 45, 6);
    const s = formatCalendarDateShort(d);
    expect(s).toContain("🕐");
    expect(s).toContain("6h");
    expect(s).toContain("15. Jarního větru, 847");
  });
});

// ---- calendarDescription ---------------------------------------------------

describe("calendarDescription", () => {
  it("includes date, season, effects, and tag instruction", () => {
    const d = calendarDateFromDays(847, 45);
    const desc = calendarDescription(d);
    expect(desc).toContain("[DNEŠNÍ DATUM]");
    expect(desc).toContain("15. Jarního větru, Rok 847");
    expect(desc).toContain("Jaro");
    expect(desc).toContain(SEASON_EFFECTS["Jaro"]);
    expect(desc).toContain("[TIME:+1d]");
    expect(desc).toContain("[TIME:+1h]");
  });

  it("uses correct effects for each season", () => {
    expect(calendarDescription(calendarDateFromDays(847, 1))).toContain(SEASON_EFFECTS["Jaro"]);
    expect(calendarDescription(calendarDateFromDays(847, 91))).toContain(SEASON_EFFECTS["Léto"]);
    expect(calendarDescription(calendarDateFromDays(847, 181))).toContain(SEASON_EFFECTS["Podzim"]);
    expect(calendarDescription(calendarDateFromDays(847, 271))).toContain(SEASON_EFFECTS["Zima"]);
  });
});

// ---- Serialization ---------------------------------------------------------

describe("calendarToJSON / calendarFromJSON", () => {
  it("round-trips through JSON", () => {
    const original = calendarDateFromDays(847, 200);
    const json = calendarToJSON(original);
    expect(json).toEqual({ year: 847, dayOfYear: 200, hourOfDay: 6 });
    const restored = calendarFromJSON(json);
    expect(restored.year).toBe(847);
    expect(restored.dayOfYear).toBe(200);
    expect(restored.day).toBe(original.day);
    expect(restored.month).toBe(original.month);
    expect(restored.season).toBe(original.season);
  });

  it("calendarFromJSON returns default on null/undefined", () => {
    const d = calendarFromJSON(null);
    expect(d.year).toBe(847);
    expect(d.dayOfYear).toBe(1);
  });

  it("calendarFromJSON returns default on malformed input", () => {
    const d = calendarFromJSON({ year: "bad" });
    expect(d.year).toBe(847);
    expect(d.dayOfYear).toBe(1);
  });

  it("calendarFromJSON returns default on empty object", () => {
    const d = calendarFromJSON({});
    expect(d.year).toBe(847);
    expect(d.dayOfYear).toBe(1);
  });
});

// ---- defaultCalendarDate ---------------------------------------------------

describe("defaultCalendarDate", () => {
  it("starts at day 1 of year 847", () => {
    const d = defaultCalendarDate();
    expect(d.year).toBe(847);
    expect(d.dayOfYear).toBe(1);
    expect(d.day).toBe(1);
    expect(d.month).toBe("Měsíce probuzení");
    expect(d.season).toBe("Jaro");
  });
});

// ---- MONTHS integrity ------------------------------------------------------

describe("MONTHS", () => {
  it("has 12 months covering all 360 days", () => {
    const totalDays = MONTHS.reduce((sum, m) => sum + m.days, 0);
    expect(totalDays).toBe(360);
    expect(MONTHS).toHaveLength(12);
  });

  it("each season has exactly 3 months", () => {
    const counts: Record<string, number> = {};
    for (const m of MONTHS) {
      counts[m.season] = (counts[m.season] ?? 0) + 1;
    }
    expect(counts["Jaro"]).toBe(3);
    expect(counts["Léto"]).toBe(3);
    expect(counts["Podzim"]).toBe(3);
    expect(counts["Zima"]).toBe(3);
  });
});

// ---- SEASON_EFFECTS --------------------------------------------------------

describe("SEASON_EFFECTS", () => {
  it("has entries for all four seasons", () => {
    expect(Object.keys(SEASON_EFFECTS).sort()).toEqual(["Jaro", "Léto", "Podzim", "Zima"]);
  });

  it("every effect is a non-empty Czech string", () => {
    for (const effect of Object.values(SEASON_EFFECTS)) {
      expect(effect.length).toBeGreaterThan(10);
    }
  });
});

// ---- hourOfDay in CalendarDate ----------------------------------------------

describe("hourOfDay", () => {
  it("defaultCalendarDate starts at hour 6 (dawn)", () => {
    const d = defaultCalendarDate();
    expect(d.hourOfDay).toBe(6);
  });

  it("calendarDateFromDays defaults to hour 6", () => {
    const d = calendarDateFromDays(847, 45);
    expect(d.hourOfDay).toBe(6);
  });

  it("calendarDateFromDays accepts explicit hour", () => {
    const d = calendarDateFromDays(847, 45, 14);
    expect(d.hourOfDay).toBe(14);
  });

  it("advanceDay preserves hourOfDay", () => {
    const d = calendarDateFromDays(847, 45, 14);
    const next = advanceDay(d);
    expect(next.hourOfDay).toBe(14);
    expect(next.day).toBe(16);
  });
});

// ---- advanceHour -----------------------------------------------------------

describe("advanceHour", () => {
  it("advances by one hour within the same day", () => {
    const d = calendarDateFromDays(847, 45, 14);
    const next = advanceHour(d);
    expect(next.hourOfDay).toBe(15);
    expect(next.day).toBe(15);
    expect(next.dayOfYear).toBe(45);
  });

  it("wraps at 24h, advancing the day", () => {
    const d = calendarDateFromDays(847, 45, 23);
    const next = advanceHour(d);
    expect(next.hourOfDay).toBe(0);
    expect(next.dayOfYear).toBe(46);
    expect(next.day).toBe(16);
  });

  it("wraps across year boundary at 24h on day 360", () => {
    const d = calendarDateFromDays(847, 360, 23);
    const next = advanceHour(d);
    expect(next.hourOfDay).toBe(0);
    expect(next.year).toBe(848);
    expect(next.dayOfYear).toBe(1);
  });
});

// ---- dayPeriod -------------------------------------------------------------

describe("dayPeriod", () => {
  it("returns dawn for 5-7", () => {
    expect(dayPeriod(5)).toBe("dawn");
    expect(dayPeriod(6)).toBe("dawn");
    expect(dayPeriod(7)).toBe("dawn");
  });

  it("returns day for 8-17", () => {
    expect(dayPeriod(8)).toBe("day");
    expect(dayPeriod(12)).toBe("day");
    expect(dayPeriod(17)).toBe("day");
  });

  it("returns dusk for 18-20", () => {
    expect(dayPeriod(18)).toBe("dusk");
    expect(dayPeriod(19)).toBe("dusk");
    expect(dayPeriod(20)).toBe("dusk");
  });

  it("returns night for 0-4 and 21-23", () => {
    expect(dayPeriod(0)).toBe("night");
    expect(dayPeriod(4)).toBe("night");
    expect(dayPeriod(21)).toBe("night");
    expect(dayPeriod(23)).toBe("night");
  });
});

// ---- timeIcon --------------------------------------------------------------

describe("timeIcon", () => {
  it("returns correct icons for each period", () => {
    expect(timeIcon(6)).toBe("🌅");
    expect(timeIcon(12)).toBe("☀️");
    expect(timeIcon(19)).toBe("🌆");
    expect(timeIcon(23)).toBe("🌙");
  });
});

// ---- seasonIcon ------------------------------------------------------------

describe("seasonIcon", () => {
  it("returns correct icons for each season", () => {
    expect(seasonIcon("Jaro")).toBe("🌸");
    expect(seasonIcon("Léto")).toBe("☀️");
    expect(seasonIcon("Podzim")).toBe("🍂");
    expect(seasonIcon("Zima")).toBe("❄️");
  });

  it("returns empty string for unknown season", () => {
    expect(seasonIcon("")).toBe("");
    expect(seasonIcon("unknown")).toBe("");
  });
});

// ---- weatherIcon -----------------------------------------------------------

describe("weatherIcon", () => {
  it("returns correct icons for known weather", () => {
    expect(weatherIcon("jasno")).toBe("☀️");
    expect(weatherIcon("polojasno")).toBe("⛅");
    expect(weatherIcon("zataženo")).toBe("☁️");
    expect(weatherIcon("déšť")).toBe("🌧️");
    expect(weatherIcon("bouřka")).toBe("⛈️");
    expect(weatherIcon("sníh")).toBe("❄️");
    expect(weatherIcon("mlha")).toBe("🌫️");
  });

  it("returns empty string for unknown weather", () => {
    expect(weatherIcon("")).toBe("");
    expect(weatherIcon("tornádo")).toBe("");
  });
});

// ---- Serialization with hourOfDay -----------------------------------------

describe("calendarToJSON / calendarFromJSON with hourOfDay", () => {
  it("round-trips hourOfDay through JSON", () => {
    const original = calendarDateFromDays(847, 200, 14);
    const json = calendarToJSON(original);
    expect(json).toEqual({ year: 847, dayOfYear: 200, hourOfDay: 14 });
    const restored = calendarFromJSON(json);
    expect(restored.hourOfDay).toBe(14);
    expect(restored.year).toBe(847);
    expect(restored.dayOfYear).toBe(200);
  });

  it("calendarFromJSON defaults hourOfDay to 6 when missing", () => {
    const d = calendarFromJSON({ year: 847, dayOfYear: 100 });
    expect(d.hourOfDay).toBe(6);
  });
});

// ---- calendarDescription updated for hourOfDay ----------------------------

describe("calendarDescription with hourOfDay", () => {
  it("includes hour and period info", () => {
    const d = calendarDateFromDays(847, 45, 14);
    const desc = calendarDescription(d);
    expect(desc).toContain("14h");
    expect(desc).toContain("day");
    expect(desc).toContain("[TIME:+1h]");
  });
});

// ---- formatCalendarDateShort updated --------------------------------------

describe("formatCalendarDateShort with hourOfDay", () => {
  it("includes time icon and season icon", () => {
    const d = calendarDateFromDays(847, 45, 14);
    const s = formatCalendarDateShort(d);
    expect(s).toContain("🕐");
    expect(s).toContain("14h");
    expect(s).toContain("🌸");
    expect(s).toContain("Jaro");
  });
});
