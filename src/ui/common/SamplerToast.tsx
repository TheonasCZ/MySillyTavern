import { useSamplerToastStore } from "../useSamplerToast";

export function SamplerToast() {
  const { toasts } = useSamplerToastStore();

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 left-1/2 z-[60] -translate-x-1/2 flex flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className="rounded-[var(--radius-md)] border px-4 py-2.5 text-sm shadow-lg"
          style={{
            borderColor: "var(--color-border-strong)",
            backgroundColor: "var(--color-bg-elevated)",
            color: "var(--color-text)",
            boxShadow: "var(--shadow-panel)",
          }}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
