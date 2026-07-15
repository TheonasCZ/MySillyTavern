import { execute, newId, nowIso, query } from "../database";

/** Minimal shape needed by M2 chat. Full character CRUD/import lands in
 * M3 — this repo only exists so chats (which require a NOT NULL
 * character_id) have something to point at before the character gallery
 * exists. */
export interface CharacterSummary {
  id: string;
  name: string;
}

interface CharacterRow {
  id: string;
  name: string;
}

const DEFAULT_CHARACTER_NAME = "Vypravěč";

/** Returns the id of a placeholder "narrator" character, creating one on
 * first use. M3 replaces this with real character cards; chats created in
 * M2 keep working against whatever character they were pointed at. */
export async function ensureDefaultCharacter(): Promise<CharacterSummary> {
  const rows = await query<CharacterRow>(
    "SELECT id, name FROM characters ORDER BY created_at ASC LIMIT 1",
    [],
  );
  if (rows[0]) {
    return rows[0];
  }

  const id = newId();
  const now = nowIso();
  await execute(
    `INSERT INTO characters
      (id, name, description, personality, scenario, first_mes, mes_example,
       alternate_greetings, system_prompt, post_history_instructions,
       creator_notes, tags, avatar_path, card_json, spec_version, created_at, updated_at)
     VALUES ($1, $2, '', '', '', '', '', '[]', '', '', '', '[]', NULL, NULL, 'v2', $3, $3)`,
    [id, DEFAULT_CHARACTER_NAME, now],
  );
  return { id, name: DEFAULT_CHARACTER_NAME };
}

export async function listCharacterSummaries(): Promise<CharacterSummary[]> {
  return query<CharacterSummary>("SELECT id, name FROM characters ORDER BY name ASC", []);
}
