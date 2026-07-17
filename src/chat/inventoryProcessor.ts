import type { Persona } from "../db/repositories/personasRepo";
import { updatePersona, updatePersonaXpLevel } from "../db/repositories/personasRepo";
import { createFaction, listFactions, updateReputation } from "../db/repositories/factionsRepo";
import { parseGameTags } from "./inventoryTags";

/** Parses game tags (inventory + skill + level + faction) from the AI response,
 *  updates the persona in DB, and returns the cleaned text. */
export async function processGameResponse(
  persona: Persona | null,
  text: string,
): Promise<string> {
  if (!persona) return text;
  const { cleanText, mutations, skillChanges, levelChanges, factionMutations } = parseGameTags(text);
  if (mutations.length === 0 && skillChanges.length === 0 && levelChanges.length === 0 && factionMutations.length === 0) return text;

  // Apply inventory mutations
  const inv = persona.inventory ? [...persona.inventory.map((i) => ({ ...i }))] : [];
  for (const m of mutations) {
    const existing = inv.find((i) => i.item.toLowerCase() === m.item.toLowerCase());
    if (m.op === "add") {
      if (existing) {
        existing.qty += m.qty;
      } else {
        inv.push({ item: m.item, qty: m.qty });
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
    });
    if (hasLevelChanges) {
      await updatePersonaXpLevel(persona.id, xp, level);
    }
  } catch {
    // Non-critical
  }

  return cleanText;
}
