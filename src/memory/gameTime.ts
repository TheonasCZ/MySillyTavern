/** Game-time & weather system (plan B3). Pure functions — no DB/Tauri
 * imports — so they're unit-testable in isolation. Time advances with each
 * message, weather changes via a Markov chain, and the PromptBuilder
 * renders a `[PRÁVĚ TEĎ]` block from the resulting state. */

export interface GameTimeState {
  /** Unix-epoch milliseconds in game-world time. */
  timestamp_ingame: number;
  /** How many *real* seconds → one game-minute (default 1 = real-time).
   *  Higher values make game-time run faster. */
  time_scale: number;
  weather: Weather;
  season: Season;
  time_of_day: TimeOfDay;
}

export type Weather = "jasno" | "polojasno" | "zataženo" | "déšť" | "bouřka" | "sníh" | "mlha";

export type Season = "zima" | "jaro" | "léto" | "podzim";

export type TimeOfDay = "ráno" | "dopoledne" | "poledne" | "odpoledne" | "podvečer" | "večer" | "noc";

const MS_PER_MINUTE = 60_000;

/** Default state factory — winter noon on 1 Jan 2024, real-time scale. */
export function defaultGameTimeState(): GameTimeState {
  // 2024-01-01T12:00:00Z
  const noon = new Date(Date.UTC(2024, 0, 1, 12, 0, 0));
  return {
    timestamp_ingame: noon.getTime(),
    time_scale: 1,
    weather: "zataženo",
    season: "zima",
    time_of_day: "poledne",
  };
}

/** Advances the game clock by `messageCount * time_scale` minutes. */
export function advanceTime(state: GameTimeState, messageCount: number): GameTimeState {
  const addedMs = messageCount * state.time_scale * MS_PER_MINUTE;
  const nextTs = state.timestamp_ingame + addedMs;
  const date = new Date(nextTs);
  const month = date.getUTCMonth() + 1; // 1–12
  const hour = date.getUTCHours();
  const season = seasonFromMonth(month);
  const tod = timeOfDay(hour);
  const weather = nextWeather(state.weather, season);
  return {
    ...state,
    timestamp_ingame: nextTs,
    season,
    time_of_day: tod,
    weather,
  };
}

/** Maps month 1–12 to Czech season name. */
export function seasonFromMonth(month: number): Season {
  // Clamp to valid range
  const m = Math.max(1, Math.min(12, Math.floor(month)));
  if (m === 12 || m <= 2) return "zima";
  if (m <= 5) return "jaro";
  if (m <= 8) return "léto";
  return "podzim";
}

/** Maps hour 0–23 to Czech time-of-day label. */
export function timeOfDay(hour: number): TimeOfDay {
  const h = Math.max(0, Math.min(23, Math.floor(hour)));
  if (h >= 5 && h <= 6) return "ráno";
  if (h >= 7 && h <= 10) return "dopoledne";
  if (h >= 11 && h <= 12) return "poledne";
  if (h >= 13 && h <= 16) return "odpoledne";
  if (h >= 17 && h <= 18) return "podvečer";
  if (h >= 19 && h <= 21) return "večer";
  return "noc"; // 22–4
}

// ---- Weather Markov chain -----------------------------------------------

/** Transition probability matrix: weathers[current][next] = weight.
 *  Weights are un-normalised — `pickWeighted` normalises at call time.
 *  The matrices vary by season so e.g. "sníh" is only reachable in winter,
 *  "bouřka" is more likely in summer. */
const WEATHER_WEIGHTS: Record<Season, Record<Weather, Partial<Record<Weather, number>>>> = {
  zima: {
    jasno:      { jasno: 5, polojasno: 3, zataženo: 2, déšť: 1, mlha: 2, sníh: 4 },
    polojasno:  { polojasno: 3, jasno: 2, zataženo: 4, déšť: 2, sníh: 3, mlha: 2 },
    zataženo:   { zataženo: 5, polojasno: 2, déšť: 2, sníh: 4, mlha: 2 },
    déšť:       { déšť: 3, zataženo: 4, polojasno: 1, sníh: 2, mlha: 2 },
    bouřka:     { bouřka: 1, zataženo: 3, déšť: 2, sníh: 1, mlha: 1 },
    sníh:       { sníh: 6, zataženo: 3, polojasno: 1, mlha: 2 },
    mlha:       { mlha: 4, zataženo: 3, polojasno: 2, jasno: 1, déšť: 1 },
  },
  jaro: {
    jasno:      { jasno: 5, polojasno: 3, zataženo: 2, déšť: 2, mlha: 1 },
    polojasno:  { polojasno: 3, jasno: 2, zataženo: 4, déšť: 3, mlha: 1 },
    zataženo:   { zataženo: 4, déšť: 4, polojasno: 2, mlha: 1, bouřka: 1 },
    déšť:       { déšť: 3, zataženo: 4, polojasno: 2, mlha: 1, bouřka: 1 },
    bouřka:     { bouřka: 1, déšť: 3, zataženo: 3, polojasno: 1 },
    sníh:       { sníh: 1, zataženo: 2, polojasno: 1 }, // residual late winter
    mlha:       { mlha: 3, zataženo: 2, polojasno: 2, jasno: 1, déšť: 1 },
  },
  léto: {
    jasno:      { jasno: 6, polojasno: 2, zataženo: 1, bouřka: 1, mlha: 1 },
    polojasno:  { polojasno: 3, jasno: 3, zataženo: 2, déšť: 1, bouřka: 2, mlha: 1 },
    zataženo:   { zataženo: 3, déšť: 3, bouřka: 3, polojasno: 2, mlha: 1 },
    déšť:       { déšť: 3, zataženo: 3, bouřka: 3, polojasno: 2, mlha: 1 },
    bouřka:     { bouřka: 2, déšť: 3, zataženo: 3, polojasno: 1, jasno: 1 },
    sníh:       { déšť: 2, zataženo: 1 }, // impossible in summer — degrade fast
    mlha:       { mlha: 3, zataženo: 2, polojasno: 2, jasno: 1, déšť: 1 },
  },
  podzim: {
    jasno:      { jasno: 3, polojasno: 3, zataženo: 3, déšť: 2, mlha: 2 },
    polojasno:  { polojasno: 2, zataženo: 4, déšť: 3, jasno: 1, mlha: 2 },
    zataženo:   { zataženo: 4, déšť: 4, polojasno: 1, mlha: 2, bouřka: 1 },
    déšť:       { déšť: 4, zataženo: 4, polojasno: 1, mlha: 2, bouřka: 1 },
    bouřka:     { bouřka: 1, déšť: 3, zataženo: 3, polojasno: 1 },
    sníh:       { sníh: 1, zataženo: 2, déšť: 1 }, // late autumn — rare
    mlha:       { mlha: 5, zataženo: 3, polojasno: 2, déšť: 1 },
  },
};

