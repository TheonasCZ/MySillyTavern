import { execute, newId, nowIso, query } from "../database";

export interface Preset {
  id: string;
  name: string;
  isDefault: boolean;
  extraSystemPrompt: string;
  temperature: number | null;
  topP: number | null;
  frequencyPenalty: number | null;
  presencePenalty: number | null;
  maxTokens: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface PresetDraft {
  name: string;
  isDefault?: boolean;
  extraSystemPrompt?: string;
  temperature?: number | null;
  topP?: number | null;
  frequencyPenalty?: number | null;
  presencePenalty?: number | null;
  maxTokens?: number | null;
}

export interface PresetUpdate {
  name?: string;
  isDefault?: boolean;
  extraSystemPrompt?: string;
  temperature?: number | null;
  topP?: number | null;
  frequencyPenalty?: number | null;
  presencePenalty?: number | null;
  maxTokens?: number | null;
}

interface PresetRow {
  id: string;
  name: string;
  is_default: number;
  extra_system_prompt: string;
  temperature: number | null;
  top_p: number | null;
  frequency_penalty: number | null;
  presence_penalty: number | null;
  max_tokens: number | null;
  created_at: string;
  updated_at: string;
}

function toPreset(row: PresetRow): Preset {
  return {
    id: row.id,
    name: row.name,
    isDefault: row.is_default === 1,
    extraSystemPrompt: row.extra_system_prompt,
    temperature: row.temperature,
    topP: row.top_p,
    frequencyPenalty: row.frequency_penalty,
    presencePenalty: row.presence_penalty,
    maxTokens: row.max_tokens,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listPresets(): Promise<Preset[]> {
  const rows = await query<PresetRow>(
    "SELECT * FROM presets ORDER BY name ASC",
    [],
  );
  return rows.map(toPreset);
}

export async function getPreset(id: string): Promise<Preset | null> {
  const rows = await query<PresetRow>(
    "SELECT * FROM presets WHERE id = $1",
    [id],
  );
  return rows[0] ? toPreset(rows[0]) : null;
}

export async function getDefaultPreset(): Promise<Preset | null> {
  const rows = await query<PresetRow>(
    "SELECT * FROM presets WHERE is_default = 1 LIMIT 1",
    [],
  );
  return rows[0] ? toPreset(rows[0]) : null;
}

/** Ensures at most one preset is marked default. If `isDefault` is true,
 * clears any other default before setting this one. */
async function enforceSingleDefault(excludeId: string): Promise<void> {
  await execute(
    "UPDATE presets SET is_default = 0 WHERE id != $1 AND is_default = 1",
    [excludeId],
  );
}

export async function createPreset(draft: PresetDraft): Promise<Preset> {
  const id = newId();
  const now = nowIso();
  const isDefault = draft.isDefault ? 1 : 0;
  if (draft.isDefault) {
    await enforceSingleDefault(id);
  }
  await execute(
    `INSERT INTO presets (id, name, is_default, extra_system_prompt, temperature, top_p, frequency_penalty, presence_penalty, max_tokens, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)`,
    [
      id,
      draft.name,
      isDefault,
      draft.extraSystemPrompt ?? "",
      draft.temperature ?? null,
      draft.topP ?? null,
      draft.frequencyPenalty ?? null,
      draft.presencePenalty ?? null,
      draft.maxTokens ?? null,
      now,
    ],
  );
  return {
    id,
    name: draft.name,
    isDefault: !!draft.isDefault,
    extraSystemPrompt: draft.extraSystemPrompt ?? "",
    temperature: draft.temperature ?? null,
    topP: draft.topP ?? null,
    frequencyPenalty: draft.frequencyPenalty ?? null,
    presencePenalty: draft.presencePenalty ?? null,
    maxTokens: draft.maxTokens ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

export async function updatePreset(id: string, patch: PresetUpdate): Promise<void> {
  if (patch.isDefault) {
    await enforceSingleDefault(id);
  }
  const sets: string[] = ["updated_at = $2"];
  const params: unknown[] = [id, nowIso()];
  let idx = 3;

  if (patch.name !== undefined) {
    sets.push(`name = $${idx++}`);
    params.push(patch.name);
  }
  if (patch.isDefault !== undefined) {
    sets.push(`is_default = $${idx++}`);
    params.push(patch.isDefault ? 1 : 0);
  }
  if (patch.extraSystemPrompt !== undefined) {
    sets.push(`extra_system_prompt = $${idx++}`);
    params.push(patch.extraSystemPrompt);
  }
  if (patch.temperature !== undefined) {
    sets.push(`temperature = $${idx++}`);
    params.push(patch.temperature);
  }
  if (patch.topP !== undefined) {
    sets.push(`top_p = $${idx++}`);
    params.push(patch.topP);
  }
  if (patch.frequencyPenalty !== undefined) {
    sets.push(`frequency_penalty = $${idx++}`);
    params.push(patch.frequencyPenalty);
  }
  if (patch.presencePenalty !== undefined) {
    sets.push(`presence_penalty = $${idx++}`);
    params.push(patch.presencePenalty);
  }
  if (patch.maxTokens !== undefined) {
    sets.push(`max_tokens = $${idx++}`);
    params.push(patch.maxTokens);
  }

  if (sets.length > 1) {
    await execute(`UPDATE presets SET ${sets.join(", ")} WHERE id = $1`, params);
  }
}

export async function deletePreset(id: string): Promise<void> {
  await execute("UPDATE chats SET preset_id = NULL WHERE preset_id = $1", [id]);
  await execute("DELETE FROM presets WHERE id = $1", [id]);
}
