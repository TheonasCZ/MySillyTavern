/** Bridges the (previously orphaned) weather Markov chain in gameTime.ts to
 *  the calendar system that's actually wired into the prompt (calendar.ts).
 *  Weather is tracked as just a `Weather` value per chat — the calendar
 *  itself (date/season/hour) remains the single source of truth for time;
 *  this only adds atmospheric flavor on top of it, re-rolled whenever the
 *  calendar actually advances (see advanceAndPersistCalendar in
 *  memoryEngine.ts). No separate clock, so it can't drift out of sync with
 *  the date/time the model is actually told. */

import { getSetting, setSetting } from "../db/repositories/settingsRepo";
import { nextWeather, type Season, type Weather } from "./gameTime";

const WEATHER_SETTING_PREFIX = "weather_";

const DEFAULT_WEATHER: Weather = "polojasno";

/** Maps the calendar's free-form Czech season string ("Jaro", "Léto", ...)
 *  to gameTime.ts's lowercase `Season` union. Exported so prompt-building
 *  code (configOps.ts) can pass the right type to `weatherDescription`. */
export function toGameTimeSeason(calendarSeason: string): Season {
  const s = calendarSeason.toLowerCase();
  if (s === "jaro" || s === "léto" || s === "podzim" || s === "zima") return s as Season;
  return "podzim"; // unrecognized season string — mild fallback, never thrown
}

/** Reads the current weather for a chat, defaulting to "polojasno" (partly
 *  cloudy) the first time — a neutral starting point regardless of season. */
export async function getWeather(chatId: string): Promise<Weather> {
  try {
    const raw = await getSetting(`${WEATHER_SETTING_PREFIX}${chatId}`);
    return (raw as Weather) || DEFAULT_WEATHER;
  } catch {
    return DEFAULT_WEATHER;
  }
}

/** Rolls the next weather state (Markov transition weighted by the current
 *  calendar season) and persists it. Call this whenever the calendar
 *  actually advances — not on every message — so weather doesn't flicker
 *  within a single stationary scene. */
export async function advanceAndPersistWeather(chatId: string, calendarSeason: string): Promise<Weather> {
  try {
    const current = await getWeather(chatId);
    const next = nextWeather(current, toGameTimeSeason(calendarSeason));
    await setSetting(`${WEATHER_SETTING_PREFIX}${chatId}`, next);
    return next;
  } catch {
    return DEFAULT_WEATHER;
  }
}
