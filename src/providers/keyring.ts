import { invoke } from "@tauri-apps/api/core";
import { nowIso } from "../db/database";
import { deleteConnectionSecret, upsertConnectionSecret } from "../db/repositories/connectionSecretsRepo";
import { journalEntityDelete, journalEntityWrite } from "../db/syncJournal";

export async function saveApiKey(connectionId: string, key: string): Promise<void> {
  await invoke("set_api_key", { connectionId, key });
  // Best-effort: mirror the (encrypted) key into the sync journal so other
  // devices can pick it up. Silently no-ops if no sync passphrase is set —
  // the key just stays local, same as today.
  try {
    const blob = await invoke<string | null>("encrypt_secret_for_sync", { connectionId });
    if (blob) {
      const now = nowIso();
      await upsertConnectionSecret(connectionId, blob, now);
      journalEntityWrite("connectionSecret", { connection_id: connectionId, blob, updated_at: now });
    }
  } catch (err) {
    console.warn("[sync] failed to encrypt key for sync (passphrase not set?):", err);
  }
}

export async function deleteApiKey(connectionId: string): Promise<void> {
  await invoke("delete_api_key", { connectionId });
  await deleteConnectionSecret(connectionId).catch(() => {});
  journalEntityDelete("connectionSecret", { connection_id: connectionId });
}

export async function hasApiKey(connectionId: string): Promise<boolean> {
  return invoke<boolean>("has_api_key", { connectionId });
}
