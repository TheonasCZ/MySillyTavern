import { create } from "zustand";

import {
  createPersona,
  deletePersona,
  listPersonas,
  setDefaultPersona,
  updatePersona,
  updatePersonaAvatar,
  type Persona,
  type PersonaDraft,
  type PersonaUpdate,
} from "../db/repositories/personasRepo";

interface PersonasState {
  personas: Persona[];
  loaded: boolean;
  load: () => Promise<void>;
  reload: () => Promise<void>;
  create: (draft: PersonaDraft) => Promise<Persona>;
  update: (id: string, patch: PersonaUpdate) => Promise<void>;
  setAvatar: (id: string, avatarPath: string | null) => Promise<void>;
  setDefault: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export const usePersonasStore = create<PersonasState>((set, get) => ({
  personas: [],
  loaded: false,

  load: async () => {
    if (get().loaded) return;
    await get().reload();
  },

  reload: async () => {
    const personas = await listPersonas();
    set({ personas, loaded: true });
  },

  create: async (draft) => {
    const persona = await createPersona(draft);
    await get().reload();
    return persona;
  },

  update: async (id, patch) => {
    await updatePersona(id, patch);
    set({
      personas: get().personas.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    });
  },

  setAvatar: async (id, avatarPath) => {
    await updatePersonaAvatar(id, avatarPath);
    set({ personas: get().personas.map((p) => (p.id === id ? { ...p, avatarPath } : p)) });
  },

  setDefault: async (id) => {
    await setDefaultPersona(id);
    set({
      personas: get().personas.map((p) => ({ ...p, isDefault: p.id === id })),
    });
  },

  remove: async (id) => {
    await deletePersona(id);
    set({ personas: get().personas.filter((p) => p.id !== id) });
  },
}));
