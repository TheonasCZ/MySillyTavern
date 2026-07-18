import type { Persona } from "../db/repositories/personasRepo";
import {
  getChatConditions,
  getChatInventory,
  getChatModifications,
  getChatSkills,
  getChatXpLevel,
  setChatConditions,
  setChatInventory,
  setChatModifications,
  setChatSkills,
  setChatXpLevel,
} from "../db/repositories/chatsRepo";
import { nowIso } from "../db/database";
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
  const { cleanText, mutations, skillChanges, levelChanges, factionMutations, craftMutations, craftedMutations, conditionMutations, modMutations, questMutations, timeMutations } = parseGameTags(text);
  if (mutations.length === 0 && skillChanges.length === 0 && levelChanges.length === 0 && factionMutations.length === 0 && craftMutations.length === 0 && craftedMutations.length === 0 && conditionMutations.length === 0 && modMutations.length === 0 && questMutations.length === 0 && timeMutations.length === 0) return text;

  // Diagnostic messages for mutations that targeted state that doesn't
  // actually exist (missing item, never-learned skill, nonexistent
  // condition/modification, quest completed without being started). These
  // are purely local DB-lookup checks — no extra API/LLM cost — appended to
  // lastTagErrors below so the AI gets course-correction feedback next turn.
  // The underlying mutations remain safe no-ops; only this diagnostic is new.
  const staleTargetErrors: string[] = [];

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
          if (!existing) {
            staleTargetErrors.push(`Tag [QUEST:${qm.op === "complete" ? "✓" : "-"}${qm.name}] se pokusil dokončit quest "${qm.name}", který nikdy nebyl založen tagem [QUEST:+${qm.name}]. Nejdřív quest založ, pak ho dokonči.`);
          }
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
  // Chat-scoped, mirrors inventory — conditions live on the chat/campaign
  // now, not the persona. Without a chatId there's nowhere to apply them.
  const conditions = chatId ? (await getChatConditions(chatId)).map((c) => ({ ...c })) : [];
  if (chatId) {
    for (const cm of conditionMutations) {
      const idx = conditions.findIndex((c) => c.name.toLowerCase() === cm.name.toLowerCase());
      if (cm.op === "add") {
        if (idx === -1) {
          conditions.push({
            name: cm.name,
            description: [cm.description, cm.duration].filter(Boolean).join(" — "),
            expiresAt: null,
            lastTouched: nowIso(),
          });
        }
      } else if (idx !== -1) {
        conditions.splice(idx, 1);
      } else {
        staleTargetErrors.push(`Tag [COND:-${cm.name}] se pokusil odebrat stav "${cm.name}", který postava nemá. Odebírej jen stavy, které aktuálně existují.`);
      }
    }
  }

  // Apply body modification mutations: [MOD:+popis] / [MOD:-popis] —
  // chat-scoped, mirrors conditions above. Always campaign-specific — no
  // persona template equivalent, so without a chatId there's nowhere to
  // apply them.
  const modifications = chatId ? (await getChatModifications(chatId)).map((m) => ({ ...m })) : [];
  if (chatId) {
    for (const mm of modMutations) {
      const idx = modifications.findIndex((m) => m.name.toLowerCase() === mm.name.toLowerCase());
      if (mm.op === "add") {
        if (idx === -1) {
          modifications.push({ name: mm.name, description: mm.name, lastTouched: nowIso() });
        }
      } else if (idx !== -1) {
        modifications.splice(idx, 1);
      } else {
        staleTargetErrors.push(`Tag [MOD:-${mm.name}] se pokusil odebrat úpravu "${mm.name}", kterou postava nemá. Odebírej jen úpravy, které aktuálně existují.`);
      }
    }
  }

  // Apply inventory mutations — chat-scoped, mirrors quests (inventory
  // lives on the chat/campaign now, not the persona). Without a chatId
  // there's nowhere to apply them, so inventory/craft tags are simply
  // skipped (same as the previous no-op-without-persona behaviour).
  const inv = chatId ? (await getChatInventory(chatId)).map((i) => ({ ...i })) : [];
  const newlyAddedItems: string[] = [];
  if (chatId) {
    for (const m of mutations) {
      const existing = inv.find((i) => i.item.toLowerCase() === m.item.toLowerCase());
      if (m.op === "add") {
        if (existing) {
          existing.qty += m.qty;
          existing.lastTouched = nowIso();
        } else {
          inv.push({ item: m.item, qty: m.qty, lastTouched: nowIso() });
          newlyAddedItems.push(m.item);
        }
      } else {
        if (existing) {
          if (existing.qty < m.qty) {
            staleTargetErrors.push(`Tag [INV:-${m.qty}:${m.item}] se pokusil odebrat víc kusů "${m.item}" (${m.qty}), než hráč má (${existing.qty}). Odebírej jen tolik, kolik je skutečně v inventáři.`);
          }
          existing.qty -= m.qty;
          if (existing.qty <= 0) inv.splice(inv.indexOf(existing), 1);
        } else {
          staleTargetErrors.push(`Tag [INV:-${m.item}] se pokusil odebrat předmět "${m.item}", který hráč nemá v inventáři. Odebírej jen předměty, které tam skutečně jsou.`);
        }
      }
    }
  }

  // Apply skill mutations — chat-scoped, mirrors inventory/conditions.
  const skills = chatId ? (await getChatSkills(chatId)).map((s) => ({ ...s })) : [];
  if (chatId) {
    for (const s of skillChanges) {
      const existing = skills.find((sk) => sk.name.toLowerCase() === s.name.toLowerCase());
      if (s.absolute !== null) {
        // Absolute set: [SKILL:+name:3]
        if (existing) {
          existing.level = s.absolute;
          existing.lastTouched = nowIso();
        } else {
          skills.push({ name: s.name, level: s.absolute, lastTouched: nowIso() });
        }
      } else if (s.delta > 0) {
        // Relative increase: [SKILL:name+2] or [SKILL:+name]
        if (existing) {
          existing.level += s.delta;
          existing.lastTouched = nowIso();
        } else {
          skills.push({ name: s.name, level: s.delta, lastTouched: nowIso() });
        }
      } else {
        // Decrease: [SKILL:name-1] — remove if <= 0
        if (existing) {
          existing.level = Math.max(0, existing.level + s.delta);
          if (existing.level <= 0) skills.splice(skills.indexOf(existing), 1);
        } else {
          staleTargetErrors.push(`Tag [SKILL:${s.name}${s.delta}] se pokusil snížit dovednost "${s.name}", kterou postava nikdy neměla. Snižuj jen dovednosti, které postava skutečně má.`);
        }
      }
    }
  }

  // Apply level mutations — chat-scoped, mirrors inventory/skills.
  const chatXpLevel = chatId ? await getChatXpLevel(chatId) : { xp: 0, level: 1 };
  let xp = chatXpLevel.xp;
  let level = chatXpLevel.level;
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
        const relatedSkill = skills.find(
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
        existingItem.lastTouched = nowIso();
      } else {
        inv.push({ item: cdm.resultItem, qty: 1, lastTouched: nowIso() });
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

  // Persona is a template — never update during gameplay. Live state lives on
  // the chat (inventory/skills/conditions/xp/level/mods all chat-scoped).
  if (chatId) {
    try {
      await setChatInventory(chatId, inv);
      await setChatSkills(chatId, skills);
      await setChatConditions(chatId, conditions);
      await setChatModifications(chatId, modifications);
      if (hasLevelChanges) {
        await setChatXpLevel(chatId, xp, level);
      }
    } catch {
      // Non-critical
    }
  }

  // Auto-illustration trigger: enqueue newly added inventory items that
  // don't have an image yet (queue itself checks image_gen_enabled/limit).
  if (chatId && newlyAddedItems.length > 0) {
    try {
      const { enqueueIllustration } = await import("../memory/imageGenQueue");
      for (const itemName of newlyAddedItems) {
        enqueueIllustration("inventory", chatId, `Fantasy game item icon: ${itemName}`, itemName);
      }
    } catch {
      // Non-critical
    }
  }

  // Tag validation: warn about excessive or malformed tags in next prompt
  const totalTags = mutations.length + skillChanges.length + levelChanges.length +
    factionMutations.length + craftMutations.length + craftedMutations.length +
    conditionMutations.length + modMutations.length + questMutations.length;
  lastTagErrors = [...staleTargetErrors];
  if (totalTags > 5) {
    lastTagErrors.push(`Příliš mnoho tagů v jedné odpovědi (${totalTags}). Maximum je 3–5. Rozděl změny do více odpovědí.`);
  }
  if (totalTags === 0 && cleanText.length > 2000) {
    lastTagErrors.push("Dlouhá odpověď bez tagů. Pokud došlo ke změně inventáře, dovedností, questů nebo frakcí, použij odpovídající tagy.");
  }

  return cleanText;
}
