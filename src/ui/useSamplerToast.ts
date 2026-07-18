import { create } from "zustand";

interface SamplerToastItem {
  message: string;
  id: number;
}

interface SamplerToastState {
  toasts: SamplerToastItem[];
  show: (message: string) => void;
  dismiss: (id: number) => void;
}

let nextId = 0;
const TOAST_DURATION_MS = 5000;

export const useSamplerToastStore = create<SamplerToastState>((set, get) => ({
  toasts: [],
  show: (message) => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { message, id }] }));
    setTimeout(() => {
      get().dismiss(id);
    }, TOAST_DURATION_MS);
  },
  dismiss: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));
