import { execute, newId, nowIso, query } from "../database";

export interface FactionRep {
  id: string;
  personaId: string;
  factionName: string;
  reputation: number;
  createdAt: string;
  updatedAt: string;
}

interface FactionRow {
  id: string;
  persona_id: string;
  faction_name: string;
  reputation: number;
  created_at: string;
  updated_at: string;
}

function toFactionRep(row: FactionRow): FactionRep {
  return {
    id: row.id,
    personaId: row.persona_id,
    factionName: row.faction_name,
    reputation: row.reputation,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** All faction standings for a persona, ordered by name. */
export async function listFactions(personaId: string): Promise<FactionRep[]> {
  const rows = await query<FactionRow>(
    "SELECT * FROM faction_reputations WHERE persona_id = $1 ORDER BY faction_name ASC",
    [personaId],
  );
  return rows.map(toFactionRep);
}

/** Adjust reputation by `delta`, clamped to [-100, 100]. Returns the updated row. */
export async function updateReputation(
  id: string,
  delta: number,
): Promise<FactionRep | null> {
  await execute(
    `UPDATE faction_reputations
     SET reputation = MAX(-100, MIN(100, reputation + $2)),
         updated_at = $3
     WHERE id = $1`,
    [id, delta, nowIso()],
  );
  const rows = await query<FactionRow>(
    "SELECT * FROM faction_reputations WHERE id = $1",
    [id],
  );
  return rows[0] ? toFactionRep(rows[0]) : null;
}

/** Create a new faction standing for a persona, or return the existing row
 *  if this persona already has a record for that faction name. */
export async function createFaction(
  personaId: string,
  factionName: string,
  initialReputation: number = 0,
): Promise<FactionRep> {
  const existing = await query<FactionRow>(
    "SELECT * FROM faction_reputations WHERE persona_id = $1 AND faction_name = $2",
    [personaId, factionName],
  );
  if (existing[0]) return toFactionRep(existing[0]);

  const id = newId();
  const now = nowIso();
  const clamped = Math.max(-100, Math.min(100, initialReputation));
  await execute(
    `INSERT INTO faction_reputations (id, persona_id, faction_name, reputation, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $5)`,
    [id, personaId, factionName, clamped, now],
  );
  return {
    id,
    personaId,
    factionName,
    reputation: clamped,
    createdAt: now,
    updatedAt: now,
  };
}
