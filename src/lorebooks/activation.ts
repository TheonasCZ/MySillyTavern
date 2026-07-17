/** Lorebook activation scan (plan §6.4, extended M27). Pure logic, no DB/Tauri
 * dependency on purpose — this module is unit-tested with vitest without
 * booting the Tauri runtime. Callers (chatStore / systemPrompt glue) load
 * entries via `db/repositories/lorebooksRepo.ts` and pass plain data in. */

export interface SelectiveKey {
  key: string;
  logic: "AND" | "NOT";
}

export interface TimedEffect {
  sticky?: number;
  cooldown?: number;
  delay?: number;
}

export interface LoreEntryLike {
  id: string;
  keys: string[];
  secondaryKeys: string[];
  content: string;
  priority: number;
  alwaysOn: boolean;
  caseSensitive: boolean;
  enabled: boolean;
  /** When true, this entry's keys can recursively activate other entries. */
  recursiveActivation: boolean;
  /** Max recursion depth (default 1, clamped ≥ 1). */
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

export interface ActivationOptions {
  /** How many of the most recent messages to scan for keys. Default 4
   * (`lore_scan_depth` setting). */
  scanDepth?: number;
  /** Token budget for activated entry content. Default 800
   * (`lore_token_budget` setting). */
  tokenBudget?: number;
}

/** Per-chat timed-effect state tracked across invocations. Callers persist
 * this however they like (chat metadata, separate table, etc.). */
export interface TimedState {
  /** entryId -> message index when the entry last activated. */
  lastActivated: Record<string, number>;
  /** entryId -> message index when the entry's cooldown expires. */
  cooldownUntil: Record<string, number>;
  /** entryId -> message index when a delayed activation should fire. */
  delayedUntil: Record<string, number>;
}

export interface VectorActivationInput {
  /** Entry ids that are candidates for vector activation, with their
   * similarity score against the query (0..1). Only entries whose score
   * meets the entry's own `vectorThreshold` qualify. */
  scoredEntries: { entryId: string; score: number }[];
}

export interface ActivationResult {
  /** Activated entries, sorted priority-descending, within token budget. */
  entries: LoreEntryLike[];
  /** Entry ids that were activated via vector similarity. */
  vectorActivatedIds: string[];
  /** Entry ids that were activated via recursive scan. */
  recursiveActivatedIds: string[];
}

export const DEFAULT_SCAN_DEPTH = 4;
export const DEFAULT_TOKEN_BUDGET = 800;

/** Same rough token estimate used across the app: chars/4 rounded up. */
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

// ---- Selective AND/NOT logic -----------------------------------------------

/** Checks whether an entry's selective secondary keys gate passes.
 * - AND keys: ALL must be present in the scan text.
 * - NOT keys: NONE may be present in the scan text.
 * - Mixed: both conditions must hold.
 * If `selectiveKeys` is empty, the entry passes unconditionally. */
export function checkSelectiveKeys(
  entry: Pick<LoreEntryLike, "selectiveKeys" | "caseSensitive">,
  scanText: string,
): boolean {
  if (entry.selectiveKeys.length === 0) return true;
  const cs = entry.caseSensitive;
  for (const sk of entry.selectiveKeys) {
    const matches = keyMatches(sk.key, scanText, cs);
    if (sk.logic === "AND" && !matches) return false;
    if (sk.logic === "NOT" && matches) return false;
  }
  return true;
}

// ---- Core activation check -------------------------------------------------

/** Whether an entry is activated by the given scan text. Disabled entries
 * are never active. `always_on` entries are always active (once enabled).
 * Otherwise any of `keys` matching as a substring activates the entry —
 * but only if the selective secondary keys gate also passes. */
export function isEntryActive(entry: LoreEntryLike, scanText: string): boolean {
  if (!entry.enabled) return false;
  if (entry.alwaysOn) return true;
  // Primary key match + selective gate
  const primaryMatch = entry.keys.some((k) => keyMatches(k, scanText, entry.caseSensitive));
  if (!primaryMatch) return false;
  return checkSelectiveKeys(entry, scanText);
}

// ---- Timed effects ---------------------------------------------------------

/** Applies timed effects to an activation decision, returning whether the
 * entry should activate at message index `msgIndex` given `state`.
 *
 * Rules (applied in order):
 * 1. **Cooldown**: if `msgIndex < cooldownUntil[entryId]`, blocked.
 * 2. **Delay**: if `delayedUntil[entryId]` is set and `msgIndex < delayedUntil`,
 *    activation is deferred (returns false).
 * 3. **Sticky**: if `lastActivated[entryId]` is set and
 *    `msgIndex < lastActivated + sticky`, the entry activates even without a
 *    fresh key match (caller should bypass the key check).
 *
 * This function does NOT mutate `state` — the caller updates it after
 * activation is confirmed. */
export function evaluateTimedGate(
  entryId: string,
  state: TimedState,
  msgIndex: number,
): "blocked" | "deferred" | "allowed" | "sticky_active" {
  // Cooldown blocks activation entirely.
  if (state.cooldownUntil[entryId] !== undefined && msgIndex < state.cooldownUntil[entryId]) {
    return "blocked";
  }
  // Delay defers activation.
  if (state.delayedUntil[entryId] !== undefined && msgIndex < state.delayedUntil[entryId]) {
    return "deferred";
  }
  // Sticky keeps the entry active after it first fires.
  // (The caller must check this *before* the key-match test.)
  return "allowed";
}

/** Returns true when a sticky entry is still within its stickiness window. */
export function isStickyActive(
  entryId: string,
  state: TimedState,
  msgIndex: number,
  timed: TimedEffect,
): boolean {
  if (!timed.sticky || timed.sticky <= 0) return false;
  const last = state.lastActivated[entryId];
  if (last === undefined) return false;
  return msgIndex < last + timed.sticky;
}

/** Updates `state` after an entry activates at `msgIndex`. */
export function recordActivation(
  state: TimedState,
  entryId: string,
  timed: TimedEffect | null,
  msgIndex: number,
): void {
  if (!timed) return;
  state.lastActivated[entryId] = msgIndex;
  if (timed.cooldown && timed.cooldown > 0) {
    state.cooldownUntil[entryId] = msgIndex + timed.cooldown;
  }
  if (timed.delay && timed.delay > 0) {
    state.delayedUntil[entryId] = msgIndex + timed.delay;
  }
}

// ---- Recursive activation --------------------------------------------------

/** Recursively activates entries: after an entry fires, if it has
 * `recursiveActivation === true`, scan remaining (not-yet-activated)
 * entries for key matches against the activated entry's keys.
 * Cycle detection via `activatedIds` set; depth limit via `depthLeft`. */
function collectRecursive(
  entries: LoreEntryLike[],
  activatedIds: Set<string>,
  seedKeys: string[],
  
  depthLeft: number,
  scanText: string,
): void {
  if (depthLeft <= 0) return;
  for (const entry of entries) {
    if (activatedIds.has(entry.id)) continue;
    if (!entry.enabled) continue;
    // Recursive activation uses the seed keys, not entry's own keys.
    const hit = seedKeys.some((k) => keyMatches(k, scanText, entry.caseSensitive));
    if (!hit) continue;
    // Selective gate still applies.
    if (!checkSelectiveKeys(entry, scanText)) continue;
    activatedIds.add(entry.id);
    // If this entry itself is recursive, cascade further.
    if (entry.recursiveActivation) {
      collectRecursive(
        entries,
        activatedIds,
        entry.keys,
        depthLeft - 1,
        scanText,
      );
    }
  }
}

// ---- Vector-based activation -----------------------------------------------

/** Selects entries that should activate via vector similarity. Respects each
 * entry's `vectorThreshold` and the global `vectorBudget`. */
export function selectVectorActivated(
  entries: LoreEntryLike[],
  vectorInput: VectorActivationInput,
): LoreEntryLike[] {
  const scored = new Map(vectorInput.scoredEntries.map((s) => [s.entryId, s.score]));
  const candidates = entries.filter((e) => {
    if (!e.enabled || e.alwaysOn) return false;
    if (e.vectorThreshold === null) return false;
    const score = scored.get(e.id);
    return score !== undefined && score >= e.vectorThreshold;
  });
  // Sort by score descending, then apply budget.
  candidates.sort((a, b) => {
    const sa = scored.get(a.id) ?? 0;
    const sb = scored.get(b.id) ?? 0;
    return sb - sa;
  });
  const budgets = candidates.map((e) => e.vectorBudget).filter((b) => b > 0);
  const budget = budgets.length > 0 ? Math.min(...budgets) : 2;
  return candidates.slice(0, budget);
}

// ---- Full activation scan --------------------------------------------------

/** Full activation scan: builds the scan text from the last `scanDepth`
 * messages, filters to entries that activate (keyword + selective), applies
 * recursive activation, timed effects, and vector activation, sorts by
 * priority descending, and takes as many (in that order) as fit within
 * `tokenBudget`. Stops at the first entry that would overflow the budget
 * rather than skipping it for a smaller later one, so higher-priority
 * content always wins. */
export function selectActiveEntries(
  entries: LoreEntryLike[],
  recentMessages: string[],
  options: ActivationOptions = {},
  timedState?: TimedState,
  msgIndex?: number,
  vectorInput?: VectorActivationInput,
): ActivationResult {
  const scanDepth = options.scanDepth ?? DEFAULT_SCAN_DEPTH;
  const tokenBudget = options.tokenBudget ?? DEFAULT_TOKEN_BUDGET;
  const scanText = buildScanText(recentMessages, scanDepth);

  // ---- Phase 1: keyword + selective activation ----
  const activatedIds = new Set<string>();
  const directlyActivated: LoreEntryLike[] = [];

  for (const entry of entries) {
    if (activatedIds.has(entry.id)) continue;

    // Always-on bypasses everything.
    if (entry.alwaysOn && entry.enabled) {
      activatedIds.add(entry.id);
      directlyActivated.push(entry);
      continue;
    }

    if (!entry.enabled) continue;

    // Timed: check sticky first (activates without key match).
    if (timedState && msgIndex !== undefined && entry.timed) {
      const gate = evaluateTimedGate(entry.id, timedState, msgIndex);
      if (gate === "blocked") continue;
      if (gate === "deferred") continue;
      // If sticky is active, bypass key check.
      if (isStickyActive(entry.id, timedState, msgIndex, entry.timed)) {
        activatedIds.add(entry.id);
        directlyActivated.push(entry);
        recordActivation(timedState, entry.id, entry.timed, msgIndex);
        continue;
      }
      // For non-sticky entries with delays: if delay is set, defer.
      // (The delay is recorded on activation, so this only matters
      //  for entries that haven't activated yet.)
    }

    // Primary key match.
    if (!isEntryActive(entry, scanText)) continue;

    activatedIds.add(entry.id);
    directlyActivated.push(entry);

    if (timedState && msgIndex !== undefined && entry.timed) {
      recordActivation(timedState, entry.id, entry.timed, msgIndex);
    }
  }

  // ---- Phase 2: recursive activation ----
  const recursiveIds = new Set<string>();
  for (const entry of directlyActivated) {
    if (entry.recursiveActivation && entry.activationDepth > 0) {
      collectRecursive(
        entries,
        activatedIds,
        entry.keys,
        entry.activationDepth,
        scanText,
      );
    }
  }
  // Distinguish which were added recursively.
  for (const id of activatedIds) {
    if (!directlyActivated.some((e) => e.id === id)) {
      recursiveIds.add(id);
    }
  }
  const recursiveActivated = entries.filter((e) => recursiveIds.has(e.id));

  // ---- Phase 3: vector activation ----
  let vectorActivated: LoreEntryLike[] = [];
  if (vectorInput) {
    // Only consider entries not already activated.
    const remaining = entries.filter((e) => !activatedIds.has(e.id));
    vectorActivated = selectVectorActivated(remaining, vectorInput);
    for (const e of vectorActivated) {
      activatedIds.add(e.id);
    }
  }

  // ---- Phase 4: sort, budget, return ----
  const allActive = [
    ...directlyActivated,
    ...recursiveActivated,
    ...vectorActivated,
  ];
  // Deduplicate by id, keeping first occurrence.
  const seen = new Set<string>();
  const unique = allActive.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
  unique.sort((a, b) => b.priority - a.priority);

  const selected: LoreEntryLike[] = [];
  let used = 0;
  for (const entry of unique) {
    const cost = estimateTokens(entry.content);
    if (used + cost > tokenBudget) break;
    selected.push(entry);
    used += cost;
  }

  return {
    entries: selected,
    vectorActivatedIds: vectorActivated.map((e) => e.id),
    recursiveActivatedIds: [...recursiveIds],
  };
}
