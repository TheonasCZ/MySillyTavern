import { invoke } from "@tauri-apps/api/core";
import { openDialog } from "../platform";

import {
  createCharacter,
  type Character,
} from "../db/repositories/charactersRepo";
import { createLorebookFromCharacterBook } from "../db/repositories/lorebooksRepo";
import { normalizeCard, parseCardJson, type MySillyTavernExtensions } from "./cardTypes";

interface ImportPngResult {
  card_json: string;
  avatar_saved_to: string;
}

/** Extracts MySillyTavern-specific extensions from a parsed card's
 * `data.extensions.mysillytavern` namespace, returning only recognised
 * fields. Unknown or missing extensions return an empty object. */
export function extractMstExtensions(card: unknown): MySillyTavernExtensions {
  try {
    const data = (card as { data?: { extensions?: { mysillytavern?: Record<string, unknown> } } })
      .data;
    const raw = data?.extensions?.mysillytavern;
    if (!raw || typeof raw !== "object") return {};
    const ext: MySillyTavernExtensions = {};
    if (typeof raw.ttsVoice === "string") ext.ttsVoice = raw.ttsVoice;
    if (typeof raw.recommendedPreset === "string") ext.recommendedPreset = raw.recommendedPreset;
    if (raw.directorDefaults && typeof raw.directorDefaults === "object") {
      const dd = raw.directorDefaults as Record<string, unknown>;
      const ddClean: MySillyTavernExtensions["directorDefaults"] = {};
      if (typeof dd.pace === "string") ddClean.pace = dd.pace;
      if (typeof dd.tone === "string") ddClean.tone = dd.tone;
      if (typeof dd.focus === "string") ddClean.focus = dd.focus;
      if (Object.keys(ddClean).length > 0) ext.directorDefaults = ddClean;
    }
    return ext;
  } catch {
    return {};
  }
}

/** Imports a character from a PNG file (already on disk at `path`) and
 * inserts the resulting character (plus, if the card carried one, its
 * `character_book` as a linked lorebook) into the database. */
export async function importCardFromPng(path: string): Promise<Character> {
  const result = await invoke<ImportPngResult>("import_card_png", { path });
  return finishImport(result.card_json, result.avatar_saved_to);
}

/** Imports a character from a plain JSON card file (no embedded PNG, so no
 * avatar). */
export async function importCardFromJsonFile(path: string): Promise<Character> {
  const text = await invoke<string>("read_card_json_file", { path });
  return finishImport(text, null);
}

async function finishImport(cardJsonText: string, avatarPath: string | null): Promise<Character> {
  const card = parseCardJson(cardJsonText);
  const normalized = normalizeCard(card);
  const mstExt = extractMstExtensions(card);
  const character = await createCharacter(normalized, cardJsonText, avatarPath);
  if (normalized.characterBook && (normalized.characterBook.entries?.length ?? 0) > 0) {
    await createLorebookFromCharacterBook(normalized.characterBook, character.id);
  }
  // Apply MST extensions to the freshly created character.
  await applyMstExtensions(character.id, mstExt);
  // Re-read so the returned character includes the applied extensions.
  const { getCharacter } = await import("../db/repositories/charactersRepo");
  const updated = await getCharacter(character.id);
  return updated ?? character;
}

/** Applies recognised MySillyTavern extensions to the character row. Only
 * non-empty values are written; missing/empty fields leave the column as-is. */
async function applyMstExtensions(characterId: string, ext: MySillyTavernExtensions): Promise<void> {
  if (!ext.ttsVoice && !ext.recommendedPreset && !ext.directorDefaults) return;

  const patch: { ttsVoice?: string | null } = {};
  if (ext.ttsVoice) patch.ttsVoice = ext.ttsVoice;

  if (Object.keys(patch).length > 0) {
    // updateCharacter only accepts full CharacterUpdate, but we only want
    // to touch ttsVoice. Use a targeted update via the repo function.
    await updateCharacterTtsVoice(characterId, patch.ttsVoice ?? null);
  }
}

/** Sets only the ttsVoice column on a character, leaving everything else
 * untouched. */
async function updateCharacterTtsVoice(id: string, ttsVoice: string | null): Promise<void> {
  const { execute, nowIso } = await import("../db/database");
  await execute(
    "UPDATE characters SET tts_voice = $2, updated_at = $3 WHERE id = $1",
    [id, ttsVoice, nowIso()],
  );
}

/** Opens a native file picker restricted to `.png` and imports the chosen
 * card, or returns null if the user cancelled. */
export async function pickAndImportPngCard(): Promise<Character | null> {
  const path = await openDialog({
    multiple: false,
    filters: [{ name: "Character card (PNG)", extensions: ["png"] }],
  });
  if (!path || Array.isArray(path)) return null;
  return importCardFromPng(path);
}

/** Opens a native file picker restricted to `.json` and imports the chosen
 * card, or returns null if the user cancelled. */
export async function pickAndImportJsonCard(): Promise<Character | null> {
  const path = await openDialog({
    multiple: false,
    filters: [{ name: "Character card (JSON)", extensions: ["json"] }],
  });
  if (!path || Array.isArray(path)) return null;
  return importCardFromJsonFile(path);
}
