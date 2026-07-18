import { create } from "zustand";

/** Bridges the active chat's context-budget fill ratio (0.0–1.0) to the
 *  main app Sidebar, which lives outside ChatScreen's component tree and
 *  so can't receive it as a prop. `null` when no chat is open — the
 *  Sidebar hides the indicator in that case. */
interface ContextUsageState {
  value: number | null;
  setValue: (value: number | null) => void;
}

export const useContextUsageStore = create<ContextUsageState>((set) => ({
  value: null,
  setValue: (value) => set({ value }),
}));