/** Pick the next weather given current weather + season. When the current
 *  weather has no transitions defined for the season (e.g. "sníh" in summer),
 *  returns a reasonable fallback for that season. */
export function nextWeather(current: Weather, season: Season): Weather {
  const seasonWeights = WEATHER_WEIGHTS[season] ?? WEATHER_WEIGHTS.podzim;
  const transitions = seasonWeights[current];

  if (!transitions || Object.keys(transitions).length === 0) {
    // Current weather has no viable next state in this season — fall back
    // to a sensible default.
    return seasonFallback(season);
  }

  return pickWeighted(transitions as Record<Weather, number>) as Weather;
}

function seasonFallback(season: Season): Weather {
  switch (season) {
    case "zima":  return "zataženo";
    case "jaro":  return "polojasno";
    case "léto":  return "jasno";
    case "podzim": return "zataženo";
  }
}

function pickWeighted(weights: Record<string, number>): string {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  if (entries.length === 0) return "jasno"; // ultimate fallback
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let roll = Math.random() * total;
  for (const [key, w] of entries) {
    roll -= w;
    if (roll <= 0) return key;
  }
  return entries[entries.length - 1][0];
}

// ---- Time description (Czech natural language) -------------------------

/** Returns a Czech natural-language scene-setting sentence combining
 *  time-of-day, season, and current weather. Deterministic — callers
 *  that want variety should pass different states. */
export function timeDescription(state: GameTimeState): string {
  const tod = timeOfDayDescription(state.time_of_day);
  const season = seasonDescription(state.season);
  const weather = weatherDescription(state.weather, state.season, state.time_of_day);
  return `Je ${tod}, ${season}. ${weather}`;
}

function timeOfDayDescription(tod: TimeOfDay): string {
  switch (tod) {
    case "ráno":       return "časné ráno";
    case "dopoledne":  return "dopoledne";
    case "poledne":    return "poledne";
    case "odpoledne":  return "odpoledne";
    case "podvečer":   return "pozdní odpoledne";
    case "večer":      return "večer";
    case "noc":        return "hluboká noc";
  }
}

function seasonDescription(season: Season): string {
  switch (season) {
    case "zima":   return "zima";
    case "jaro":   return "jaro";
    case "léto":   return "léto";
    case "podzim": return "podzim";
  }
}

export function weatherDescription(weather: Weather, season: Season, tod: TimeOfDay): string {
  switch (weather) {
    case "jasno":
      if (tod === "noc" || tod === "ráno") {
        return "Obloha je jasná, hvězdy září na temné obloze.";
      }
      if (season === "léto") return "Slunce nemilosrdně pálí z bezmračné oblohy.";
      if (season === "zima") return "Mráz štípe do tváří, obloha je křišťálově čistá.";
      return "Slunce svítí na jasné obloze.";
    case "polojasno":
      if (season === "léto") return "Oblohou plují lehké mraky, občas zakryjí slunce.";
      return "Obloha je polojasná, slunce se schovává za mraky.";
    case "zataženo":
      if (season === "zima") return "Těžká šedá obloha visí nízko nad krajinou.";
      return "Obloha je zatažená, šedé mraky visí nízko.";
    case "déšť":
      if (season === "léto") return "Teplé kapky deště bubnují do země.";
      if (season === "podzim") return "Studený déšť bičuje krajinu, vítr skučí v korunách stromů.";
      if (season === "zima") return "Ledový déšť se snáší z temné oblohy.";
      return "Déšť vytrvale bubnuje do země.";
    case "bouřka":
      if (tod === "noc") return "Blesky ozařují noční oblohu, hromy duní v dálce.";
      if (season === "léto") return "Těžké bouřkové mraky se valí oblohou, vzduch je těžký a dusný.";
      return "Bouřka burácí, blesky křižují oblohu.";
    case "sníh":
      return "Sněhové vločky se tiše snášejí z oblohy, krajina je pokrytá bílým popraškem.";
    case "mlha":
      if (tod === "ráno" || tod === "noc") return "Hustá mlha se plazí krajinou, není vidět na krok.";
      return "Mlha zahaluje krajinu do šedivého závoje.";
  }
}
