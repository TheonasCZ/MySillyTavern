import { useTranslation } from "react-i18next";
import { useUndoStore } from "../useUndoToast";

export function UndoToast() {
  const { t } = useTranslation("common");
  const { pending, undo, dismiss } = useUndoStore();

  if (!pending) return null;

  return (
    <div
      className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-[var(--radius-md)] border px-4 py-2.5 text-sm shadow-lg"
      style={{
        borderColor: "var(--color-border-strong)",
        backgroundColor: "var(--color-bg-elevated)",
        color: "var(--color-text)",
        boxShadow: "var(--shadow-panel)",
      }}
      role="status"
      aria-live="polite"
    >
      <span className="mr-3">{pending.label}</span>
      <button
        type="button"
        onClick={() => void undo()}
        className="font-medium underline"
        style={{ color: "var(--color-accent)" }}
      >
        {t("undo")}
      </button>
      <button
        type="button"
        onClick={dismiss}
        className="ml-2 opacity-60 hover:opacity-100"
        aria-label={t("actions.close")}
      >
        ✕
      </button>
    </div>
  );
}
