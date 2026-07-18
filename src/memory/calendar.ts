/** Calendar system (plan M23) — Fantasy calendar with 12 named Czech months,
 * 4 seasons, 360-day years. Pure functions — no DB/Tauri imports — so they're
 * unit-testable in isolation.
 *
 * Each year has exactly 360 days: 12 months × 30 days.
 * Each season spans 90 days (3 months).
 *
 * Time-of-day is tracked as hourOfDay (0–23) and minuteOfHour (0–59)
 * alongside the date. Minutes advance independently; wrapping at 60m
 * advances the hour, which in turn wraps at 24h into the next day.
 *
 * Month names use Czech genitive forms for date formatting
 * (e.g. "15. Jarního větru, Rok 847"). */

import { timeOfDay } from "./gameTime";

export interface CalendarDate {
  year: number;
  /** 1-based day of year (1..360). */
  dayOfYear: number;
  month: string;
  /** 1-based day within the current month (1..30). */
  day: number;
  season: string;
  /** Hour of day (0–23). */
  hourOfDay: number;
  /** Minute within the hour (0–59). */
  minuteOfHour: number;
}

// ---- Month definitions ---------------------------------------------------

export interface MonthDef {
  name: string;
  genitive: string;
  days: number;
  season: string;
}

/** 12 Czech fantasy months, 30 days each, grouped by season. */
export const MONTHS: MonthDef[] = [
  // Jaro (Spring) — days 1–90
  { name: "Měsíc probuzení",  genitive: "Měsíce probuzení",  days: 30, season: "Jaro" },
  { name: "Jarní vítr",       genitive: "Jarního větru",      days: 30, season: "Jaro" },
  { name: "Měsíc květů",      genitive: "Měsíce květů",       days: 30, season: "Jaro" },
  // Léto (Summer) — days 91–180
  { name: "Měsíc slunce",     genitive: "Měsíce slunce",      days: 30, season: "Léto" },
  { name: "Měsíc žáru",       genitive: "Měsíce žáru",        days: 30, season: "Léto" },
  { name: "Měsíc bouří",      genitive: "Měsíce bouří",       days: 30, season: "Léto" },
  // Podzim (Autumn) — days 181–270
  { name: "Měsíc sklizně",    genitive: "Měsíce sklizně",     days: 30, season: "Podzim" },
  { name: "Měsíc listí",      genitive: "Měsíce listí",       days: 30, season: "Podzim" },
  { name: "Měsíc mlh",        genitive: "Měsíce mlh",         days: 30, season: "Podzim" },
  // Zima (Winter) — days 271–360
  { name: "Měsíc mrazu",      genitive: "Měsíce mrazu",       days: 30, season: "Zima" },
  { name: "Měsíc sněhu",      genitive: "Měsíce sněhu",       days: 30, season: "Zima" },
  { name: "Měsíc temnoty",    genitive: "Měsíce temnoty",     days: 30, season: "Zima" },
];

/** Total days in a calendar year. */
export const DAYS_PER_YEAR = 360;

// ---- Season effects (prompt only, no mechanics) -------------------------

export const SEASON_EFFECTS: Record<string, string> = {
  "Jaro":   "Příroda se probouzí. Cesty jsou blátivé. Bylinky raší.",
  "Léto":   "Horké dny. Obchodníci jsou na cestách. Bouřky jsou časté.",
  "Podzim": "Sklizeň. Listí padá. Lovná zvěř je aktivní.",
  "Zima":   "Mráz. Sníh. Cesty jsou nebezpečné. Noci dlouhé.",
};

// ---- Core functions -------------------------------------------------------

/** Returns the Czech season name for a given day-of-year (1..360).
 * Clamps out-of-range values to the nearest valid season. */
export function getSeason(dayOfYear: number): string {
  const d = Math.max(1, Math.min(DAYS_PER_YEAR, Math.floor(dayOfYear)));
  if (d <= 90) return "Jaro";
  if (d <= 180) return "Léto";
  if (d <= 270) return "Podzim";
  return "Zima";
}

/** Builds a CalendarDate from a year, day-of-year, and optional hour/minute. */
export function calendarDateFromDays(year: number, dayOfYear: number, hourOfDay = 6, minuteOfHour = 0): CalendarDate {
  const d = Math.max(1, Math.min(DAYS_PER_YEAR, Math.floor(dayOfYear)));
  let remaining = d;
  let monthIdx = 0;
  for (let i = 0; i < MONTHS.length; i++) {
    if (remaining <= MONTHS[i].days) {
      monthIdx = i;
      break;
    }
    remaining -= MONTHS[i].days;
  }
  const month = MONTHS[monthIdx];
  return {
    year,
    dayOfYear: d,
    month: month.genitive,
    day: remaining,
    season: month.season,
    hourOfDay: Math.max(0, Math.min(23, Math.floor(hourOfDay))),
    minuteOfHour: Math.max(0, Math.min(59, Math.floor(minuteOfHour))),
  };
}

