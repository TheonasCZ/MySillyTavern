import { execute, newId, nowIso, query } from "../database";

export interface TtsVoiceProfile {
  id: string;
  name: string;
  backend: string;
  voiceId: string;
  pitch: number;
  rate: number;
  volume: number;
  createdAt: string;
}

export interface TtsVoiceProfileDraft {
  name: string;
  backend?: string;
  voiceId: string;
  pitch?: number;
  rate?: number;
  volume?: number;
}

interface TtsVoiceProfileRow {
  id: string;
  name: string;
  backend: string;
  voice_id: string;
  pitch: number;
  rate: number;
  volume: number;
  created_at: string;
}

function toProfile(row: TtsVoiceProfileRow): TtsVoiceProfile {
  return {
    id: row.id,
    name: row.name,
    backend: row.backend,
    voiceId: row.voice_id,
    pitch: row.pitch,
    rate: row.rate,
    volume: row.volume,
    createdAt: row.created_at,
  };
}

export async function getAllProfiles(): Promise<TtsVoiceProfile[]> {
  const rows = await query<TtsVoiceProfileRow>(
    "SELECT * FROM tts_voice_profiles ORDER BY name ASC",
    [],
  );
  return rows.map(toProfile);
}

export async function getProfile(id: string): Promise<TtsVoiceProfile | null> {
  const rows = await query<TtsVoiceProfileRow>(
    "SELECT * FROM tts_voice_profiles WHERE id = $1",
    [id],
  );
  return rows[0] ? toProfile(rows[0]) : null;
}

export async function createProfile(draft: TtsVoiceProfileDraft): Promise<TtsVoiceProfile> {
  const id = newId();
  const now = nowIso();
  await execute(
    `INSERT INTO tts_voice_profiles (id, name, backend, voice_id, pitch, rate, volume, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      draft.name,
      draft.backend ?? "edge-tts",
      draft.voiceId,
      draft.pitch ?? 0.0,
      draft.rate ?? 1.0,
      draft.volume ?? 1.0,
      now,
    ],
  );
  return {
    id,
    name: draft.name,
    backend: draft.backend ?? "edge-tts",
    voiceId: draft.voiceId,
    pitch: draft.pitch ?? 0.0,
    rate: draft.rate ?? 1.0,
    volume: draft.volume ?? 1.0,
    createdAt: now,
  };
}

export async function updateProfile(
  id: string,
  patch: Partial<Omit<TtsVoiceProfileDraft, "voiceId"> & { voiceId?: string }>,
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [id];
  let idx = 2;

  if (patch.name !== undefined) {
    sets.push(`name = $${idx++}`);
    params.push(patch.name);
  }
  if (patch.backend !== undefined) {
    sets.push(`backend = $${idx++}`);
    params.push(patch.backend);
  }
  if (patch.voiceId !== undefined) {
    sets.push(`voice_id = $${idx++}`);
    params.push(patch.voiceId);
  }
  if (patch.pitch !== undefined) {
    sets.push(`pitch = $${idx++}`);
    params.push(patch.pitch);
  }
  if (patch.rate !== undefined) {
    sets.push(`rate = $${idx++}`);
    params.push(patch.rate);
  }
  if (patch.volume !== undefined) {
    sets.push(`volume = $${idx++}`);
    params.push(patch.volume);
  }

  if (sets.length > 0) {
    await execute(
      `UPDATE tts_voice_profiles SET ${sets.join(", ")} WHERE id = $1`,
      params,
    );
  }
}

export async function deleteProfile(id: string): Promise<void> {
  await execute("DELETE FROM tts_voice_profiles WHERE id = $1", [id]);
}
