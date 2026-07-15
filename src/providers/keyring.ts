import { invoke } from "@tauri-apps/api/core";

export async function saveApiKey(connectionId: string, key: string): Promise<void> {
  await invoke("set_api_key", { connectionId, key });
}

export async function deleteApiKey(connectionId: string): Promise<void> {
  await invoke("delete_api_key", { connectionId });
}

export async function hasApiKey(connectionId: string): Promise<boolean> {
  return invoke<boolean>("has_api_key", { connectionId });
}
