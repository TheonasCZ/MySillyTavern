/** Game-tag, faction, and crafting section builders extracted from
 * promptBuilder.ts (§6.2 refactor). Renders the trailing [GAME TAGS],
 * [FACTION REPUTATION], and [CRAFTING] blocks that are appended to the
 * post-history system message (phi). */

import {
  CRAFTING_INSTRUCTIONS_BASE,
  CRAFTING_KNOWN_RECIPES,
  FACTION_INSTRUCTIONS_CHANGES,
  FACTION_INSTRUCTIONS_REACTIONS,
  FACTION_TAG_HINT,
  SECTION_CRAFTING,
  SECTION_FACTIONS,
  SECTION_GAME_TAGS,
  TAG_INSTRUCTIONS_CONDITION_CHANGES,
  TAG_INSTRUCTIONS_CURRENT_CONDITIONS,
  TAG_INSTRUCTIONS_CURRENT_INVENTORY,
  TAG_INSTRUCTIONS_CURRENT_MODIFICATIONS,
  TAG_INSTRUCTIONS_CURRENT_SKILLS,
  TAG_INSTRUCTIONS_INVENTORY_CHANGES,
  TAG_INSTRUCTIONS_LEVEL_CHANGES,
  TAG_INSTRUCTIONS_LEVEL_CURRENT,
  TAG_INSTRUCTIONS_MODIFICATION_CHANGES,
  TAG_INSTRUCTIONS_SKILL_CHANGES,
  TAG_LIST_FOLD_SUFFIX,
  TAG_PLACEMENT_HINT,
} from "./promptTexts";

import type { PersonaLike } from "./promptBuilder";

// ---- Helpers (moved from promptBuilder.ts) -------------------------------

/** Sorts entries by `lastTouched` ascending so the most recently touched
 * entries land at the end of the array (the "most recent" end for
 * `formatCappedList`). Entries without `lastTouched` (legacy data) sort
 * first — they're treated as the oldest and fold first under the cap. */
function sortByLastTouched<T extends { lastTouched?: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const at = a.lastTouched ?? "";
    const bt = b.lastTouched ?? "";
    return at.localeCompare(bt);
  });
}

/** Renders a current-state list (inventory/skills/conditions/modifications)
 * for `[GAME TAGS]`, capping full-detail entries to the most recent
 * `capCount` (recency = `lastTouched` timestamp — see `sortByLastTouched`)
 * and folding any older entries into a trailing names-only clause. Never
 * drops a name, even at `capCount === 0` (design constraint: the model must
 * always be able to confirm/deny a claimed item/skill/condition/modification
 * by name, even with zero detail — see the module doc comment / plan
 * discussion this implements). */
function formatCappedList<T>(
  items: T[],
  fullLabel: (item: T) => string,
  nameOnly: (item: T) => string,
  capCount: number,
): string {
  if (items.length <= capCount) {
    return items.map(fullLabel).join(", ");
  }
  const foldCount = items.length - capCount;
  const folded = items.slice(0, foldCount); // oldest, names only
  const shown = items.slice(foldCount); // most recent, full detail
  const shownStr = shown.map(fullLabel).join(", ");
  const foldedStr = folded.map(nameOnly).join(", ");
  return capCount > 0
    ? `${shownStr}${TAG_LIST_FOLD_SUFFIX(foldCount)}${foldedStr}`
    : foldedStr; // capCount 0: nothing shown in full, just the names-only list
}

// ---- Section builders ----------------------------------------------------

