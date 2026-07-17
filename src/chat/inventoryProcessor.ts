import type { Persona } from "../db/repositories/personasRepo";
import { updatePersona } from "../db/repositories/personasRepo";
import { parseGameTags } from "./inventoryTags";

/** Parses game tags (inventory + skill) from the AI response,
 *  updates the persona in DB, and returns the cleaned text. */
export async function processGameResponse(
  persona: Persona | null,
  text: string,
): Promise<string> {
  if (!persona) return text;
  const { cleanText, mutations, skillChanges } = parseGameTags(text);
  if (mutations.length === 0 && skillChanges.length === 0) return text;

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

  try {
    await updatePersona(persona.id, {
      name: persona.name,
      gender: persona.gender,
      age: persona.age,
      race: persona.race,
      appearance: persona.appearance,
      skills,
      inventory: inv,
    });
  } catch {
    // Non-critical
  }

  return cleanText;
}
