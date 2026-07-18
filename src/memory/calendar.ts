/** Calendar system (plan M23) — Fantasy calendar with 12 named Czech months,
 * 4 seasons, 360-day years. Pure functions — no DB/Tauri imports — so they're
 * unit-testable in isolation.
 *
 * Each year has exactly 360 days: 12 months × 30 days.
 * Each season spans 90 days (3 months).
 *
 * Time-of-day is tracked as hourOfDay (0–23) alongside the date. Hours
 * advance independently; wrapping at 24h also advances the calendar day.
 *
 * Month names use Czech genitive forms for date formatting
 * (e.g. "15. Jarního větru, Rok 847"). */

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

/** Builds a CalendarDate from a year, day-of-year, and optional hour. */
export function calendarDateFromDays(year: number, dayOfYear: number, hourOfDay = 6): CalendarDate {
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
  };
}

/** Default calendar start: 1. Měsíce probuzení, Rok 847, 6h (dawn). */
export function defaultCalendarDate(): CalendarDate {
  return calendarDateFromDays(847, 1, 6);
}

/** Advances the calendar by one day, wrapping year boundaries. Preserves hourOfDay. */
export function advanceDay(current: CalendarDate): CalendarDate {
  const nextDay = current.dayOfYear >= DAYS_PER_YEAR ? 1 : current.dayOfYear + 1;
  const nextYear = current.dayOfYear >= DAYS_PER_YEAR ? current.year + 1 : current.year;
  return calendarDateFromDays(nextYear, nextDay, current.hourOfDay);
}

/** Advances the calendar by one hour. Wraps at 24h, advancing the day. */
export function advanceHour(current: CalendarDate): CalendarDate {
  const nextHour = current.hourOfDay + 1;
  if (nextHour >= 24) {
    const nextDayOfYear = current.dayOfYear >= DAYS_PER_YEAR ? 1 : current.dayOfYear + 1;
    const nextYear = current.dayOfYear >= DAYS_PER_YEAR ? current.year + 1 : current.year;
    return calendarDateFromDays(nextYear, nextDayOfYear, 0);
  }
  return { ...current, hourOfDay: nextHour };
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

/** Formats a CalendarDate for display: "15. Jarního větru, Rok 847". */
export function formatCalendarDate(date: CalendarDate): string {
  return `${date.day}. ${date.month}, Rok ${date.year}`;
}

/** Maps fantasy month genitives to real-world month equivalents. */
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

/** Short format for UI header: compact, mobile-friendly, with real month. */
export function formatCalendarDateShort(date: CalendarDate): string {
  const hour = date.hourOfDay ?? 6;
  const real = REAL_MONTH_GENITIVE[date.month] ?? "";
  const realSuffix = real ? ` (${real})` : "";
  const pad = String(hour).padStart(2, "0");
  return `🕐${pad}:00 ${timeIcon(hour)} ${date.day}. ${date.month}${realSuffix}, ${date.year} ${seasonIcon(date.season)}`;
}

/** Produces the full prompt block for the current date including season effects
 * and the `[TIME:+1d]` / `[TIME:+1h]` tag instructions for advancing time. */
export function calendarDescription(date: CalendarDate): string {
  const effects = SEASON_EFFECTS[date.season] ?? "";
  const period = dayPeriod(date.hourOfDay ?? 6);
  const hour = date.hourOfDay ?? 6;
  const tagNote = `Pro posun času použij tag [TIME:+1d] (den) nebo [TIME:+1h] (hodina). Aktuálně je ${hour}h (${period}).`;
  return `[DNEŠNÍ DATUM] ${formatCalendarDate(date)} (${date.season}, ${hour}h — ${period})\n${effects}\n${tagNote}`;
}

// ---- Serialization ---------------------------------------------------------

/** Serializes calendar state to a storable JSON object. */
export function calendarToJSON(date: CalendarDate): { year: number; dayOfYear: number; hourOfDay: number } {
  return { year: date.year, dayOfYear: date.dayOfYear, hourOfDay: date.hourOfDay };
}

/** Deserializes calendar state from stored JSON. Falls back to default on any error. */
export function calendarFromJSON(json: unknown): CalendarDate {
  try {
    const obj = json as Record<string, unknown>;
    if (typeof obj?.year === "number" && typeof obj?.dayOfYear === "number") {
      const hour = typeof obj.hourOfDay === "number" ? obj.hourOfDay : 6;
      return calendarDateFromDays(obj.year, obj.dayOfYear, hour);
    }
  } catch {
    // fall through
  }
  return defaultCalendarDate();
}