function buildGameTagsSection(
  persona: PersonaLike | null,
  stateListCap: number,
): string {
  const progression = persona?.progression ?? "skill";
  const hasInv = !!persona?.inventory?.length;
  const hasSkills = !!persona?.skills?.length;
  const hasCond = !!persona?.conditions?.length;
  const hasMod = !!persona?.modifications?.length;

  if (
    !hasCond &&
    !hasMod &&
    (progression === "none" || (!hasInv && (progression !== "skill" || !hasSkills)))
  ) {
    return "";
  }

  let tagInstructions = `${SECTION_GAME_TAGS}\n`;
  // Inventory tags always emitted when inventory exists (regardless of progression)
  if (hasInv && persona) {
    const inv = sortByLastTouched(persona.inventory ?? []);
    const list = formatCappedList(
      inv,
      (i) => i.item + (i.qty > 1 ? ` x${i.qty}` : ""),
      (i) => i.item,
      stateListCap,
    );
    tagInstructions += `${TAG_INSTRUCTIONS_CURRENT_INVENTORY} ${list}.\n`;
    tagInstructions += `${TAG_INSTRUCTIONS_INVENTORY_CHANGES}\n`;
  }
  if (progression === "skill" && hasSkills && persona) {
    const sk = sortByLastTouched(persona.skills ?? []);
    const list = formatCappedList(
      sk,
      (s) => `${s.name} ${s.level}`,
      (s) => s.name,
      stateListCap,
    );
    tagInstructions += `${TAG_INSTRUCTIONS_CURRENT_SKILLS} ${list}.\n`;
    tagInstructions += `${TAG_INSTRUCTIONS_SKILL_CHANGES}\n`;
  }
  if (progression === "level") {
    const xp = persona?.xp ?? 0;
    const lvl = persona?.level ?? 1;
    tagInstructions += `${TAG_INSTRUCTIONS_LEVEL_CURRENT(lvl, xp)}\n`;
    tagInstructions += `${TAG_INSTRUCTIONS_LEVEL_CHANGES}\n`;
  }
  if (hasCond && persona) {
    const cond = sortByLastTouched(persona.conditions ?? []);
    const list = formatCappedList(
      cond,
      (c) => c.name + (c.expiresAt ? ` (${c.expiresAt})` : ""),
      (c) => c.name,
      stateListCap,
    );
    tagInstructions += `${TAG_INSTRUCTIONS_CURRENT_CONDITIONS} ${list}.\n`;
    tagInstructions += `${TAG_INSTRUCTIONS_CONDITION_CHANGES}\n`;
  }
  if (hasMod && persona) {
    const mods = sortByLastTouched(persona.modifications ?? []);
    const list = formatCappedList(mods, (m) => m.name, (m) => m.name, stateListCap);
    tagInstructions += `${TAG_INSTRUCTIONS_CURRENT_MODIFICATIONS} ${list}.\n`;
    tagInstructions += `${TAG_INSTRUCTIONS_MODIFICATION_CHANGES}\n`;
  }
  tagInstructions += TAG_PLACEMENT_HINT;
  return tagInstructions;
}

function buildFactionSection(persona: PersonaLike | null): string {
  if (!persona?.factions?.length) return "";
  let factionInstructions = `${SECTION_FACTIONS}\n`;
  factionInstructions += `${FACTION_INSTRUCTIONS_REACTIONS}\n`;
  factionInstructions += `${FACTION_INSTRUCTIONS_CHANGES}\n`;
  factionInstructions += FACTION_TAG_HINT;
  return factionInstructions;
}

function buildCraftingSection(persona: PersonaLike | null): string {
  const hasRecipes = !!persona?.craftingRecipes?.length;
  const hasInv = !!persona?.inventory?.length;
  if (!hasRecipes && !hasInv) return "";

  let craftInstructions = `${SECTION_CRAFTING}\n`;
  craftInstructions += CRAFTING_INSTRUCTIONS_BASE;

  if (hasRecipes && persona) {
    craftInstructions += `\n\n${CRAFTING_KNOWN_RECIPES}\n`;
    for (const r of persona.craftingRecipes ?? []) {
      const crafted = r.craftedAt ? "✓" : "✗";
      const skillHint = r.skillName ? ` (skill: ${r.skillName})` : "";
      const perksStr = r.perks.length > 0 ? ` [perky: ${r.perks.join(", ")}]` : "";
      craftInstructions += `- ${crafted} ${r.resultItem} ← ${r.ingredients.join(" + ")}${skillHint}${perksStr}\n`;
    }
  }

  return craftInstructions;
}

// ---- Main export ---------------------------------------------------------

/** Renders the game-tags, faction, and crafting blocks as a single newline-
 * separated string (ready to be appended to the trailing system message phi).
 * Returns "" when there is nothing to render. */
export function renderGameTags(
  persona: PersonaLike | null,
  stateListCap: number,
): string {
  const sections: string[] = [];
  const tags = buildGameTagsSection(persona, stateListCap);
  if (tags) sections.push(tags);
  const factions = buildFactionSection(persona);
  if (factions) sections.push(factions);
  const crafting = buildCraftingSection(persona);
  if (crafting) sections.push(crafting);
  return sections.join("\n\n");
}
