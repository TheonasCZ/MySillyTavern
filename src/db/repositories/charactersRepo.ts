import { execute, newId, nowIso, query } from "../database";
import { journalEntityDelete, journalEntityWrite } from "../syncJournal";
import type { NormalizedCard } from "../../cards/cardTypes";

export interface Character {
  id: string;
  name: string;
  description: string;
  personality: string;
  scenario: string;
  firstMes: string;
  mesExample: string;
  alternateGreetings: string[];
  systemPrompt: string;
  postHistoryInstructions: string;
  creatorNotes: string;
  tags: string[];
  avatarPath: string | null;
  cardJson: string | null;
  specVersion: string;
  /** TTS voice URI for this character (null = global default). */
  ttsVoice: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Minimal shape needed by chat-creation pickers. */
export interface CharacterSummary {
  id: string;
  name: string;
  avatarPath: string | null;
  tags: string[];
}

interface CharacterRow {
  id: string;
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example: string;
  alternate_greetings: string;
  system_prompt: string;
  post_history_instructions: string;
  creator_notes: string;
  tags: string;
  avatar_path: string | null;
  card_json: string | null;
  spec_version: string;
  tts_voice: string | null;
  created_at: string;
  updated_at: string;
}

function parseJsonArray(text: string): string[] {
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toCharacter(row: CharacterRow): Character {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    personality: row.personality,
    scenario: row.scenario,
    firstMes: row.first_mes,
    mesExample: row.mes_example,
    alternateGreetings: parseJsonArray(row.alternate_greetings),
    systemPrompt: row.system_prompt,
    postHistoryInstructions: row.post_history_instructions,
    creatorNotes: row.creator_notes,
    tags: parseJsonArray(row.tags),
    avatarPath: row.avatar_path,
    cardJson: row.card_json,
    specVersion: row.spec_version,
    ttsVoice: row.tts_voice,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toSummary(row: CharacterRow): CharacterSummary {
  return {
    id: row.id,
    name: row.name,
    avatarPath: row.avatar_path,
    tags: parseJsonArray(row.tags),
  };
}

export async function listCharacters(): Promise<Character[]> {
  const rows = await query<CharacterRow>("SELECT * FROM characters ORDER BY name ASC", []);
  return rows.map(toCharacter);
}

export async function listCharacterSummaries(): Promise<CharacterSummary[]> {
  const rows = await query<CharacterRow>("SELECT * FROM characters ORDER BY name ASC", []);
  return rows.map(toSummary);
}

export async function getCharacter(id: string): Promise<Character | null> {
  const rows = await query<CharacterRow>("SELECT * FROM characters WHERE id = $1", [id]);
  return rows[0] ? toCharacter(rows[0]) : null;
}

/** Inserts a character from normalized card fields (import PNG/JSON, or a
 * blank card the editor starts a new character from). `cardJson` is the
 * untouched original card JSON, kept for lossless re-export — null for
 * characters created from scratch in the editor. */
export async function createCharacter(
  card: NormalizedCard,
  cardJson: string | null,
  avatarPath: string | null,
): Promise<Character> {
  const id = newId();
  const now = nowIso();
  await execute(
    `INSERT INTO characters
      (id, name, description, personality, scenario, first_mes, mes_example,
       alternate_greetings, system_prompt, post_history_instructions,
       creator_notes, tags, avatar_path, card_json, spec_version, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $16)`,
    [
      id,
      card.name,
      card.description,
      card.personality,
      card.scenario,
      card.firstMes,
      card.mesExample,
      JSON.stringify(card.alternateGreetings),
      card.systemPrompt,
      card.postHistoryInstructions,
      card.creatorNotes,
      JSON.stringify(card.tags),
      avatarPath,
      cardJson,
      card.specVersion,
      now,
    ],
  );
  const character: Character = {
    id,
    name: card.name,
    description: card.description,
    personality: card.personality,
    scenario: card.scenario,
    firstMes: card.firstMes,
    mesExample: card.mesExample,
    alternateGreetings: card.alternateGreetings,
    systemPrompt: card.systemPrompt,
    postHistoryInstructions: card.postHistoryInstructions,
    creatorNotes: card.creatorNotes,
    tags: card.tags,
    avatarPath,
    cardJson,
    specVersion: card.specVersion,
    ttsVoice: null,
    createdAt: now,
    updatedAt: now,
  };
  journalEntityWrite("character", character as unknown as Record<string, unknown>);
  return character;
}

export interface CharacterUpdate {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  firstMes: string;
  mesExample: string;
  alternateGreetings: string[];
  systemPrompt: string;
  postHistoryInstructions: string;
  creatorNotes: string;
  tags: string[];
  ttsVoice?: string | null;
}

export async function updateCharacter(id: string, patch: CharacterUpdate): Promise<void> {
  const now = nowIso();
  await execute(
    `UPDATE characters SET
      name = $2, description = $3, personality = $4, scenario = $5,
      first_mes = $6, mes_example = $7, alternate_greetings = $8,
      system_prompt = $9, post_history_instructions = $10, creator_notes = $11,
      tags = $12, tts_voice = $13, updated_at = $14
     WHERE id = $1`,
    [
      id,
      patch.name,
      patch.description,
      patch.personality,
      patch.scenario,
      patch.firstMes,
      patch.mesExample,
      JSON.stringify(patch.alternateGreetings),
      patch.systemPrompt,
      patch.postHistoryInstructions,
      patch.creatorNotes,
      JSON.stringify(patch.tags),
      patch.ttsVoice ?? null,
      now,
    ],
  );
  journalEntityWrite("character", { id, ...patch, updated_at: now });
}

export async function updateCharacterCardJson(id: string, cardJson: string): Promise<void> {
  await execute("UPDATE characters SET card_json = $2, updated_at = $3 WHERE id = $1", [
    id,
    cardJson,
    nowIso(),
  ]);
}

export async function updateCharacterAvatar(id: string, avatarPath: string): Promise<void> {
  await execute("UPDATE characters SET avatar_path = $2, updated_at = $3 WHERE id = $1", [
    id,
    avatarPath,
    nowIso(),
  ]);
}

export async function deleteCharacter(id: string): Promise<void> {
  const character = await getCharacter(id);
  await execute("DELETE FROM characters WHERE id = $1", [id]);
  if (character) {
    journalEntityDelete("character", character as unknown as Record<string, unknown>);
  }
}
