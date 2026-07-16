/** Lorebook activation scan (plan §6.4). Pure logic, no DB/Tauri
 * dependency on purpose — this module is unit-tested with vitest without
 * booting the Tauri runtime. Callers (chatStore / systemPrompt glue) load
 * entries via `db/repositories/lorebooksRepo.ts` and pass plain data in. */

export interface LoreEntryLike {
  id: string;
  keys: string[];
  secondaryKeys: string[];
  content: string;
  priority: number;
  alwaysOn: boolean;
  caseSensitive: boolean;
  enabled: boolean;
}

export interface ActivationOptions {
  /** How many of the most recent messages to scan for keys. Default 4
   * (`lore_scan_depth` setting). */
  scanDepth?: number;
  /** Token budget for activated entry content. Default 800
   * (`lore_token_budget` setting). */
  tokenBudget?: number;
}

export const DEFAULT_SCAN_DEPTH = 4;
export const DEFAULT_TOKEN_BUDGET = 800;

/** Same rough token estimate used across the app: ~4 chars/token. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Joins the text of the last `scanDepth` messages (oldest first, in the
 * order given) into a single haystack for key matching. */
export function buildScanText(recentMessages: string[], scanDepth: number = DEFAULT_SCAN_DEPTH): string {
  return recentMessages.slice(-scanDepth).join("\n");
}

/** A single key matches when it's a non-empty substring of the scan text,
 * case-sensitively or not depending on the entry's setting. */
function keyMatches(key: string, scanText: string, caseSensitive: boolean): boolean {
  const needle = key.trim();
  if (!needle) return false;
  if (caseSensitive) return scanText.includes(needle);
  return scanText.toLowerCase().includes(needle.toLowerCase());
}

/** Whether an entry is activated by the given scan text. Disabled entries
 * are never active. `always_on` entries are always active (once enabled).
 * Otherwise any of `keys` matching as a substring activates the entry —
 * `secondary_keys` are not required by this simple scan (selective/AND
 * matching is out of scope for M4, keys-only OR matching per plan §6.4). */
export function isEntryActive(entry: LoreEntryLike, scanText: string): boolean {
  if (!entry.enabled) return false;
  if (entry.alwaysOn) return true;
  return entry.keys.some((k) => keyMatches(k, scanText, entry.caseSensitive));
}

/** Full activation scan: builds the scan text from the last `scanDepth`
 * messages, filters to entries that activate, sorts by priority descending,
 * and takes as many (in that order) as fit within `tokenBudget`. Stops at
 * the first entry that would overflow the budget rather than skipping it
 * for a smaller later one, so higher-priority content always wins. */
export function selectActiveEntries(
  entries: LoreEntryLike[],
  recentMessages: string[],
  options: ActivationOptions = {},
): LoreEntryLike[] {
  const scanDepth = options.scanDepth ?? DEFAULT_SCAN_DEPTH;
  const tokenBudget = options.tokenBudget ?? DEFAULT_TOKEN_BUDGET;
  const scanText = buildScanText(recentMessages, scanDepth);

  const active = entries.filter((e) => isEntryActive(e, scanText));
  active.sort((a, b) => b.priority - a.priority);

  const selected: LoreEntryLike[] = [];
  let used = 0;
  for (const entry of active) {
    const cost = estimateTokens(entry.content);
    if (used + cost > tokenBudget) break;
    selected.push(entry);
    used += cost;
  }
  return selected;
}
