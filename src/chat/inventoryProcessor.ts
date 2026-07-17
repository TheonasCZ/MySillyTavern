import type { Persona } from "../db/repositories/personasRepo";
import { updatePersona, updatePersonaXpLevel } from "../db/repositories/personasRepo";
import { createFaction, listFactions, updateReputation } from "../db/repositories/factionsRepo";
import { addQuestNote, createQuest, getQuestByName, updateQuestStatus } from "../db/repositories/questsRepo";
import { advanceAndPersistCalendar } from "../memory/memoryEngine";
import { createRecipe, getRecipeByResult, updateRecipePerks } from "../db/repositories/craftingRepo";
import { parseGameTags } from "./inventoryTags";

/** Tag validation feedback — stored across turns so the next prompt can
 *  warn the AI about malformed tags from the previous response. */
let lastTagErrors: string[] = [];
export function getLastTagErrors(): string[] { return lastTagErrors; }
export function clearTagErrors(): void { lastTagErrors = []; }

/** Parses game tags (inventory + skill + level + faction) from the AI response,
 *  updates the persona in DB, and returns the cleaned text. */
export async function processGameResponse(
  persona: Persona | null,
  text: string,
  chatId?: string,
): Promise<string> {
  if (!persona) return text;
  const { cleanText, mutations, skillChanges, levelChanges, factionMutations, craftMutations, craftedMutations, conditionMutations, questMutations, timeMutations } = parseGameTags(text);
  if (mutations.length === 0 && skillChanges.length === 0 && levelChanges.length === 0 && factionMutations.length === 0 && craftMutations.length === 0 && craftedMutations.length === 0 && conditionMutations.length === 0 && questMutations.length === 0 && timeMutations.length === 0) return text;

  // Apply time mutations: [TIME:+Nd] advances the calendar by N days each.
  if (chatId) {
    for (const tm of timeMutations) {
      try {
        for (let i = 0; i < tm.days; i++) await advanceAndPersistCalendar(chatId);
      } catch {
        // Non-critical
      }
    }
  }

  // Apply quest mutations: [QUEST:+name] / [QUEST:✓name] / [QUEST:-name] / [QUEST:name: note]
  if (chatId) {
    for (const qm of questMutations) {
      try {
        const existing = await getQuestByName(chatId, qm.name);
        if (qm.op === "start") {
          if (!existing) await createQuest({ chatId, name: qm.name, description: qm.note });
        } else if (qm.op === "complete" || qm.op === "fail") {
          const quest = existing ?? (await createQuest({ chatId, name: qm.name }));
          await updateQuestStatus(quest.id, qm.op === "complete" ? "completed" : "failed");
          if (qm.note) await addQuestNote(quest.id, qm.note);
        } else if (qm.op === "note") {
          const quest = existing ?? (await createQuest({ chatId, name: qm.name }));
          if (qm.note) await addQuestNote(quest.id, qm.note);
        }
      } catch {
        // Non-critical
      }
    }
  }

  // Apply condition mutations: [COND:+name] / [COND:+name:duration] / [COND:-name]
  const conditions = persona.conditions ? [...persona.conditions.map((c) => ({ ...c }))] : [];
  for (const cm of conditionMutations) {
    const idx = conditions.findIndex((c) => c.name.toLowerCase() === cm.name.toLowerCase());
    if (cm.op === "add") {
      if (idx === -1) {
        conditions.push({
          name: cm.name,
          description: [cm.description, cm.duration].filter(Boolean).join(" — "),
          expiresAt: null,
        });
      }
    } else if (idx !== -1) {
      conditions.splice(idx, 1);
    }
  }

  // Apply inventory mutations
  const inv = persona.inventory ? [...persona.inventory.map((i) => ({ ...i }))] : [];
  const newlyAddedItems: string[] = [];
  for (const m of mutations) {
    const existing = inv.find((i) => i.item.toLowerCase() === m.item.toLowerCase());
    if (m.op === "add") {
      if (existing) {
        existing.qty += m.qty;
      } else {
        inv.push({ item: m.item, qty: m.qty });
        newlyAddedItems.push(m.item);
      }
    } else {
      if (existing) {
        existing.qty -= m.qty;
        if (existing.qty <= 0) inv.splice(inv.indexOf(existing), 1);
      }
    }
  }

  // Apply skill mutations
  const skills = persona.skills ? [...persona.skills.map((s) => ({ ...s }))] : [];
  for (const s of skillChanges) {
    const existing = skills.find((sk) => sk.name.toLowerCase() === s.name.toLowerCase());
    if (s.absolute !== null) {
      // Absolute set: [SKILL:+name:3]
      if (existing) {
        existing.level = s.absolute;
      } else {
        skills.push({ name: s.name, level: s.absolute });
      }
    } else if (s.delta > 0) {
      // Relative increase: [SKILL:name+2] or [SKILL:+name]
      if (existing) {
        existing.level += s.delta;
      } else {
        skills.push({ name: s.name, level: s.delta });
      }
    } else {
      // Decrease: [SKILL:name-1] — remove if <= 0
      if (existing) {
        existing.level = Math.max(0, existing.level + s.delta);
        if (existing.level <= 0) skills.splice(skills.indexOf(existing), 1);
      }
    }
  }

  // Apply level mutations
  let xp = persona.xp ?? 0;
  let level = persona.level ?? 1;
  let hasLevelChanges = false;
  for (const lc of levelChanges) {
    if (lc.xpDelta > 0) { xp += lc.xpDelta; hasLevelChanges = true; }
    if (lc.levelDelta > 0) { level += lc.levelDelta; hasLevelChanges = true; }
  }

  // Apply faction mutations
  for (const fm of factionMutations) {
    if (fm.showOnly) continue; // show-only tags are no-ops at processing time
    try {
      const existing = await listFactions(persona.id);
      const match = existing.find(
        (f) => f.factionName.toLowerCase() === fm.name.toLowerCase(),
      );
      if (match) {
        await updateReputation(match.id, fm.delta);
      } else {
        await createFaction(persona.id, fm.name, fm.delta);
      }
    } catch {
      // Non-critical
    }
  }

  // Apply craft mutations: [CRAFT:result:ingredient1+ingredient2]
  for (const cm of craftMutations) {
    try {
      // Create the recipe in DB (or skip if already known)
      const existing = await getRecipeByResult(persona.id, cm.resultItem);
      if (!existing) {
        // Determine tier based on skill level (AI may set later, default 0)
        const relatedSkill = persona.skills?.find(
          (s) => cm.ingredients.some((ing) =>
            ing.toLowerCase().includes(s.name.toLowerCase().slice(0, 4)) ||
            s.name.toLowerCase().includes("alchymie")
          )
        );
        // Try to infer skill name from context (default "Alchymie" for potions, "Kovářství" for weapons)
        let inferredSkill = relatedSkill?.name ?? null;
        if (!inferredSkill && cm.resultItem.toLowerCase().includes("lektvar")) inferredSkill = "Alchymie";
        else if (!inferredSkill && cm.resultItem.toLowerCase().includes("jed")) inferredSkill = "Alchymie";
        else if (!inferredSkill) inferredSkill = "Kovářství";

        await createRecipe({
          personaId: persona.id,
          resultItem: cm.resultItem,
          ingredients: cm.ingredients,
          skillName: inferredSkill,
          tier: 0,
        });
      }
      // Consume ingredients from inventory (always consumed, even on failure)
      for (const ing of cm.ingredients) {
        const entry = inv.find((i) => i.item.toLowerCase() === ing.toLowerCase());
        if (entry) {
          entry.qty -= 1;
          if (entry.qty <= 0) inv.splice(inv.indexOf(entry), 1);
        }
      }
    } catch {
      // Non-critical
    }
  }

  // Apply crafted mutations: [CRAFTED:result] or [CRAFTED:result:perk1+perk2]
  for (const cdm of craftedMutations) {
    try {
      // Add the crafted item to inventory
      const existingItem = inv.find((i) => i.item.toLowerCase() === cdm.resultItem.toLowerCase());
      if (existingItem) {
        existingItem.qty += 1;
      } else {
        inv.push({ item: cdm.resultItem, qty: 1 });
        newlyAddedItems.push(cdm.resultItem);
      }
      // Update the recipe's perks
      const recipe = await getRecipeByResult(persona.id, cdm.resultItem);
      if (recipe) {
        await updateRecipePerks(recipe.id, cdm.perks);
      }
    } catch {
      // Non-critical
    }
  }

  try {
    await updatePersona(persona.id, {
      name: persona.name,
      gender: persona.gender,
      age: persona.age,
      race: persona.race,
      appearance: persona.appearance,
      progression: persona.progression,
      skills,
      inventory: inv,
      conditions,
    });
    if (hasLevelChanges) {
      await updatePersonaXpLevel(persona.id, xp, level);
    }
  } catch {
    // Non-critical
  }

  // Auto-illustration trigger: enqueue newly added inventory items that
  // don't have an image yet (queue itself checks image_gen_enabled/limit).
  if (newlyAddedItems.length > 0) {
    try {
      const { enqueueIllustration } = await import("../memory/imageGenQueue");
      for (const itemName of newlyAddedItems) {
        enqueueIllustration("inventory", persona.id, `Fantasy game item icon: ${itemName}`, itemName);
      }
    } catch {
      // Non-critical
    }
  }

  // Tag validation: warn about excessive or malformed tags in next prompt
  const totalTags = mutations.length + skillChanges.length + levelChanges.length +
    factionMutations.length + craftMutations.length + craftedMutations.length +
    conditionMutations.length + questMutations.length;
  lastTagErrors = [];
  if (totalTags > 5) {
    lastTagErrors.push(`Příliš mnoho tagů v jedné odpovědi (${totalTags}). Maximum je 3–5. Rozděl změny do více odpovědí.`);
  }
  if (totalTags === 0 && cleanText.length > 2000) {
    lastTagErrors.push("Dlouhá odpověď bez tagů. Pokud došlo ke změně inventáře, dovedností, questů nebo frakcí, použij odpovídající tagy.");
  }

  return cleanText;
}
