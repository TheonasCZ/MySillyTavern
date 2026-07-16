import { create } from "zustand";

import {
  deleteCharacter,
  listCharacters,
  type Character,
} from "../db/repositories/charactersRepo";

interface CharactersState {
  characters: Character[];
  loaded: boolean;
  load: () => Promise<void>;
  reload: () => Promise<void>;
  remove: (id: string) => Promise<void>;
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
}));
