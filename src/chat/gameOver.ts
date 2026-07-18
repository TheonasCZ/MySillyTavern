/** Hardcore-mode game over state: set when the model emits [GAMEOVER:reason]
 *  while chat.hardcoreMode is on (see inventoryProcessor.ts, chatsRepo.ts).
 *  Stored as one JSON blob per chat in the settings table, same pattern as
 *  director.ts. */

import { getSetting, setSetting } from "../db/repositories/settingsRepo";

export interface GameOverState {
  reason: string;
  at: string;
}

const gameOverKey = (chatId: string) => `gameover_${chatId}`;

export async function getGameOverState(chatId: string): Promise<GameOverState | null> {
  try {
    const raw = await getSetting(gameOverKey(chatId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GameOverState>;
    if (typeof parsed.reason === "string" && typeof parsed.at === "string") {
      return { reason: parsed.reason, at: parsed.at };
    }
    return null;
  } catch {
    return null;
  }
}

export async function setGameOverState(chatId: string, reason: string): Promise<void> {
  const state: GameOverState = { reason, at: new Date().toISOString() };
  await setSetting(gameOverKey(chatId), JSON.stringify(state));
}
