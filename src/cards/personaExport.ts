import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

import type { Persona, PersonaDraft } from "../db/repositories/personasRepo";

/** Our internal persona card format — stores structured fields in `extensions`
 *  while also providing a `description` for SillyTavern compatibility. */
interface PersonaCard {
  spec: "persona_card_v1";
  spec_version: "1.0";
  data: {
    name: string;
    description: string;
    gender: string;
    age: number | null;
    race: string;
    appearance: string;
    skills: { name: string; level: number }[];
    inventory: { item: string; qty: number; note?: string }[];
    /** Raw extensions object from original card (preserved for round-trip) */
    extensions: Record<string, unknown>;
  };
}

function personaToCard(persona: Persona): PersonaCard {
  return {
    spec: "persona_card_v1",
    spec_version: "1.0",
    data: {
      name: persona.name,
      description: persona.description,
      gender: persona.gender,
      age: persona.age,
      race: persona.race,
      appearance: persona.appearance,
      skills: persona.skills,
      inventory: persona.inventory,
      extensions: {},
    },
  };
}

function cardToDraft(card: PersonaCard): PersonaDraft {
  return {
    name: card.data.name,
    gender: card.data.gender,
    age: card.data.age,
    race: card.data.race,
    appearance: card.data.appearance,
    skills: card.data.skills ?? [],
    inventory: card.data.inventory ?? [],
    avatarPath: null,
  };
}

/** Serialises a persona to a JSON card string. */
export function personaToCardJson(persona: Persona): string {
  return JSON.stringify(personaToCard(persona), null, 2);
}

/** Parses a persona card JSON string and returns a draft ready for creation. */
export function cardJsonToDraft(json: string): PersonaDraft {
  const card = JSON.parse(json) as PersonaCard;
  // Handle SillyTavern-style personas (just name+description) by synthesising
  // structured fields from the description.
  if (!card.data.gender && !card.data.appearance && card.data.description) {
    return {
      name: card.data.name,
      gender: "",
      age: null,
      race: "",
      appearance: card.data.description,
      skills: [],
      inventory: [],
      avatarPath: null,
    };
  }
  return cardToDraft(card);
}

/** Opens a native save dialog and exports the persona as a JSON file. */
export async function pickAndExportPersona(persona: Persona): Promise<string | null> {
  const outPath = await save({
    defaultPath: `${persona.name.replace(/[/\\?%*:|"<>]/g, "_")}.persona.json`,
    filters: [{ name: "Persona (JSON)", extensions: ["json"] }],
  });
  if (!outPath) return null;
  await invoke("write_text_file", { path: outPath, content: personaToCardJson(persona) });
  return outPath;
}

/** Opens a native save dialog and exports the persona as a PNG card
 *  (same format as character cards, for SillyTavern compatibility). */
export async function pickAndExportPersonaAsPng(persona: Persona): Promise<string | null> {
  const outPath = await save({
    defaultPath: `${persona.name.replace(/[/\\?%*:|"<>]/g, "_")}.png`,
    filters: [{ name: "PNG", extensions: ["png"] }],
  });
  if (!outPath) return null;

  // Build a character-card-style JSON (ST understands this)
  const stCard = {
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: {
      name: persona.name,
      description: persona.description,
      extensions: {
        persona_v1: {
          gender: persona.gender,
          age: persona.age,
          race: persona.race,
          appearance: persona.appearance,
          skills: persona.skills,
          inventory: persona.inventory,
        },
      },
      // ST-compatible fields (minimal — persona isn't a character)
      personality: "",
      scenario: "",
      first_mes: "",
      mes_example: "",
      system_prompt: "",
      post_history_instructions: "",
      creator_notes: "",
      tags: [],
    },
  };

  const cardJson = JSON.stringify(stCard);
  const avatarPath = persona.avatarPath ?? (await invoke<string>("ensure_placeholder_avatar"));
  await invoke("export_card_png", { cardJson, avatarPath, outPath });
  return outPath;
}

/** Opens a native open dialog and imports a persona from a JSON file.
 *  Returns the draft or null if cancelled. */
export async function pickAndImportPersona(): Promise<PersonaDraft | null> {
  const path = await open({
    multiple: false,
    filters: [{ name: "Persona (JSON)", extensions: ["json"] }],
  });
  if (!path || Array.isArray(path)) return null;
  const content = await invoke<string>("read_text_file", { path: path as string });
  return cardJsonToDraft(content);
}

/** Opens a native open dialog and imports a persona from a PNG card.
 *  Returns the draft or null if cancelled. */
export async function pickAndImportPersonaFromPng(): Promise<PersonaDraft | null> {
  const path = await open({
    multiple: false,
    filters: [{ name: "PNG", extensions: ["png"] }],
  });
  if (!path || Array.isArray(path)) return null;
  const result = await invoke<{ card_json: string }>("import_card_png", { path: path as string });
  const card = JSON.parse(result.card_json);
  const data = card.data ?? card;

  // Try our v1 persona extension first
  const ext = data.extensions?.persona_v1;
  if (ext) {
    return {
      name: data.name ?? ext.name ?? "",
      gender: ext.gender ?? "",
      age: ext.age ?? null,
      race: ext.race ?? "",
      appearance: ext.appearance ?? "",
      skills: ext.skills ?? [],
      inventory: ext.inventory ?? [],
      avatarPath: null,
    };
  }

  // Fallback: SillyTavern persona (name + description only)
  return {
    name: data.name ?? "",
    gender: "",
    age: null,
    race: "",
    appearance: data.description ?? "",
    skills: [],
    inventory: [],
    avatarPath: null,
  };
}
