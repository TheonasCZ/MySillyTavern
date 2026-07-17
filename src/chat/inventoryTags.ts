/**
 * Parses game tags from AI responses — inventory mutations, skill changes,
 * quest tracking, and level progression tags.
 * 
 * Inventory tags:
 *   [INV:+item_name]              — add item (qty 1)
 *   [INV:-item_name]              — remove item
 *   [INV:+n:item_name]            — add n items
 *   [INV:-n:item_name]            — remove n items
 * 
 * Quest tags:
 *   [QUEST:+name]                 — start a new quest (active)
 *   [QUEST:+name:desc]            — start with initial description
 *   [QUEST:✓name]                 — complete a quest
 *   [QUEST:✗name]                 — fail a quest
 *   [QUEST:name:note]             — add a progress note
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
 * Returns the cleaned text (all tags removed) and parsed mutations.
 */
export interface InvMutation {
  op: "add" | "remove";
  item: string;
  qty: number;
}

export interface QuestMutation {
  action: "start" | "complete" | "fail" | "note";
  name: string;
  /** For 'start' action: optional initial description (before any notes). For 'note': the note text. */
  note?: string;
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

interface ParsedTags {
  cleanText: string;
  mutations: InvMutation[];
  skillChanges: SkillMutation[];
  levelChanges: LevelMutation[];
  questMutations: QuestMutation[];
}

export function parseGameTags(text: string): ParsedTags {
  const mutations: InvMutation[] = [];
  const skillChanges: SkillMutation[] = [];
  const questMutations: QuestMutation[] = [];
  const levelChanges: LevelMutation[] = [];

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

  // Parse quest tags:
  //   [QUEST:+name]                  — start quest
  //   [QUEST:✓name] or [QUEST:✔name] — complete quest
  //   [QUEST:✗name] or [QUEST:✘name] — fail quest
  //   [QUEST:+name:desc]             — start with initial description
  //   [QUEST:name:note]              — progress note (caught separately below)
  cleanText = cleanText.replace(
    /\[QUEST:([+✓✔✗✘])([^:\]]+)(?::([^\]]*))?\]/gi,
    (_m, prefix: string, name: string, extra?: string) => {
      const trimmed = name.trim();
      if (!trimmed) return "";
      if (prefix === "+") {
        questMutations.push({ action: "start", name: trimmed, note: extra?.trim() || undefined });
      } else if (prefix === "✓" || prefix === "✔") {
        questMutations.push({ action: "complete", name: trimmed });
      } else if (prefix === "✗" || prefix === "✘") {
        questMutations.push({ action: "fail", name: trimmed });
      }
      return "";
    },
  );

  // Also handle note-only form: [QUEST:name:note] — name doesn't start with +/✓/✗
  cleanText = cleanText.replace(
    /\[QUEST:([^+\]✓✔✗✘:][^:\]]*):([^\]]+)\]/gi,
    (_m, name: string, note: string) => {
      const trimmedName = name.trim();
      if (!trimmedName) return "";
      questMutations.push({ action: "note", name: trimmedName, note: note.trim() });
      return "";
    },
  );

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

  return { cleanText, mutations, skillChanges, levelChanges, questMutations };
}