/** Default calendar start: 1. Měsíce probuzení, Rok 847, 6h (dawn). */
export function defaultCalendarDate(): CalendarDate {
  return calendarDateFromDays(847, 1, 6, 0);
}

/** Advances the calendar by a number of whole minutes (may be more than an
 * hour or a day — wraps hours/days/years as needed). This is the one
 * primitive all other `advance*` helpers are built on. */
export function advanceMinutes(current: CalendarDate, minutes: number): CalendarDate {
  const totalMinutes =
    current.dayOfYear * 1440 + current.hourOfDay * 60 + current.minuteOfHour + Math.floor(minutes);
  const dayOfYearRaw = Math.floor(totalMinutes / 1440);
  const minuteOfDay = ((totalMinutes % 1440) + 1440) % 1440;
  const hourOfDay = Math.floor(minuteOfDay / 60);
  const minuteOfHour = minuteOfDay % 60;

  // Roll dayOfYear/year the same way advanceDay always did: wrap 1..DAYS_PER_YEAR.
  let dayOfYear = ((dayOfYearRaw - 1) % DAYS_PER_YEAR + DAYS_PER_YEAR) % DAYS_PER_YEAR + 1;
  const yearsElapsed = Math.floor((dayOfYearRaw - 1) / DAYS_PER_YEAR);
  const year = current.year + yearsElapsed;
  if (dayOfYear < 1) dayOfYear += DAYS_PER_YEAR;

  return calendarDateFromDays(year, dayOfYear, hourOfDay, minuteOfHour);
}

/** Advances the calendar by one day, wrapping year boundaries. Preserves the time of day. */
export function advanceDay(current: CalendarDate): CalendarDate {
  return advanceMinutes(current, 1440);
}

/** Advances the calendar by one hour. Wraps at 24h, advancing the day. */
export function advanceHour(current: CalendarDate): CalendarDate {
  return advanceMinutes(current, 60);
}

// ---- Time-of-day helpers -------------------------------------------------

export type DayPeriod = "dawn" | "day" | "dusk" | "night";

/** Returns the day period for a given hour (0–23). */
export function dayPeriod(hour: number): DayPeriod {
  const h = Math.max(0, Math.min(23, Math.floor(hour)));
  if (h >= 5 && h <= 7) return "dawn";
  if (h >= 8 && h <= 17) return "day";
  if (h >= 18 && h <= 20) return "dusk";
  return "night"; // 21–4
}

/** Returns an emoji icon for the time of day. */
export function timeIcon(hour: number): string {
  const period = dayPeriod(hour);
  switch (period) {
    case "dawn": return "🌅";
    case "day": return "☀️";
    case "dusk": return "🌆";
    case "night": return "🌙";
  }
}

/** Returns an emoji icon for a Czech fantasy season. */
export function seasonIcon(season: string): string {
  switch (season) {
    case "Jaro": return "🌸";
    case "Léto": return "☀️";
    case "Podzim": return "🍂";
    case "Zima": return "❄️";
    default: return "";
  }
}

/** Returns an emoji icon for a Czech weather string. */
export function weatherIcon(weather: string): string {
  switch (weather) {
    case "jasno": return "☀️";
    case "polojasno": return "⛅";
    case "zataženo": return "☁️";
    case "déšť": return "🌧️";
    case "bouřka": return "⛈️";
    case "sníh": return "❄️";
    case "mlha": return "🌫️";
    default: return "";
  }
}

// ---- Formatting ------------------------------------------------------------

/** Formats a CalendarDate for display: "15. Jarního větru, Rok 847"
 * (or "15. dubna, Rok 847" in real mode). */
export function formatCalendarDate(date: CalendarDate, mode: CalendarMode = "fantasy"): string {
  return `${date.day}. ${monthDisplayName(date.month, mode)}, Rok ${date.year}`;
}

/** Whether dates are displayed with the fantasy month names ("Jarního
 * větru") or their real-world equivalents ("dubna") — a global player
 * preference (Settings → Hraní), not per-chat. */
export type CalendarMode = "fantasy" | "real";

/** Maps fantasy month genitives to real-world month equivalents (nominative,
 * e.g. "Duben" — used as a parenthetical hint). */
const REAL_MONTH_GENITIVE: Record<string, string> = {
  // Jaro
  "Měsíce probuzení": "Březen",
  "Jarního větru": "Duben",
  "Měsíce květů": "Květen",
  // Léto
  "Měsíce slunce": "Červen",
  "Měsíce žáru": "Červenec",
  "Měsíce bouří": "Srpen",
  // Podzim
  "Měsíce sklizně": "Září",
  "Měsíce listí": "Říjen",
  "Měsíce mlh": "Listopad",
  // Zima
  "Měsíce mrazu": "Prosinec",
  "Měsíce sněhu": "Leden",
  "Měsíce temnoty": "Únor",
};

