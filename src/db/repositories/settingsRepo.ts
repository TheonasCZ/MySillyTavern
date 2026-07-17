import { execute, query } from "../database";

interface SettingRow {
  key: string;
  value: string;
}

export async function getSetting(key: string): Promise<string | null> {
  const rows = await query<SettingRow>("SELECT key, value FROM settings WHERE key = $1", [key]);
  return rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await execute(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}

export async function resetAllSettings(): Promise<void> {
  await execute("DELETE FROM settings", []);
}

export async function getAllSettings(): Promise<Record<string, string>> {
  const rows = await query<SettingRow>("SELECT key, value FROM settings", []);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

// ---- Calendar helpers (plan M23) ----------------------------------------

export const CALENDAR_SETTING_KEY = "game_calendar";

export interface CalendarJSON {
  year: number;
  dayOfYear: number;
}

/** Reads the stored calendar for a chat, or returns null if never set. */
export async function getCalendarSetting(chatId: string): Promise<CalendarJSON | null> {
  const key = `${CALENDAR_SETTING_KEY}_${chatId}`;
  const raw = await getSetting(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CalendarJSON;
    if (typeof parsed.year === "number" && typeof parsed.dayOfYear === "number") {
      return parsed;
    }
  } catch {
    // fall through
  }
  return null;
}

/** Persists the calendar JSON for a chat. */
export async function setCalendarSetting(chatId: string, cal: CalendarJSON): Promise<void> {
  const key = `${CALENDAR_SETTING_KEY}_${chatId}`;
  await setSetting(key, JSON.stringify(cal));
}

// ---- Sync helpers (M14) -------------------------------------------------

/** Generates and stores a random device-id the first time sync is enabled.
 *  Returns the existing device-id if one is already stored. */
export async function ensureDeviceId(): Promise<string> {
  const existing = await getSetting("device_id");
  if (existing) return existing;
  const id = crypto.randomUUID();
  await setSetting("device_id", id);
  return id;
}

export interface SyncPosition {
  file: string;
  byteOffset: number;
}

/** Reads tracked sync positions (which byte of each foreign journal file has
 *  already been processed). Returns an empty array when nothing is tracked. */
export async function getSyncPositions(): Promise<SyncPosition[]> {
  const raw = await getSetting("sync_positions");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p: unknown): p is SyncPosition =>
        typeof p === "object" && p !== null &&
        typeof (p as SyncPosition).file === "string" &&
        typeof (p as SyncPosition).byteOffset === "number",
    );
  } catch {
    return [];
  }
}

/** Persists the current sync positions. */
export async function setSyncPositions(positions: SyncPosition[]): Promise<void> {
  await setSetting("sync_positions", JSON.stringify(positions));
}
