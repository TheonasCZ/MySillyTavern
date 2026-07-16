import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";

import type { Character } from "../db/repositories/charactersRepo";
import { buildCardV2Json, type CharacterCardV2, type NormalizedCard } from "./cardTypes";

function characterToNormalized(character: Character): NormalizedCard {
  return {
    name: character.name,
    description: character.description,
    personality: character.personality,
    scenario: character.scenario,
    firstMes: character.firstMes,
    mesExample: character.mesExample,
    alternateGreetings: character.alternateGreetings,
    systemPrompt: character.systemPrompt,
    postHistoryInstructions: character.postHistoryInstructions,
    creatorNotes: character.creatorNotes,
    tags: character.tags,
    specVersion: "v2",
    characterBook: null,
  };
}

/** Merges the character's current column values into its original
 * `card_json` (if any), preserving fields this app doesn't model
 * (extensions, creator, character_book, ...) while overwriting everything
 * the editor can change. Falls back to building a fresh V2 card when there
 * is no original (character created from scratch, or imported from bare
 * JSON that failed to parse as an object). */
export function mergeCharacterIntoCardJson(character: Character): CharacterCardV2 {
  const normalized = characterToNormalized(character);
  const fresh = buildCardV2Json(normalized);

  if (!character.cardJson) return fresh;

  try {
    const original = JSON.parse(character.cardJson) as { data?: Record<string, unknown> };
    if (!original.data) return fresh;
    return {
      spec: "chara_card_v2",
      spec_version: "2.0",
      data: {
        ...original.data,
        ...fresh.data,
        // Keep the original character_book (if any) rather than dropping it —
        // this app doesn't edit lorebooks embedded in cards (M4 has full
        // lorebook UI), so the safest thing on export is to leave it as-is.
        character_book: (original.data as { character_book?: unknown }).character_book as
          | CharacterCardV2["data"]["character_book"]
          | undefined,
      },
    };
  } catch {
    return fresh;
  }
}

/** Merges the character into a V2 card JSON and asks Rust to embed it into
 * a PNG at `outPath`, using the character's avatar (or a placeholder if it
 * has none) as the source image. */
export async function exportCharacterToPng(character: Character, outPath: string): Promise<void> {
  const cardJson = JSON.stringify(mergeCharacterIntoCardJson(character));
  const avatarPath =
    character.avatarPath ?? (await invoke<string>("ensure_placeholder_avatar"));
  await invoke("export_card_png", { cardJson, avatarPath, outPath });
}

/** Opens a native save dialog and exports the character there, or does
 * nothing if the user cancelled. */
export async function pickAndExportCharacter(character: Character): Promise<string | null> {
  const outPath = await save({
    defaultPath: `${character.name.replace(/[/\\?%*:|"<>]/g, "_")}.png`,
    filters: [{ name: "Character card (PNG)", extensions: ["png"] }],
  });
  if (!outPath) return null;
  await exportCharacterToPng(character, outPath);
  return outPath;
}
