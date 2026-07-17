/** Character Card V2 (`chara_card_v2`) and V3 (`chara_card_v3`) types, per
 * the community spec used by SillyTavern-compatible cards. We only model
 * the fields we actually read/write — `card_json` keeps the untouched
 * original for lossless export regardless of what this file knows about. */

export interface CardBookEntryV2 {
  keys: string[];
  secondary_keys?: string[];
  content: string;
  comment?: string;
  constant?: boolean;
  selective?: boolean;
  insertion_order?: number;
  enabled?: boolean;
  case_sensitive?: boolean;
  priority?: number;
  id?: number;
  name?: string;
}

export interface CardBookV2 {
  name?: string;
  description?: string;
  entries: CardBookEntryV2[];
}

export interface CharacterCardV2 {
  spec: "chara_card_v2";
  spec_version: string;
  data: {
    name: string;
    description?: string;
    personality?: string;
    scenario?: string;
    first_mes?: string;
    mes_example?: string;
    creator_notes?: string;
    system_prompt?: string;
    post_history_instructions?: string;
    alternate_greetings?: string[];
    tags?: string[];
    creator?: string;
    character_version?: string;
    extensions?: Record<string, unknown>;
    character_book?: CardBookV2;
  };
}

export interface CharacterCardV3 {
  spec: "chara_card_v3";
  spec_version: string;
  data: CharacterCardV2["data"] & {
    group_only_greetings?: string[];
    creation_date?: number;
    modification_date?: number;
  };
}

export type CharacterCard = CharacterCardV2 | CharacterCardV3;

/** DB-shape view of a character card's fields, independent of the on-disk
 * spec version — used to populate `characters` table columns. */
export interface NormalizedCard {
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
  specVersion: "v2" | "v3";
  characterBook: CardBookV2 | null;
}

function isV3(card: CharacterCard): card is CharacterCardV3 {
  return card.spec === "chara_card_v3";
}

/** Accepts a parsed card JSON object (V2 or V3) and returns the flattened
 * shape used to populate `characters` table columns. Unrecognized/missing
 * fields default to empty strings/arrays so a partial or malformed card
 * still imports something usable. */
export function normalizeCard(card: CharacterCard): NormalizedCard {
  const data = card.data ?? ({} as CharacterCard["data"]);
  return {
    name: data.name?.trim() || "Bez jména",
    description: data.description ?? "",
    personality: data.personality ?? "",
    scenario: data.scenario ?? "",
    firstMes: data.first_mes ?? "",
    mesExample: data.mes_example ?? "",
    alternateGreetings: Array.isArray(data.alternate_greetings) ? data.alternate_greetings : [],
    systemPrompt: data.system_prompt ?? "",
    postHistoryInstructions: data.post_history_instructions ?? "",
    creatorNotes: data.creator_notes ?? "",
    tags: Array.isArray(data.tags) ? data.tags : [],
    specVersion: isV3(card) ? "v3" : "v2",
    characterBook: data.character_book ?? null,
  };
}

/** MySillyTavern-specific extensions stored in the `extensions.mysillytavern`
 * namespace of V2/V3 character cards. ST ignores unknown extensions, so this
 * is lossless for ST users and roundtrips through our import/export. */
export interface MySillyTavernExtensions {
  /** TTS voice URI assigned to this character. */
  ttsVoice?: string;
  /** Preset ID recommended for chats with this character. */
  recommendedPreset?: string;
  /** Default director parameters for new chats. */
  directorDefaults?: {
    pace?: string;
    tone?: string;
    focus?: string;
  };
}

/** Fields for a fresh character created from scratch in the editor
 * (as opposed to imported from a card file). */
export function blankNormalizedCard(name: string): NormalizedCard {
  return {
    name,
    description: "",
    personality: "",
    scenario: "",
    firstMes: "",
    mesExample: "",
    alternateGreetings: [],
    systemPrompt: "",
    postHistoryInstructions: "",
    creatorNotes: "",
    tags: [],
    specVersion: "v2",
    characterBook: null,
  };
}

/** Parses raw card JSON text into a `CharacterCard`, tolerating cards that
 * omit `spec`/`spec_version` (some exporters do) by defaulting to V2. */
export function parseCardJson(text: string): CharacterCard {
  const parsed = JSON.parse(text) as Partial<CharacterCard> & { data?: CharacterCard["data"] };
  if (!parsed.data) {
    throw new Error("Karta neobsahuje pole 'data'.");
  }
  const spec = parsed.spec === "chara_card_v3" ? "chara_card_v3" : "chara_card_v2";
  return {
    ...parsed,
    spec,
    spec_version: parsed.spec_version ?? (spec === "chara_card_v3" ? "3.0" : "2.0"),
  } as CharacterCard;
}

/** Builds a V2 card JSON object from the current DB-shape fields of a
 * character, for export. We always export as V2 for maximum compatibility
 * — V3-only fields aren't modeled by this app yet (M4+ lorebook UI may add
 * some), and V2 readers can still open the result.
 *
 * When `extensions` is provided it is written into
 * `data.extensions.mysillytavern`, preserving the spec-compliant
 * `extensions` namespace so ST ignores it. */
export function buildCardV2Json(
  card: NormalizedCard,
  mstExtensions?: MySillyTavernExtensions,
): CharacterCardV2 {
  const data: CharacterCardV2["data"] = {
    name: card.name,
    description: card.description,
    personality: card.personality,
    scenario: card.scenario,
    first_mes: card.firstMes,
    mes_example: card.mesExample,
    creator_notes: card.creatorNotes,
    system_prompt: card.systemPrompt,
    post_history_instructions: card.postHistoryInstructions,
    alternate_greetings: card.alternateGreetings,
    tags: card.tags,
    character_book: card.characterBook ?? undefined,
  };
  if (mstExtensions) {
    data.extensions = { mysillytavern: mstExtensions as Record<string, unknown> };
  }
  return {
    spec: "chara_card_v2",
    spec_version: "2.0",
    data,
  };
}
