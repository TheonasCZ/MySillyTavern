/** SillyTavern World Info JSON <-> lore_entries field mapping (plan §6.4).
 * Pure mapping logic, no DB/Tauri dependency so it's unit-testable without
 * the Tauri runtime — file picking/reading and DB writes are wired up in
 * `db/repositories/lorebooksRepo.ts` and the lorebooks UI. */

import { expandKeys } from "./stemming";

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
  /** MySillyTavern extensions stored under this key in ST JSON. */
  extensions?: {
    mysillytavern?: {
      recursiveActivation?: boolean;
      activationDepth?: number;
      selectiveKeys?: { key: string; logic: "AND" | "NOT" }[];
      timed?: { sticky?: number; cooldown?: number; delay?: number } | null;
      vectorThreshold?: number | null;
      vectorBudget?: number;
    };
  };
}

export interface WorldInfoFile {
  entries: Record<string, WorldInfoEntryJson>;
}

/** A selective secondary key with logical operator for AND/NOT filtering. */
export interface SelectiveKey {
  key: string;
  logic: "AND" | "NOT";
}

/** Timed activation effects: sticky/cooldown/delay in number of messages. */
export interface TimedEffect {
  sticky?: number;
  cooldown?: number;
  delay?: number;
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
  /** When true, this entry's keys can recursively activate other entries. */
  recursiveActivation: boolean;
  /** Max recursion depth for recursive activation (default 1, clamped ≥ 1). */
  activationDepth: number;
  /** Selective AND/NOT secondary keys — must all be present (AND) or absent
   * (NOT) for the entry to activate. Empty = no selective filtering. */
  selectiveKeys: SelectiveKey[];
  /** Timed effects: null = no timed behaviour. */
  timed: TimedEffect | null;
  /** Cosine-similarity threshold for embedding-based activation (null = off). */
  vectorThreshold: number | null;
  /** Max number of entries that can be activated via vector similarity per
   * prompt scan (default 2). */
  vectorBudget: number;
}

/** Defaults for newly-created LoreEntryFields (blank entry in editor). */
export function blankEntryFields(): LoreEntryFields {
  return {
    keys: [],
    secondaryKeys: [],
    content: "",
    comment: "",
    priority: 100,
    alwaysOn: false,
    caseSensitive: false,
    enabled: true,
    recursiveActivation: false,
    activationDepth: 1,
    selectiveKeys: [],
    timed: null,
    vectorThreshold: null,
    vectorBudget: 2,
  };
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
  return Object.values(wi.entries ?? {}).map((e) => {
    const keys = Array.isArray(e.key) ? e.key : [];
    const secondaryKeys = Array.isArray(e.keysecondary) ? e.keysecondary : [];
    // Merge user-supplied secondary keys with auto-expanded primary keys.
    const mergedSecondary = [...new Set([...secondaryKeys, ...expandKeys(keys)])];
    const ext = e.extensions?.mysillytavern;
    return {
      keys,
      secondaryKeys: mergedSecondary,
      content: e.content ?? "",
      comment: e.comment ?? "",
      priority: e.order ?? 100,
      alwaysOn: e.constant === true,
      caseSensitive: e.case_sensitive === true,
      enabled: e.disable !== true,
      recursiveActivation: ext?.recursiveActivation ?? false,
      activationDepth: ext?.activationDepth ?? 1,
      selectiveKeys: ext?.selectiveKeys ?? [],
      timed: ext?.timed ?? null,
      vectorThreshold: ext?.vectorThreshold ?? null,
      vectorBudget: ext?.vectorBudget ?? 2,
    };
  });
}

/** Mirrors `worldInfoToEntries`: builds a World Info JSON object from a
 * list of lore entries, suitable for `JSON.stringify` + writing to disk.
 * Entry keys in the `entries` map are stable stringified indices — order
 * is preserved by the caller's array order. */
export function entriesToWorldInfo(entries: LoreEntryFields[]): WorldInfoFile {
  const result: Record<string, WorldInfoEntryJson> = {};
  entries.forEach((entry, index) => {
    const hasExtensions =
      entry.recursiveActivation ||
      entry.activationDepth !== 1 ||
      entry.selectiveKeys.length > 0 ||
      entry.timed !== null ||
      entry.vectorThreshold !== null ||
      entry.vectorBudget !== 2;
    result[String(index)] = {
      key: entry.keys,
      keysecondary: entry.secondaryKeys,
      content: entry.content,
      comment: entry.comment,
      constant: entry.alwaysOn,
      order: entry.priority,
      disable: !entry.enabled,
      case_sensitive: entry.caseSensitive,
      ...(hasExtensions && {
        extensions: {
          mysillytavern: {
            ...(entry.recursiveActivation && { recursiveActivation: true }),
            ...(entry.activationDepth !== 1 && { activationDepth: entry.activationDepth }),
            ...(entry.selectiveKeys.length > 0 && { selectiveKeys: entry.selectiveKeys }),
            ...(entry.timed !== null && { timed: entry.timed }),
            ...(entry.vectorThreshold !== null && { vectorThreshold: entry.vectorThreshold }),
            ...(entry.vectorBudget !== 2 && { vectorBudget: entry.vectorBudget }),
          },
        },
      }),
    };
  });
  return { entries: result };
}

export function stringifyWorldInfo(entries: LoreEntryFields[]): string {
  return JSON.stringify(entriesToWorldInfo(entries), null, 2);
}