/** Real-world month names in genitive form ("15. dubna"), aligned index-for-
 * index with `MONTHS` — used when `CalendarMode` is `"real"`. */
const REAL_MONTH_GENITIVE_FORM: Record<string, string> = {
  "Měsíce probuzení": "března",
  "Jarního větru": "dubna",
  "Měsíce květů": "května",
  "Měsíce slunce": "června",
  "Měsíce žáru": "července",
  "Měsíce bouří": "srpna",
  "Měsíce sklizně": "září",
  "Měsíce listí": "října",
  "Měsíce mlh": "listopadu",
  "Měsíce mrazu": "prosince",
  "Měsíce sněhu": "ledna",
  "Měsíce temnoty": "února",
};

/** Returns the display name for a month according to the player's
 * fantasy/real preference. `monthGenitive` is always the fantasy genitive
 * form (how it's stored, e.g. in `CalendarDate.month` or event records) —
 * this only affects what's shown to the player. */
export function monthDisplayName(monthGenitive: string, mode: CalendarMode = "fantasy"): string {
  if (mode === "fantasy") return monthGenitive;
  return REAL_MONTH_GENITIVE_FORM[monthGenitive] ?? monthGenitive;
}

/** Formats a time as "HH:mm", e.g. "07:05". */
export function formatTimeHHMM(hourOfDay: number, minuteOfHour: number): string {
  return `${String(hourOfDay).padStart(2, "0")}:${String(minuteOfHour).padStart(2, "0")}`;
}

/** Short format for UI header: compact, mobile-friendly. In fantasy mode,
 * shows the real month as a parenthetical hint; in real mode, shows only
 * the real month name (no fantasy name to hint at). */
export function formatCalendarDateShort(date: CalendarDate, mode: CalendarMode = "fantasy"): string {
  const hour = date.hourOfDay ?? 6;
  const minute = date.minuteOfHour ?? 0;
  const monthPart =
    mode === "real"
      ? monthDisplayName(date.month, "real")
      : (() => {
          const real = REAL_MONTH_GENITIVE[date.month] ?? "";
          return real ? `${date.month} (${real})` : date.month;
        })();
  return `🕐${formatTimeHHMM(hour, minute)} ${timeIcon(hour)} ${date.day}. ${monthPart}, ${date.year} ${seasonIcon(date.season)}`;
}

/** Produces the full prompt block for the current date including season effects
 * and the `[TIME:+1d]` / `[TIME:+1h]` / `[TIME:+15m]` tag instructions for
 * advancing time. */
export function calendarDescription(date: CalendarDate, mode: CalendarMode = "fantasy"): string {
  const effects = SEASON_EFFECTS[date.season] ?? "";
  const hour = date.hourOfDay ?? 6;
  const minute = date.minuteOfHour ?? 0;
  // Czech label ("odpoledne", not the English "day" dayPeriod() below uses
  // for icon selection) — this is the one actually read out to the model,
  // so it needs to read as an unambiguous, on-language fact it can't miss.
  const period = timeOfDay(hour);
  const time = formatTimeHHMM(hour, minute);
  const tagNote = `Pro posun času použij tag [TIME:+1d] (den), [TIME:+1h] (hodina) nebo [TIME:+15m] (minuty). Aktuálně je ${time} (${period}) — nenabízej hráči noční/tmavé taktiky (schování se ve tmě, noční přesun apod.), pokud právě není noc.`;
  return `[DNEŠNÍ DATUM] ${formatCalendarDate(date, mode)} (${date.season}, ${time} — ${period})\n${effects}\n${tagNote}`;
}

// ---- Serialization ---------------------------------------------------------

/** Serializes calendar state to a storable JSON object. */
export function calendarToJSON(
  date: CalendarDate,
): { year: number; dayOfYear: number; hourOfDay: number; minuteOfHour: number } {
  return { year: date.year, dayOfYear: date.dayOfYear, hourOfDay: date.hourOfDay, minuteOfHour: date.minuteOfHour };
}

/** Deserializes calendar state from stored JSON. Falls back to default on any error. */
export function calendarFromJSON(json: unknown): CalendarDate {
  try {
    const obj = json as Record<string, unknown>;
    if (typeof obj?.year === "number" && typeof obj?.dayOfYear === "number") {
      const hour = typeof obj.hourOfDay === "number" ? obj.hourOfDay : 6;
      const minute = typeof obj.minuteOfHour === "number" ? obj.minuteOfHour : 0;
      return calendarDateFromDays(obj.year, obj.dayOfYear, hour, minute);
    }
  } catch {
    // fall through
  }
  return defaultCalendarDate();
}
