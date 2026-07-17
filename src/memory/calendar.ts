/** Calendar system (plan M23) — Fantasy calendar with 12 named Czech months,
 * 4 seasons, 360-day years. Pure functions — no DB/Tauri imports — so they're
 * unit-testable in isolation.
 *
 * Each year has exactly 360 days: 12 months × 30 days.
 * Each season spans 90 days (3 months).
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

/** Builds a CalendarDate from a year and day-of-year. */
export function calendarDateFromDays(year: number, dayOfYear: number): CalendarDate {
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
  };
}

/** Default calendar start: 1. Měsíce probuzení, Rok 847 (day 1 of year 847). */
export function defaultCalendarDate(): CalendarDate {
  return calendarDateFromDays(847, 1);
}

/** Advances the calendar by one day, wrapping year boundaries. */
export function advanceDay(current: CalendarDate): CalendarDate {
  const nextDay = current.dayOfYear >= DAYS_PER_YEAR ? 1 : current.dayOfYear + 1;
  const nextYear = current.dayOfYear >= DAYS_PER_YEAR ? current.year + 1 : current.year;
  return calendarDateFromDays(nextYear, nextDay);
}

/** Formats a CalendarDate for display: "15. Jarního větru, Rok 847". */
export function formatCalendarDate(date: CalendarDate): string {
  return `${date.day}. ${date.month}, Rok ${date.year}`;
}

/** Short format for UI header: "📅 15. Jarního větru, 847". */
export function formatCalendarDateShort(date: CalendarDate): string {
  return `📅 ${date.day}. ${date.month}, ${date.year}`;
}

/** Produces the full prompt block for the current date including season effects
 * and the `[TIME:+1d]` tag instruction for advancing the calendar. */
export function calendarDescription(date: CalendarDate): string {
  const effects = SEASON_EFFECTS[date.season] ?? "";
  const tagNote = "Pro posun času o jeden den použij tag [TIME:+1d] — spustí se efekty úsvitu/soumraku.";
  return `[DNEŠNÍ DATUM] ${formatCalendarDate(date)} (${date.season})\n${effects}\n${tagNote}`;
}

/** Serializes calendar state to a storable JSON object. */
export function calendarToJSON(date: CalendarDate): { year: number; dayOfYear: number } {
  return { year: date.year, dayOfYear: date.dayOfYear };
}

/** Deserializes calendar state from stored JSON. Falls back to default on any error. */
export function calendarFromJSON(json: unknown): CalendarDate {
  try {
    const obj = json as Record<string, unknown>;
    if (typeof obj?.year === "number" && typeof obj?.dayOfYear === "number") {
      return calendarDateFromDays(obj.year, obj.dayOfYear);
    }
  } catch {
    // fall through
  }
  return defaultCalendarDate();
}
