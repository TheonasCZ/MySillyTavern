import { create } from "zustand";

import {
  deleteCharacter,
  listCharacters,
  updateCharacterAvatar,
  type Character,
  type CharacterUpdate,
} from "../db/repositories/charactersRepo";

interface CharactersState {
  characters: Character[];
  loaded: boolean;
  load: () => Promise<void>;
  reload: () => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** Patches the in-memory list after a card edit — callers already wrote
   * the DB row themselves (CardEditor uses updateCharacter directly for its
   * large field set); this just keeps the gallery list in sync so a renamed
   * character doesn't show its old name until a full reload. */
  applyPatch: (id: string, patch: Partial<CharacterUpdate>) => void;
  setAvatar: (id: string, avatarPath: string) => Promise<void>;
}

export const useCharactersStore = create<CharactersState>((set, get) => ({
  characters: [],
  loaded: false,

  load: async () => {
    if (get().loaded) return;
    await get().reload();
  },

  reload: async () => {
    const characters = await listCharacters();
    set({ characters, loaded: true });
  },

  remove: async (id) => {
    await deleteCharacter(id);
    set({ characters: get().characters.filter((c) => c.id !== id) });
  },

  applyPatch: (id, patch) => {
    set({
      characters: get().characters.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    });
  },

  setAvatar: async (id, avatarPath) => {
    await updateCharacterAvatar(id, avatarPath);
    set({
      characters: get().characters.map((c) => (c.id === id ? { ...c, avatarPath } : c)),
    });
  },
}));
