import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

import { createCharacter, type Character } from "../db/repositories/charactersRepo";
import { createLorebookFromCharacterBook } from "../db/repositories/lorebooksRepo";
import { normalizeCard, parseCardJson } from "./cardTypes";

interface ImportPngResult {
  card_json: string;
  avatar_saved_to: string;
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
  const character = await createCharacter(normalized, cardJsonText, avatarPath);
  if (normalized.characterBook && (normalized.characterBook.entries?.length ?? 0) > 0) {
    await createLorebookFromCharacterBook(normalized.characterBook, character.id);
  }
  return character;
}

/** Opens a native file picker restricted to `.png` and imports the chosen
 * card, or returns null if the user cancelled. */
export async function pickAndImportPngCard(): Promise<Character | null> {
  const path = await open({
    multiple: false,
    filters: [{ name: "Character card (PNG)", extensions: ["png"] }],
  });
  if (!path || Array.isArray(path)) return null;
  return importCardFromPng(path);
}

/** Opens a native file picker restricted to `.json` and imports the chosen
 * card, or returns null if the user cancelled. */
export async function pickAndImportJsonCard(): Promise<Character | null> {
  const path = await open({
    multiple: false,
    filters: [{ name: "Character card (JSON)", extensions: ["json"] }],
  });
  if (!path || Array.isArray(path)) return null;
  return importCardFromJsonFile(path);
}
