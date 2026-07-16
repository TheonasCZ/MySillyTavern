import { create } from "zustand";

import {
  createLorebook,
  deleteLorebook,
  listLorebooks,
  updateLorebook,
  type Lorebook,
  type LorebookDraft,
} from "../db/repositories/lorebooksRepo";

interface LorebooksState {
  lorebooks: Lorebook[];
  loaded: boolean;
  load: () => Promise<void>;
  reload: () => Promise<void>;
  create: (draft: LorebookDraft) => Promise<Lorebook>;
  update: (id: string, patch: LorebookDraft) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export const useLorebooksStore = create<LorebooksState>((set, get) => ({
  lorebooks: [],
  loaded: false,

  load: async () => {
    if (get().loaded) return;
    await get().reload();
  },

  reload: async () => {
    const lorebooks = await listLorebooks();
    set({ lorebooks, loaded: true });
  },

  create: async (draft) => {
    const lorebook = await createLorebook(draft);
    set({ lorebooks: [...get().lorebooks, lorebook] });
    return lorebook;
  },

  update: async (id, patch) => {
    await updateLorebook(id, patch);
    set({ lorebooks: get().lorebooks.map((l) => (l.id === id ? { ...l, ...patch } : l)) });
  },

  remove: async (id) => {
    await deleteLorebook(id);
    set({ lorebooks: get().lorebooks.filter((l) => l.id !== id) });
  },
}));
