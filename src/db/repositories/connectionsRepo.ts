import type { ConnectionConfig, ConnectionDraft } from "../../providers/types";
import { execute, newId, nowIso, query } from "../database";

interface ConnectionRow {
  id: string;
  name: string;
  provider: string;
  base_url: string | null;
  model: string;
  temperature: number;
  top_p: number;
  max_tokens: number;
  context_budget: number;
  created_at: string;
  updated_at: string;
}

function toConfig(row: ConnectionRow): ConnectionConfig {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider as ConnectionConfig["provider"],
    baseUrl: row.base_url,
    model: row.model,
    temperature: row.temperature,
    topP: row.top_p,
    maxTokens: row.max_tokens,
    contextBudget: row.context_budget,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listConnections(): Promise<ConnectionConfig[]> {
  const rows = await query<ConnectionRow>(
    "SELECT * FROM connections ORDER BY created_at ASC",
    [],
  );
  return rows.map(toConfig);
}

export async function getConnection(id: string): Promise<ConnectionConfig | null> {
  const rows = await query<ConnectionRow>("SELECT * FROM connections WHERE id = $1", [id]);
  return rows[0] ? toConfig(rows[0]) : null;
}

export async function createConnection(draft: ConnectionDraft): Promise<ConnectionConfig> {
  const id = newId();
  const now = nowIso();
  await execute(
    `INSERT INTO connections
      (id, name, provider, base_url, model, temperature, top_p, max_tokens, context_budget, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      id,
      draft.name,
      draft.provider,
      draft.baseUrl,
      draft.model,
      draft.temperature,
      draft.topP,
      draft.maxTokens,
      draft.contextBudget,
      now,
      now,
    ],
  );
  return { id, createdAt: now, updatedAt: now, ...draft };
}

export async function updateConnection(
  id: string,
  draft: ConnectionDraft,
): Promise<ConnectionConfig> {
  const now = nowIso();
  await execute(
    `UPDATE connections SET
      name = $2, provider = $3, base_url = $4, model = $5,
      temperature = $6, top_p = $7, max_tokens = $8, context_budget = $9, updated_at = $10
     WHERE id = $1`,
    [
      id,
      draft.name,
      draft.provider,
      draft.baseUrl,
      draft.model,
      draft.temperature,
      draft.topP,
      draft.maxTokens,
      draft.contextBudget,
      now,
    ],
  );
  const existing = await getConnection(id);
  if (!existing) {
    throw new Error(`Connection ${id} not found after update`);
  }
  return existing;
}

export async function deleteConnection(id: string): Promise<void> {
  await execute("DELETE FROM connections WHERE id = $1", [id]);
}
