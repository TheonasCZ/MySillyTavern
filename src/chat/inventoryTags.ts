/**
 * Parses game tags from AI responses — inventory mutations, skill changes,
 * level progression, faction reputation, and crafting tags.
 * 
 * Inventory tags:
 *   [INV:+item_name]              — add item (qty 1)
 *   [INV:-item_name]              — remove item
 *   [INV:+n:item_name]            — add n items
 *   [INV:-n:item_name]            — remove n items
 *   [ITEM:item_name:note]         — replace an EXISTING item's note (e.g.
 *                                    wear/damage/charge state); no-op if the
 *                                    item isn't in the inventory. This is
 *                                    for updating an item's own condition —
 *                                    never use [MOD:...] for that, [MOD:...]
 *                                    is the character's body only.
 *
 * Skill tags:
 *   [SKILL:+name]                 — learn new skill (level 1)
 *   [SKILL:+name:level]           — learn skill at given level
 *   [SKILL:name+n]                — increase skill by n levels
 *   [SKILL:name-n]                — decrease skill by n levels
 * 
 * Level tags:
 *   [LEVEL:+xp]                   — add XP (e.g. [LEVEL:+50])
 *   [LEVEL:+level]                — increase level by 1 (e.g. [LEVEL:+1])
 * 
 * Body modification tags:
 *   [MOD:+popis]                  — add a body modification
 *   [MOD:-popis]                  — remove a body modification
 *
 * Faction tags:
 *   [FACTION:+name:delta]         — adjust reputation by delta (or create at delta)
 *   [FACTION:name]                — show current reputation (no-op in parsing)
 * 
 * Crafting tags:
 *   [CRAFT:result_name:ingredient1+ingredient2]  — discover recipe (consumes ingredients)
 *   [CRAFTED:result_name]                        — craft item (perks auto by skill)
 *   [CRAFTED:result_name:perk1+perk2]            — craft item with specific perks
 *
 * Game over tag (hardcore mode only — see DIRECTOR_HARDCORE_NOTE):
 *   [GAMEOVER:reason]             — the character has died; ends the run
 *
 * Roll-check tag (see RISK AND COST in TWO_ROLES_INSTRUCTIONS):
 *   [CHECK:skill name]            — names whatever expertise is actually
 *                                    relevant to a roll the GM just called
 *                                    for — not restricted to skills the
 *                                    player already has. The app applies a
 *                                    bonus only if it happens to exactly
 *                                    match an existing skill; otherwise the
 *                                    tag is a harmless no-op (no bonus, no
 *                                    new skill created). Omit entirely if
 *                                    nothing in particular applies.
 *
 * Returns the cleaned text (all tags removed) and parsed mutations.
 */
export interface InvMutation {
  op: "add" | "remove";
  item: string;
  qty: number;
}

/** [ITEM:item_name:note] — replaces an existing item's note field (its
 *  condition/description), not its quantity. No-op if the item isn't in
 *  the inventory — see inventoryProcessor.ts. */
export interface ItemNoteMutation {
  item: string;
  note: string;
}

export interface SkillMutation {
  name: string;
  /** Positive = increase, negative = decrease, 0 = set absolute */
  delta: number;
  absolute: number | null; // used for [SKILL:+name:level]
}

export interface LevelMutation {
  xpDelta: number;
  levelDelta: number;
}

export interface ConditionMutation { op: "add" | "remove"; name: string; description?: string; duration?: string; }

/** Body modifications — same shape as ConditionMutation but simpler (no
 *  duration concept: a modification is a lasting change, not a timed effect). */
export interface ModMutation { op: "add" | "remove"; name: string; }

export interface CraftMutation {
  /** Result item name (what this recipe produces). */
  resultItem: string;
  /** List of ingredient names consumed by the recipe. */
  ingredients: string[];
}

export interface CraftedMutation {
  /** Result item name (what was successfully crafted). */
  resultItem: string;
  /** Specific perks chosen by the AI. Empty when perks should be auto-filled. */
  perks: string[];
}

