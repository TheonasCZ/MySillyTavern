/** SillyTavern World Info JSON <-> lore_entries field mapping (plan §6.4).
 * Pure mapping logic, no DB/Tauri dependency so it's unit-testable without
 * the Tauri runtime — file picking/reading and DB writes are wired up in
 * `db/repositories/lorebooksRepo.ts` and the lorebooks UI. */

/** One entry inside a SillyTavern World Info JSON file's `entries` map
 * (keyed by uid, an arbitrary string/number). Only the fields this app
 * models are typed here; unknown extra fields are ignored on import and
 * not preserved on export (matches the plan's mapping table exactly). */
export interface WorldInfoEntryJson {
  key?: string[];
  keysecondary?: string[];
  content?: string;
  comment?: string;
  constant?: boolean;
  order?: number;
  disable?: boolean;
  case_sensitive?: boolean;
}

export interface WorldInfoFile {
  entries: Record<string, WorldInfoEntryJson>;
}

/** DB-shape-independent view of a lore entry's editable fields — matches
 * `lore_entries` columns minus `id`/`lorebook_id`/`created_at`. */
export interface LoreEntryFields {
  keys: string[];
  secondaryKeys: string[];
  content: string;
  comment: string;
  priority: number;
  alwaysOn: boolean;
  caseSensitive: boolean;
  enabled: boolean;
}

/** Parses raw World Info JSON text into entry field lists ready to insert
 * as `lore_entries`. Throws if the JSON doesn't have an `entries` object. */
export function parseWorldInfoJson(text: string): LoreEntryFields[] {
  const parsed = JSON.parse(text) as Partial<WorldInfoFile>;
  if (!parsed.entries || typeof parsed.entries !== "object") {
    throw new Error("World Info soubor neobsahuje pole 'entries'.");
  }
  return worldInfoToEntries(parsed as WorldInfoFile);
}

export function worldInfoToEntries(wi: WorldInfoFile): LoreEntryFields[] {
  return Object.values(wi.entries ?? {}).map((e) => ({
    keys: Array.isArray(e.key) ? e.key : [],
    secondaryKeys: Array.isArray(e.keysecondary) ? e.keysecondary : [],
    content: e.content ?? "",
    comment: e.comment ?? "",
    priority: e.order ?? 100,
    alwaysOn: e.constant === true,
    caseSensitive: e.case_sensitive === true,
    enabled: e.disable !== true,
  }));
}

/** Mirrors `worldInfoToEntries`: builds a World Info JSON object from a
 * list of lore entries, suitable for `JSON.stringify` + writing to disk.
 * Entry keys in the `entries` map are stable stringified indices — order
 * is preserved by the caller's array order. */
export function entriesToWorldInfo(entries: LoreEntryFields[]): WorldInfoFile {
  const result: Record<string, WorldInfoEntryJson> = {};
  entries.forEach((entry, index) => {
    result[String(index)] = {
      key: entry.keys,
      keysecondary: entry.secondaryKeys,
      content: entry.content,
      comment: entry.comment,
      constant: entry.alwaysOn,
      order: entry.priority,
      disable: !entry.enabled,
      case_sensitive: entry.caseSensitive,
    };
  });
  return { entries: result };
}

export function stringifyWorldInfo(entries: LoreEntryFields[]): string {
  return JSON.stringify(entriesToWorldInfo(entries), null, 2);
}
