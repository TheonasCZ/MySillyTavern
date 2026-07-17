/**
 * Parses game tags from AI responses — inventory mutations and skill changes.
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

interface ParsedTags {
  cleanText: string;
  mutations: InvMutation[];
  skillChanges: SkillMutation[];
}

export function parseGameTags(text: string): ParsedTags {
  const mutations: InvMutation[] = [];
  const skillChanges: SkillMutation[] = [];

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

  return { cleanText, mutations, skillChanges };
}