export interface QuestMutation {
  op: "start" | "complete" | "fail" | "note";
  name: string;
  note?: string;
}

/** Relative time advancement only — [TIME:+Nd] / [TIME:+Nh] / [TIME:+Nm].
 *  All three normalize to whole minutes here so callers just sum them. An
 *  absolute-time tag like `[TIME: 14:00]` is still stripped from the
 *  visible text but produces no mutation (nothing to apply it to — we have
 *  no notion of "set the clock to X", only "advance by X"). */
export interface TimeMutation {
  minutes: number;
}

export interface FactionMutation {
  /** Faction name (lowercased for matching). */
  name: string;
  /** Reputation delta (positive = gain, negative = loss). 0 for show-only. */
  delta: number;
  /** True when the tag is just [FACTION:name] (show-only, no mutation). */
  showOnly: boolean;
}

interface ParsedTags {
  cleanText: string;
  mutations: InvMutation[];
  skillChanges: SkillMutation[];
  levelChanges: LevelMutation[];
  factionMutations: FactionMutation[];
  craftMutations: CraftMutation[];
  craftedMutations: CraftedMutation[];
  conditionMutations: ConditionMutation[];
  modMutations: ModMutation[];
  questMutations: QuestMutation[];
  timeMutations: TimeMutation[];
  /** [GAMEOVER:reason] — null unless the response contained one (last one
   *  wins if the model somehow emits more than one). Only ever acted on
   *  when hardcore mode is on — see inventoryProcessor.ts. */
  gameOverReason: string | null;
  /** [CHECK:skill name] — null unless the response named one (last one wins).
   *  Not validated against the actual skills list here — that's done where
   *  it's consumed, same as other tags. */
  checkSkill: string | null;
  itemNoteMutations: ItemNoteMutation[];
}

