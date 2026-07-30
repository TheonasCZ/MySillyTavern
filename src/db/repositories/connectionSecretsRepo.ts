// Local mirror of encrypted API keys received via sync (M14 follow-up).
// The real key never lives in SQLite — it's stored via `secrets.rs`
// (secrets.json, Rust-only). This table only holds the ciphertext blob +
// timestamp so the sync reader can decide "is this incoming key newer than
// what I already applied" without decrypting on every tick.

import { invoke } from "@tauri-apps/api/core";
import { execute, nowIso, query } from "../database";
import { journalEntityWrite } from "../syncJournal";
import { listConnections } from "./connectionsRepo";

interface ConnectionSecretRow {
  connection_id: string;
  blob: string;
  updated_at: string;
}

export async function getConnectionSecret(connectionId: string): Promise<ConnectionSecretRow | null> {
  const rows = await query<ConnectionSecretRow>(
    "SELECT * FROM connection_secrets WHERE connection_id = $1", [connectionId],
  );
  return rows[0] ?? null;
}

export async function listConnectionSecrets(): Promise<ConnectionSecretRow[]> {
  return query<ConnectionSecretRow>("SELECT * FROM connection_secrets", []);
}

export async function upsertConnectionSecret(connectionId: string, blob: string, updatedAt: string): Promise<void> {
  await execute(
    `INSERT INTO connection_secrets (connection_id, blob, updated_at) VALUES ($1, $2, $3)
     ON CONFLICT (connection_id) DO UPDATE SET blob = excluded.blob, updated_at = excluded.updated_at`,
    [connectionId, blob, updatedAt],
  );
}

export async function deleteConnectionSecret(connectionId: string): Promise<void> {
  await execute("DELETE FROM connection_secrets WHERE connection_id = $1", [connectionId]);
}

/**
 * Encrypts every locally stored API key with the sync passphrase and pushes
 * it into the journal. Covers keys entered *before* the passphrase was set
 * — without this, only keys saved after enabling encrypted sync would ever
 * reach other devices.
 */
export async function pushAllLocalSecretsToSync(): Promise<void> {
  const connections = await listConnections();
  for (const conn of connections) {
    try {
      const blob = await invoke<string | null>("encrypt_secret_for_sync", { connectionId: conn.id });
      if (!blob) continue; // no key stored locally for this connection
      const now = nowIso();
      await upsertConnectionSecret(conn.id, blob, now);
      journalEntityWrite("connectionSecret", { connection_id: conn.id, blob, updated_at: now });
    } catch (err) {
      console.warn(`[sync] failed to push key for connection ${conn.id}:`, err);
    }
  }
}

/**
 * Re-attempts decryption for every synced key mirrored locally. Covers keys
 * that arrived via sync *before* the user set the passphrase on this
 * device — they sit in `connection_secrets` undecrypted until this runs.
 */
export async function retryDecryptAllSyncedSecrets(): Promise<void> {
  const rows = await listConnectionSecrets();
  for (const row of rows) {
    try {
      await invoke("apply_synced_secret", { connectionId: row.connection_id, blob: row.blob });
    } catch (err) {
      console.warn(`[sync] still can't decrypt key for connection ${row.connection_id}:`, err);
    }
  }
}
