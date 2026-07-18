import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { listQuests, type Quest } from "../../db/repositories/questsRepo";

interface Props {
  chatId: string;
  onClose: () => void;
}

/** Status → badge colour + label mapping. */
const STATUS_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  active: {
    bg: "var(--color-accent)",
    text: "var(--color-accent-contrast)",
    label: "",
  },
  completed: {
    bg: "var(--color-success, #2e7d32)",
    text: "#fff",
    label: "",
  },
  failed: {
    bg: "var(--color-danger, #c62828)",
    text: "#fff",
    label: "",
  },
};

/** Group quests by status, ordered active → completed → failed. */
function groupQuests(quests: Quest[]): Record<string, Quest[]> {
  const groups: Record<string, Quest[]> = { active: [], completed: [], failed: [] };
  for (const q of quests) {
    (groups[q.status] ??= []).push(q);
  }
  return groups;
}

export function QuestPanel({ chatId, onClose }: Props) {
  const { t } = useTranslation("chat");
  const [quests, setQuests] = useState<Quest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const qs = await listQuests(chatId);
        setQuests(qs);
      } catch {
        // silently ignore
      } finally {
        setLoading(false);
      }
    })();
  }, [chatId]);

  const grouped = groupQuests(quests);
  const statusOrder: Array<"active" | "completed" | "failed"> = ["active", "completed", "failed"];
  const statusLabels: Record<string, string> = {
    active: t("quests.statusActive", "Aktivní"),
    completed: t("quests.statusCompleted", "Splněno"),
    failed: t("quests.statusFailed", "Neúspěch"),
  };

  return (
    <aside
      className="flex h-full w-72 shrink-0 flex-col border-l"
      style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-surface)" }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between border-b px-3 py-2"
        style={{ borderColor: "var(--color-border)" }}
      >
        <h3 className="font-[var(--font-display)] text-sm">
          {t("quests.title", "Deník úkolů")}
        </h3>
        <button onClick={onClose} className="text-xs" style={{ color: "var(--color-text-faint)" }}>
          ✕
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-3">
        {loading ? (
          <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
            {t("state.loading", { ns: "common", defaultValue: "Načítání…" })}
          </p>
        ) : quests.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
            {t("quests.empty", "Zatím žádné úkoly.")}
          </p>
        ) : (
          statusOrder.map((status) => {
            const items = grouped[status];
            if (!items || items.length === 0) return null;
            return (
              <div key={status} className="mb-4">
                <h4
                  className="mb-2 text-[0.625em] font-bold uppercase tracking-wider"
                  style={{ color: "var(--color-text-faint)" }}
                >
                  {statusLabels[status]}
                </h4>
                <div className="flex flex-col gap-2">
                  {items.map((q) => (
                    <div
                      key={q.id}
                      className="rounded-[var(--radius-md)] border p-3"
                      style={{
                        borderColor: "var(--color-border)",
                        backgroundColor: "var(--color-bg-elevated)",
                      }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-medium">{q.name}</span>
                        <span
                          className="shrink-0 rounded-full px-1.5 py-0.5 text-[0.5625em] font-bold uppercase"
                          style={{
                            backgroundColor: STATUS_STYLE[q.status]?.bg ?? "var(--color-surface-2)",
                            color: STATUS_STYLE[q.status]?.text ?? "var(--color-text-muted)",
                          }}
                        >
                          {statusLabels[q.status]}
                        </span>
                      </div>
                      {q.description && (
                        <p
                          className="mt-2 whitespace-pre-wrap text-xs leading-relaxed"
                          style={{ color: "var(--color-text-muted)" }}
                        >
                          {q.description}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