export function parseGameTags(text: string): ParsedTags {
  const mutations: InvMutation[] = [];
  const itemNoteMutations: ItemNoteMutation[] = [];
  const skillChanges: SkillMutation[] = [];
  const levelChanges: LevelMutation[] = [];
  const factionMutations: FactionMutation[] = [];
  const craftMutations: CraftMutation[] = [];
  const craftedMutations: CraftedMutation[] = [];
  const conditionMutations: ConditionMutation[] = [];
  const modMutations: ModMutation[] = [];
  const questMutations: QuestMutation[] = [];
  const timeMutations: TimeMutation[] = [];
  let gameOverReason: string | null = null;
  let checkSkill: string | null = null;

  let cleanText = text;

  // Parse inventory tags: [INV:+/-item]
  cleanText = cleanText.replace(/\[INV:([+-])(\d+:)?([^\]]+)\]/gi, (_m, op: string, qtyPrefix: string | undefined, item: string) => {
    let qty = 1;
    if (qtyPrefix) {
      const n = parseInt(qtyPrefix.replace(":", ""), 10);
      if (!isNaN(n) && n > 0) qty = n;
    }
    mutations.push({ op: op === "+" ? "add" : "remove", item: item.trim(), qty });
    return "";
  });

  // Parse item-note tags: [ITEM:item_name:note] — updates an existing
  // item's note (condition/wear), never its quantity. See ItemNoteMutation.
  cleanText = cleanText.replace(/\[ITEM:([^:\]]+):([^\]]+)\]/gi, (_m, item: string, note: string) => {
    itemNoteMutations.push({ item: item.trim(), note: note.trim() });
    return "";
  });

  // Parse skill tags:
  //   [SKILL:+name] or [SKILL:+name:level]
  //   [SKILL:name+n] or [SKILL:name-n]
  cleanText = cleanText.replace(/\[SKILL:([+-])([^+\-\]:]+)(?::(\d+))?\]/gi, (_m, op: string, name: string, levelStr?: string) => {
    const absolute = levelStr ? parseInt(levelStr, 10) : null;
    skillChanges.push({
      name: name.trim(),
      delta: op === "+" ? 1 : -1,
      absolute,
    });
    return "";
  });

  // Also handle relative: [SKILL:name+n] or [SKILL:name-n]
  cleanText = cleanText.replace(/\[SKILL:([^+\-\]]+)([+-])(\d+)\]/gi, (_m, name: string, op: string, nStr: string) => {
    skillChanges.push({
      name: name.trim(),
      delta: op === "+" ? parseInt(nStr, 10) : -parseInt(nStr, 10),
      absolute: null,
    });
    return "";
  });

  // Also handle progress-style, no +/- at all: [SKILL: name 3/10] — sets the
  // absolute level to the first number (models often write this instead of
  // the documented forms above).
  cleanText = cleanText.replace(/\[SKILL:\s*([^\]:+-]+?)\s+(\d+)\s*\/\s*\d+\s*\]/gi, (_m, name: string, levelStr: string) => {
    skillChanges.push({
      name: name.trim(),
      delta: 0,
      absolute: parseInt(levelStr, 10),
    });
    return "";
  });

  // Parse level tags: [LEVEL:+xp]
  cleanText = cleanText.replace(/\[LEVEL:\+(\d+)\]/gi, (_m, nStr: string) => {
    const n = parseInt(nStr, 10);
    if (!isNaN(n) && n > 0) {
      levelChanges.push({ xpDelta: n, levelDelta: 0 });
    }
    return "";
  });

  // Parse faction tags:
  //   [FACTION:+name:delta] or [FACTION:-name:delta] — adjust reputation
  //   [FACTION:name]                             — show-only
  cleanText = cleanText.replace(/\[FACTION:([+-]?)([^+\-\]:]+?)(?::(-?\d+))?\]/gi, (_m, op: string, name: string, deltaStr?: string) => {
    const trimmedName = name.trim();
    if (!op && !deltaStr) {
      // [FACTION:name] — show only, no mutation
      factionMutations.push({ name: trimmedName, delta: 0, showOnly: true });
    } else {
      const delta = deltaStr ? parseInt(deltaStr, 10) : 0;
      if (delta !== 0) {
        factionMutations.push({ name: trimmedName, delta, showOnly: false });
      }
    }
    return "";
  });

  // Parse CRAFTED tags first (more specific) before CRAFT tags:
  //   [CRAFTED:result_name]              — crafted with auto perks
  //   [CRAFTED:result_name:perk1+perk2]  — crafted with specific perks
  cleanText = cleanText.replace(/\[CRAFTED:([^:\]]+?)(?::([^:\]]+?))?\]/gi, (_m, resultItem: string, perksStr?: string) => {
    const perks = perksStr
      ? perksStr.split("+").map((p) => p.trim()).filter(Boolean)
      : [];
    craftedMutations.push({ resultItem: resultItem.trim(), perks });
    return "";
  });

  // Parse CRAFT tags:
  //   [CRAFT:result_name:ingredient1+ingredient2]  — discover recipe
  cleanText = cleanText.replace(/\[CRAFT:([^:\]]+?):([^:\]]+?)\]/gi, (_m, resultItem: string, ingredientsStr: string) => {
    const ingredients = ingredientsStr.split("+").map((i) => i.trim()).filter(Boolean);
    if (ingredients.length > 0) {
      craftMutations.push({ resultItem: resultItem.trim(), ingredients });
    }
    return "";
  });

  // Parse quest tags — the prompt documents [QUEST:+name] (start) and
  // [QUEST:✓name] (complete), but models often emit loose variants like
  // [QUEST: Name (aktivní)] or [QUEST:name: note], so parse tolerantly:
  //   [QUEST:+name]            — start
  //   [QUEST:✓name] [QUEST:xname] — complete
  //   [QUEST:-name]            — fail
  //   [QUEST:name: note]       — progress note
  //   [QUEST:name (aktivní)]   — start (status suffix)
  cleanText = cleanText.replace(/\[QUEST:\s*([+✓x-]?)\s*([^\]]+)\]/gi, (_m, op: string, rest: string) => {
    let name = rest.trim();
    let note: string | undefined;
    const colonIdx = name.indexOf(":");
    if (colonIdx !== -1) {
      note = name.slice(colonIdx + 1).trim() || undefined;
      name = name.slice(0, colonIdx).trim();
    }
    // Status suffix like "(aktivní)" / "(splněno)" / "(failed)" wins over
    // a missing op prefix.
    let suffixOp: QuestMutation["op"] | null = null;
    const suffix = name.match(/\(([^)]+)\)\s*$/);
    if (suffix) {
      const s = suffix[1].toLowerCase();
      if (/akt|start|new|nov/.test(s)) suffixOp = "start";
      else if (/spln|dokon|complet|done|hotov/.test(s)) suffixOp = "complete";
      else if (/selh|fail|neúsp|neusp/.test(s)) suffixOp = "fail";
      if (suffixOp) name = name.slice(0, suffix.index).trim();
    }
    if (!name) return "";
    const mappedOp: QuestMutation["op"] =
      op === "+" ? "start"
      : op === "✓" || op.toLowerCase() === "x" ? "complete"
      : op === "-" ? "fail"
      : suffixOp ?? (note ? "note" : "start");
    questMutations.push({ op: mappedOp, name, note });
    return "";
  });

  // Parse condition tags: [COND:+name], [COND:+name:duration], [COND:-name]
  cleanText = cleanText.replace(/\[COND:\s*([+-])\s*([^:\]]+)(?::([^\]]+))?\]/gi, (_m, op: string, name: string, duration?: string) => {
    conditionMutations.push({
      op: op === "+" ? "add" : "remove",
      name: name.trim(),
      duration: duration?.trim() || undefined,
    });
    return "";
  });

  // Parse body modification tags: [MOD:+popis], [MOD:-popis] — same shape as
  // [COND:...] but no duration variant (modifications are permanent changes).
  cleanText = cleanText.replace(/\[MOD:\s*([+-])\s*([^\]]+)\]/gi, (_m, op: string, name: string) => {
    modMutations.push({
      op: op === "+" ? "add" : "remove",
      name: name.trim(),
    });
    return "";
  });

  // Parse time tags: [TIME:+Nd] / [TIME:+Nh] / [TIME:+Nm] advance the
  // calendar by N days/hours/minutes. Any other [TIME:...] content (e.g. an
  // absolute clock time like "14:00", which we have no way to "set to") is
  // stripped but produces no mutation.
  cleanText = cleanText.replace(/\[TIME:\s*([^\]]*)\]/gi, (_m, inner: string) => {
    const trimmed = inner.trim();
    const dMatch = trimmed.match(/^\+(\d+)\s*d$/i);
    const hMatch = trimmed.match(/^\+(\d+)\s*h$/i);
    const mMatch = trimmed.match(/^\+(\d+)\s*m$/i);
    if (dMatch) timeMutations.push({ minutes: parseInt(dMatch[1], 10) * 1440 });
    else if (hMatch) timeMutations.push({ minutes: parseInt(hMatch[1], 10) * 60 });
    else if (mMatch) timeMutations.push({ minutes: parseInt(mMatch[1], 10) });
    return "";
  });

  // Parse the game-over tag: [GAMEOVER:reason] — hardcore mode only.
  cleanText = cleanText.replace(/\[GAMEOVER:([^\]]+)\]/gi, (_m, reason: string) => {
    gameOverReason = reason.trim();
    return "";
  });

  // Parse the roll-check tag: [CHECK:skill name] — see RISK AND COST.
  cleanText = cleanText.replace(/\[CHECK:([^\]]+)\]/gi, (_m, skill: string) => {
    checkSkill = skill.trim();
    return "";
  });

  return { cleanText, mutations, skillChanges, levelChanges, factionMutations, craftMutations, craftedMutations, conditionMutations, modMutations, questMutations, timeMutations, gameOverReason, checkSkill, itemNoteMutations };
}