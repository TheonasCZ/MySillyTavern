import { execute, newId, nowIso, query } from "../database";

export interface CraftingRecipe {
  id: string;
  personaId: string;
  resultItem: string;
  ingredients: string[];
  skillName: string | null;
  tier: number;
  perks: string[];
  description: string | null;
  craftedAt: string | null;
}

interface CraftingRecipeRow {
  id: string;
  persona_id: string;
  result_item: string;
  ingredients: string; // JSON array of strings
  skill_name: string | null;
  tier: number;
  perks: string; // JSON array of strings
  description: string | null;
  crafted_at: string | null;
}

function parseJsonArray(raw: string): string[] {
  try {
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

function toCraftingRecipe(row: CraftingRecipeRow): CraftingRecipe {
  return {
    id: row.id,
    personaId: row.persona_id,
    resultItem: row.result_item,
    ingredients: parseJsonArray(row.ingredients),
    skillName: row.skill_name,
    tier: row.tier,
    perks: parseJsonArray(row.perks),
    description: row.description,
    craftedAt: row.crafted_at,
  };
}

/** List all recipes for a persona, ordered by tier descending, then by result name. */
export async function listRecipes(personaId: string): Promise<CraftingRecipe[]> {
  const rows = await query<CraftingRecipeRow>(
    `SELECT * FROM crafting_recipes WHERE persona_id = $1
     ORDER BY tier DESC, result_item ASC`,
    [personaId],
  );
  return rows.map(toCraftingRecipe);
}

/** Get a single recipe by result item name (case-insensitive). */
export async function getRecipeByResult(
  personaId: string,
  resultItem: string,
): Promise<CraftingRecipe | null> {
  const rows = await query<CraftingRecipeRow>(
    "SELECT * FROM crafting_recipes WHERE persona_id = $1 AND LOWER(result_item) = LOWER($2)",
    [personaId, resultItem],
  );
  return rows[0] ? toCraftingRecipe(rows[0]) : null;
}

export interface CreateRecipeInput {
  personaId: string;
  resultItem: string;
  ingredients: string[];
  skillName?: string;
  tier?: number;
  description?: string;
}

/** Create a new crafting recipe (not yet crafted — perks and craftedAt are empty). */
export async function createRecipe(input: CreateRecipeInput): Promise<CraftingRecipe> {
  const id = newId();
  
  await execute(
    `INSERT INTO crafting_recipes (id, persona_id, result_item, ingredients, skill_name, tier, perks, description, crafted_at)
     VALUES ($1, $2, $3, $4, $5, $6, '[]', $7, NULL)`,
    [
      id,
      input.personaId,
      input.resultItem,
      JSON.stringify(input.ingredients),
      input.skillName ?? null,
      input.tier ?? 0,
      input.description ?? null,
    ],
  );
  return {
    id,
    personaId: input.personaId,
    resultItem: input.resultItem,
    ingredients: input.ingredients,
    skillName: input.skillName ?? null,
    tier: input.tier ?? 0,
    perks: [],
    description: input.description ?? null,
    craftedAt: null,
  };
}

/** Update a recipe's perks and set crafted_at when the item is crafted. */
export async function updateRecipePerks(
  id: string,
  perks: string[],
): Promise<void> {
  
  await execute(
    `UPDATE crafting_recipes SET perks = $2, crafted_at = $3 WHERE id = $1`,
    [id, JSON.stringify(perks), nowIso()],
  );
}

// ── Chat-scoped recipes ──────────────────────────────────────────────
// Persona is a template — chat owns its own recipe list. These functions
// mirror the persona-scoped ones above but operate on chat_crafting_recipes.

interface ChatCraftingRecipeRow {
  id: string;
  chat_id: string;
  result_item: string;
  ingredients: string;
  skill_name: string | null;
  tier: number;
  perks: string;
  description: string | null;
  crafted_at: string | null;
}

/** A crafting recipe owned by a specific chat. Same shape as persona-scoped
 *  recipes, just keyed by chat_id instead of persona_id. */
export interface ChatCraftingRecipe {
  id: string;
  chatId: string;
  resultItem: string;
  ingredients: string[];
  skillName: string | null;
  tier: number;
  perks: string[];
  description: string | null;
  craftedAt: string | null;
}

function toChatCraftingRecipe(row: ChatCraftingRecipeRow): ChatCraftingRecipe {
  return {
    id: row.id,
    chatId: row.chat_id,
    resultItem: row.result_item,
    ingredients: parseJsonArray(row.ingredients),
    skillName: row.skill_name,
    tier: row.tier,
    perks: parseJsonArray(row.perks),
    description: row.description,
    craftedAt: row.crafted_at,
  };
}

/** List all recipes for a chat. */
export async function listChatRecipes(chatId: string): Promise<ChatCraftingRecipe[]> {
  const rows = await query<ChatCraftingRecipeRow>(
    `SELECT * FROM chat_crafting_recipes WHERE chat_id = $1
     ORDER BY tier DESC, result_item ASC`,
    [chatId],
  );
  return rows.map(toChatCraftingRecipe);
}

/** Copy all recipes from a persona template into a new chat. */
export async function copyRecipesToChat(chatId: string, personaId: string): Promise<void> {
  const personaRecipes = await listRecipes(personaId);
  for (const r of personaRecipes) {
    const id = newId();
    await execute(
      `INSERT INTO chat_crafting_recipes (id, chat_id, result_item, ingredients, skill_name, tier, perks, description, crafted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL)`,
      [
        id,
        chatId,
        r.resultItem,
        JSON.stringify(r.ingredients),
        r.skillName,
        r.tier,
        JSON.stringify(r.perks),
        r.description,
      ],
    );
  }
}

/** Get a single chat recipe by result item name (case-insensitive). */
export async function getChatRecipeByResult(
  chatId: string,
  resultItem: string,
): Promise<ChatCraftingRecipe | null> {
  const rows = await query<ChatCraftingRecipeRow>(
    "SELECT * FROM chat_crafting_recipes WHERE chat_id = $1 AND LOWER(result_item) = LOWER($2)",
    [chatId, resultItem],
  );
  return rows[0] ? toChatCraftingRecipe(rows[0]) : null;
}

/** Create a new chat-scoped recipe. */
export async function createChatRecipe(input: {
  chatId: string;
  resultItem: string;
  ingredients: string[];
  skillName?: string;
  tier?: number;
  description?: string;
}): Promise<ChatCraftingRecipe> {
  const id = newId();
  await execute(
    `INSERT INTO chat_crafting_recipes (id, chat_id, result_item, ingredients, skill_name, tier, perks, description, crafted_at)
     VALUES ($1, $2, $3, $4, $5, $6, '[]', $7, NULL)`,
    [
      id,
      input.chatId,
      input.resultItem,
      JSON.stringify(input.ingredients),
      input.skillName ?? null,
      input.tier ?? 0,
      input.description ?? null,
    ],
  );
  return {
    id,
    chatId: input.chatId,
    resultItem: input.resultItem,
    ingredients: input.ingredients,
    skillName: input.skillName ?? null,
    tier: input.tier ?? 0,
    perks: [],
    description: input.description ?? null,
    craftedAt: null,
  };
}

/** Update a chat recipe's perks when the item is crafted. */
export async function updateChatRecipePerks(
  id: string,
  perks: string[],
): Promise<void> {
  await execute(
    `UPDATE chat_crafting_recipes SET perks = $2, crafted_at = $3 WHERE id = $1`,
    [id, JSON.stringify(perks), nowIso()],
  );
}
