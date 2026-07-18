/** The skill named by the GM's most recent [CHECK:skill name] tag (see
 *  inventoryTags.ts, RISK AND COST) — offered as the quick-roll button's
 *  bonus source. Stored per chat in the settings table, same pattern as
 *  director.ts/gameOver.ts. Cleared whenever the player sends their next
 *  message (see chatStore.ts sendMessage) so a stale hint from several
 *  turns ago can't attach itself to an unrelated later roll. */

import { getSetting, setSetting } from "../db/repositories/settingsRepo";

const pendingCheckKey = (chatId: string) => `pending_check_${chatId}`;

export async function getPendingCheckSkill(chatId: string): Promise<string | null> {
  const raw = await getSetting(pendingCheckKey(chatId));
  return raw && raw.trim() ? raw : null;
}

export async function setPendingCheckSkill(chatId: string, skillName: string): Promise<void> {
  await setSetting(pendingCheckKey(chatId), skillName);
}

export async function clearPendingCheckSkill(chatId: string): Promise<void> {
  await setSetting(pendingCheckKey(chatId), "");
}
