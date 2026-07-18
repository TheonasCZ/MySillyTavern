import { execute, newId, nowIso, query } from "../database";
import { journalEntityDelete, journalEntityWrite } from "../syncJournal";

export interface SkillEntry {
  name: string;
  level: number;
}

export interface InventoryEntry {
  item: string;
  qty: number;
  note?: string;
  image_path?: string;
}

export interface ConditionEntry {
  name: string;
  description: string;
  expiresAt: string | null;
  modifiers?: { stat: string; value: number }[];
}

/** A lasting body modification (e.g. a scar, a magical mark, a prosthetic).
 *  Chat-scoped only (see chatsRepo.Chat.modifications) — unlike inventory/
 *  skills/conditions there is no persona template counterpart: modifications
 *  are always campaign-specific and never seeded from a persona. */
export interface ModificationEntry {
  name: string;
  description: string;
}

export interface Persona {
  id: string;
  name: string;
  /** Free-text bio — auto-generated from structured fields on save.
   *  Kept for SillyTavern compatibility on export. Not user-editable. */
  description: string;
  gender: string;
  age: number | null;
  race: string;
  appearance: string;
  progression: "skill" | "level" | "none";
  xp?: number;
  level?: number;
  skills: SkillEntry[];
  inventory: InventoryEntry[];
  conditions: ConditionEntry[];
  avatarPath: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PersonaDraft {
  name: string;
  gender: string;
  age: number | null;
  race: string;
  appearance: string;
  progression?: "skill" | "level" | "none";
  skills: SkillEntry[];
  inventory: InventoryEntry[];
  conditions?: ConditionEntry[];
  avatarPath: string | null;
}

export type PersonaUpdate = Omit<PersonaDraft, "avatarPath">;

interface PersonaRow {
  id: string;
  name: string;
  description: string;
  gender: string;
  age: number | null;
  race: string;
  appearance: string;
  progression: string;
  xp: number;
  level: number;
  skills: string; // JSON
  inventory: string; // JSON
  conditions: string; // JSON
  avatar_path: string | null;
  is_default: number;
  created_at: string;
  updated_at: string;
}

function parseJsonArray<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toPersona(row: PersonaRow): Persona {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    gender: row.gender,
    age: row.age,
    race: row.race,
    appearance: row.appearance,
    progression: (row.progression as "skill" | "level" | "none") || "skill",
    xp: row.xp ?? 0,
    level: row.level ?? 1,
    skills: parseJsonArray<SkillEntry[]>(row.skills, []),
    inventory: parseJsonArray<InventoryEntry[]>(row.inventory, []),
    conditions: parseJsonArray<ConditionEntry[]>(row.conditions, []),
    avatarPath: row.avatar_path,
    isDefault: row.is_default === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Builds a free-text description from structured fields. Used for ST-compatible
 *  export and auto-generated `description` column. */
export function buildPersonaDescription(persona: Pick<Persona, "gender" | "age" | "race" | "appearance" | "skills" | "inventory" | "name">): string {
  const lines: string[] = [];
  lines.push(`${persona.name} is`);
  const identity: string[] = [];
  if (persona.gender) identity.push(persona.gender.toLowerCase());
  if (persona.age) identity.push(`${persona.age} years old`);
  if (persona.race) identity.push(persona.race.toLowerCase());
  lines.push(identity.filter(Boolean).join(", ") + ".");

  if (persona.appearance) {
    lines.push(`\nAppearance: ${persona.appearance}`);
  }

  if (persona.skills.length > 0) {
    lines.push(`\nSkills:`);
    for (const s of persona.skills) {
      lines.push(`- ${s.name} (level ${s.level})`);
    }
  }

  if (persona.inventory.length > 0) {
    lines.push(`\nInventory:`);
    for (const inv of persona.inventory) {
      const note = inv.note ? ` — ${inv.note}` : "";
      lines.push(`- ${inv.item}${inv.qty > 1 ? ` x${inv.qty}` : ""}${note}`);
    }
  }

  return lines.join("\n");
}

export async function listPersonas(): Promise<Persona[]> {
  const rows = await query<PersonaRow>("SELECT * FROM personas ORDER BY name ASC", []);
  return rows.map(toPersona);
}

export async function getPersona(id: string): Promise<Persona | null> {
  const rows = await query<PersonaRow>("SELECT * FROM personas WHERE id = $1", [id]);
  return rows[0] ? toPersona(rows[0]) : null;
}

export async function getDefaultPersona(): Promise<Persona | null> {
  const rows = await query<PersonaRow>(
    "SELECT * FROM personas WHERE is_default = 1 LIMIT 1",
    [],
  );
  return rows[0] ? toPersona(rows[0]) : null;
}

export async function createPersona(draft: PersonaDraft): Promise<Persona> {
  const id = newId();
  const now = nowIso();
  const existing = await query<{ n: number }>("SELECT COUNT(*) as n FROM personas", []);
  const isDefault = (existing[0]?.n ?? 0) === 0;
  const description = buildPersonaDescription(draft);
  await execute(
    `INSERT INTO personas (id, name, description, gender, age, race, appearance, progression, skills, inventory, conditions, avatar_path, is_default, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14)`,
    [
      id, draft.name, description,
      draft.gender, draft.age, draft.race, draft.appearance,
      draft.progression || "skill",
      JSON.stringify(draft.skills), JSON.stringify(draft.inventory), JSON.stringify(draft.conditions ?? []),
      draft.avatarPath, isDefault ? 1 : 0, now,
    ],
  );
  const persona: Persona = {
    id, name: draft.name, description,
    gender: draft.gender, age: draft.age, race: draft.race,
    appearance: draft.appearance,
    progression: (draft.progression as "skill" | "level" | "none") || "skill",
    xp: 0,
    level: 1,
    conditions: draft.conditions ?? [],
    skills: draft.skills, inventory: draft.inventory,
    avatarPath: draft.avatarPath, isDefault,
    createdAt: now, updatedAt: now,
  };
  journalEntityWrite("persona", persona as unknown as Record<string, unknown>);
  return persona;
}

export async function updatePersona(id: string, patch: PersonaUpdate): Promise<void> {
  const description = buildPersonaDescription(patch);
  const now = nowIso();
  await execute(
    `UPDATE personas SET name = $2, description = $3, gender = $4, age = $5, race = $6, appearance = $7, progression = $8, skills = $9, inventory = $10, conditions = $11, updated_at = $12 WHERE id = $1`,
    [
      id, patch.name, description,
      patch.gender, patch.age, patch.race, patch.appearance, patch.progression || "skill",
      JSON.stringify(patch.skills), JSON.stringify(patch.inventory), JSON.stringify(patch.conditions ?? []),
      now,
    ],
  );
  journalEntityWrite("persona", { id, ...patch, updated_at: now });
}

export async function updatePersonaXpLevel(
  id: string,
  xp: number,
  level: number,
): Promise<void> {
  await execute(
    "UPDATE personas SET xp = $2, level = $3, updated_at = $4 WHERE id = $1",
    [id, xp, level, nowIso()],
  );
}

export async function updatePersonaAvatar(id: string, avatarPath: string | null): Promise<void> {
  await execute("UPDATE personas SET avatar_path = $2, updated_at = $3 WHERE id = $1", [
    id,
    avatarPath,
    nowIso(),
  ]);
}

export async function setDefaultPersona(id: string): Promise<void> {
  const now = nowIso();
  await execute(`UPDATE personas SET is_default = 0, updated_at = $2 WHERE id != $1`, [id, now]);
  await execute(`UPDATE personas SET is_default = 1, updated_at = $2 WHERE id = $1`, [id, now]);
}

export async function deletePersona(id: string): Promise<void> {
  const persona = await getPersona(id);
  await execute("DELETE FROM personas WHERE id = $1", [id]);
  if (persona) {
    journalEntityDelete("persona", persona as unknown as Record<string, unknown>);
  }
}

/** Sets image_path on a specific inventory item by name within a persona's inventory JSON. */
export async function setInventoryItemImage(
  personaId: string,
  itemName: string,
  imagePath: string,
): Promise<void> {
  const rows = await query<{ inventory: string }>(
    "SELECT inventory FROM personas WHERE id = $1",
    [personaId],
  );
  if (!rows[0]) return;
  const inventory: InventoryEntry[] = JSON.parse(rows[0].inventory || "[]");
  const item = inventory.find(
    (i) => i.item.toLowerCase() === itemName.toLowerCase(),
  );
  if (!item) return;
  item.image_path = imagePath;
  await execute("UPDATE personas SET inventory = $2, updated_at = $3 WHERE id = $1", [
    personaId,
    JSON.stringify(inventory),
    nowIso(),
  ]);
}

/** Writes the full conditions array for a persona — used by the condition
 *  mutation processor after applying [COND:...] tags. */
export async function updatePersonaConditions(
  personaId: string,
  conditions: ConditionEntry[],
): Promise<void> {
  await execute(
    "UPDATE personas SET conditions = $2, updated_at = $3 WHERE id = $1",
    [personaId, JSON.stringify(conditions), nowIso()],
  );
}
