import { execute, newId, nowIso, query } from "../database";

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
  skills: SkillEntry[];
  inventory: InventoryEntry[];
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
  skills: SkillEntry[];
  inventory: InventoryEntry[];
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
  skills: string; // JSON
  inventory: string; // JSON
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
    skills: parseJsonArray<SkillEntry[]>(row.skills, []),
    inventory: parseJsonArray<InventoryEntry[]>(row.inventory, []),
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
    `INSERT INTO personas (id, name, description, gender, age, race, appearance, skills, inventory, avatar_path, is_default, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)`,
    [
      id, draft.name, description,
      draft.gender, draft.age, draft.race, draft.appearance,
      JSON.stringify(draft.skills), JSON.stringify(draft.inventory),
      draft.avatarPath, isDefault ? 1 : 0, now,
    ],
  );
  return {
    id, name: draft.name, description,
    gender: draft.gender, age: draft.age, race: draft.race,
    appearance: draft.appearance,
    skills: draft.skills, inventory: draft.inventory,
    avatarPath: draft.avatarPath, isDefault,
    createdAt: now, updatedAt: now,
  };
}

export async function updatePersona(id: string, patch: PersonaUpdate): Promise<void> {
  const description = buildPersonaDescription(patch);
  await execute(
    `UPDATE personas SET name = $2, description = $3, gender = $4, age = $5, race = $6, appearance = $7, skills = $8, inventory = $9, updated_at = $10 WHERE id = $1`,
    [
      id, patch.name, description,
      patch.gender, patch.age, patch.race, patch.appearance,
      JSON.stringify(patch.skills), JSON.stringify(patch.inventory),
      nowIso(),
    ],
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
  await execute("DELETE FROM personas WHERE id = $1", [id]);
}
