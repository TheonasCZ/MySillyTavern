/**
 * Parses game tags from AI responses — inventory mutations, skill changes,
 * level progression, faction reputation, and crafting tags.
 * 
 * Inventory tags:
 *   [INV:+item_name]              — add item (qty 1)
 *   [INV:-item_name]              — remove item
 *   [INV:+n:item_name]            — add n items
 *   [INV:-n:item_name]            — remove n items
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
 * Faction tags:
 *   [FACTION:+name:delta]         — adjust reputation by delta (or create at delta)
 *   [FACTION:name]                — show current reputation (no-op in parsing)
 * 
 * Crafting tags:
 *   [CRAFT:result_name:ingredient1+ingredient2]  — discover recipe (consumes ingredients)
 *   [CRAFTED:result_name]                        — craft item (perks auto by skill)
 *   [CRAFTED:result_name:perk1+perk2]            — craft item with specific perks
 * 
 * Returns the cleaned text (all tags removed) and parsed mutations.
 */
export interface InvMutation {
  op: "add" | "remove";
  item: string;
  qty: number;
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
}

export function parseGameTags(text: string): ParsedTags {
  const mutations: InvMutation[] = [];
  const skillChanges: SkillMutation[] = [];
  const levelChanges: LevelMutation[] = [];
  const factionMutations: FactionMutation[] = [];
  const craftMutations: CraftMutation[] = [];
  const craftedMutations: CraftedMutation[] = [];

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

  return { cleanText, mutations, skillChanges, levelChanges, factionMutations, craftMutations, craftedMutations };
}