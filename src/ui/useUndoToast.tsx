import { create } from "zustand";

interface UndoAction {
  /** What was deleted (e.g. "Chat: My Adventure") */
  label: string;
  /** Async callback to restore the deleted item */
  onUndo: () => Promise<void>;
}

interface UndoState {
  /** Currently pending undo action, or null */
  pending: UndoAction | null;
  /** Timer id for auto-dismiss */
  timerId: ReturnType<typeof setTimeout> | null;
  /** Show an undo toast */
  show: (action: UndoAction) => void;
  /** Execute undo and clear the toast */
  undo: () => Promise<void>;
  /** Dismiss the toast without undoing */
  dismiss: () => void;
}

const TOAST_DURATION_MS = 5000;

export const useUndoStore = create<UndoState>((set, get) => ({
  pending: null,
  timerId: null,
  show: (action) => {
    const prev = get().timerId;
    if (prev) clearTimeout(prev);
    const timerId = setTimeout(() => {
      set({ pending: null, timerId: null });
    }, TOAST_DURATION_MS);
    set({ pending: action, timerId });
  },
  undo: async () => {
    const { pending, timerId } = get();
    if (timerId) clearTimeout(timerId);
    set({ pending: null, timerId: null });
    if (pending) {
      try {
        await pending.onUndo();
      } catch {
        // Undo failed — not much we can do at the toast level
      }
    }
  },
  dismiss: () => {
    const { timerId } = get();
    if (timerId) clearTimeout(timerId);
    set({ pending: null, timerId: null });
  },
}));

/** Hook that returns a show-undo helper for a given i18n label and undo callback. */
export function useUndoToast() {
  const { show } = useUndoStore();
  return {
    /** Call after deleting an entity — shows the undo toast. */
    toastUndo: (label: string, onUndo: () => Promise<void>) => {
      show({ label, onUndo });
    },
  };
}
