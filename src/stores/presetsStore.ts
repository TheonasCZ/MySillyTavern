import { create } from "zustand";

import {
  createPreset,
  deletePreset,
  listPresets,
  updatePreset,
  type Preset,
  type PresetDraft,
  type PresetUpdate,
} from "../db/repositories/presetsRepo";

interface PresetsState {
  presets: Preset[];
  loaded: boolean;
  load: () => Promise<void>;
  create: (draft: PresetDraft) => Promise<Preset>;
  update: (id: string, patch: PresetUpdate) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export const usePresetsStore = create<PresetsState>((set, get) => ({
  presets: [],
  loaded: false,

  load: async () => {
    const presets = await listPresets();
    set({ presets, loaded: true });
  },

  create: async (draft) => {
    const preset = await createPreset(draft);
    set({ presets: [...get().presets, preset] });
    return preset;
  },

  update: async (id, patch) => {
    await updatePreset(id, patch);
    const presets = await listPresets();
    set({ presets });
  },

  remove: async (id) => {
    await deletePreset(id);
    set({ presets: get().presets.filter((p) => p.id !== id) });
  },
}));
