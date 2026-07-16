import { execute, newId, nowIso, query } from "../database";

export interface Persona {
  id: string;
  name: string;
  description: string;
  avatarPath: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PersonaDraft {
  name: string;
  description: string;
  avatarPath: string | null;
}

interface PersonaRow {
  id: string;
  name: string;
  description: string;
  avatar_path: string | null;
  is_default: number;
  created_at: string;
  updated_at: string;
}

function toPersona(row: PersonaRow): Persona {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    avatarPath: row.avatar_path,
    isDefault: row.is_default === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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
  // First persona ever created becomes the default automatically, so a
  // fresh install always has a usable default without extra user action.
  const existing = await query<{ n: number }>("SELECT COUNT(*) as n FROM personas", []);
  const isDefault = (existing[0]?.n ?? 0) === 0;
  await execute(
    `INSERT INTO personas (id, name, description, avatar_path, is_default, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $6)`,
    [id, draft.name, draft.description, draft.avatarPath, isDefault ? 1 : 0, now],
  );
  return {
    id,
    name: draft.name,
    description: draft.description,
    avatarPath: draft.avatarPath,
    isDefault,
    createdAt: now,
    updatedAt: now,
  };
}

export interface PersonaUpdate {
  name: string;
  description: string;
}

export async function updatePersona(id: string, patch: PersonaUpdate): Promise<void> {
  await execute(
    `UPDATE personas SET name = $2, description = $3, updated_at = $4 WHERE id = $1`,
    [id, patch.name, patch.description, nowIso()],
  );
}

export async function updatePersonaAvatar(id: string, avatarPath: string | null): Promise<void> {
  await execute("UPDATE personas SET avatar_path = $2, updated_at = $3 WHERE id = $1", [
    id,
    avatarPath,
    nowIso(),
  ]);
}

/** Sets `id` as the default persona, clearing the flag on every other
 * persona — only one persona may be default at a time. */
export async function setDefaultPersona(id: string): Promise<void> {
  const now = nowIso();
  await execute(`UPDATE personas SET is_default = 0, updated_at = $2 WHERE id != $1`, [id, now]);
  await execute(`UPDATE personas SET is_default = 1, updated_at = $2 WHERE id = $1`, [id, now]);
}

export async function deletePersona(id: string): Promise<void> {
  await execute("DELETE FROM personas WHERE id = $1", [id]);
}
