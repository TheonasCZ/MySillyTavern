import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { useConnectionsStore } from "../../stores/connectionsStore";
import { ConnectionForm } from "./ConnectionForm";

export function ConnectionsPanel() {
  const { t } = useTranslation("settings");
  const { connections, loaded, load, add, update, remove } = useConnectionsStore();
  const [editingId, setEditingId] = useState<string | "new" | null>(null);

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  return (
    <section
      className="rounded-[var(--radius-lg)] border p-5"
      style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-surface)" }}
    >
      <div className="mb-1 flex items-center justify-between">
        <h2 className="font-[var(--font-display)] text-lg">{t("connections.title")}</h2>
        <button
          type="button"
          onClick={() => setEditingId("new")}
          className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium"
          style={{ backgroundColor: "var(--color-accent)", color: "var(--color-accent-contrast)" }}
        >
          {t("connections.newButton")}
        </button>
      </div>
      <p className="mb-4 text-sm" style={{ color: "var(--color-text-muted)" }}>
        {t("connections.subtitle")}
      </p>

      {connections.length === 0 && editingId === null && (
        <p className="text-sm" style={{ color: "var(--color-text-faint)" }}>
          {t("connections.empty")}
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {connections.map((conn) => (
          <li key={conn.id}>
            {editingId === conn.id ? (
              <ConnectionForm
                initial={conn}
                onSave={async (draft) => update(conn.id, draft)}
                onDelete={async () => {
                  await remove(conn.id);
                  setEditingId(null);
                }}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <button
                type="button"
                onClick={() => setEditingId(conn.id)}
                className="flex w-full items-center justify-between rounded-[var(--radius-md)] border px-4 py-3 text-left transition-colors hover:opacity-90"
                style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-elevated)" }}
              >
                <span>
                  <span className="block font-medium">{conn.name}</span>
                  <span className="block text-xs" style={{ color: "var(--color-text-muted)" }}>
                    {t(`connections.providers.${conn.provider}`)} · {conn.model}
                  </span>
                </span>
              </button>
            )}
          </li>
        ))}
      </ul>

      {editingId === "new" && (
        <div className="mt-3">
          <ConnectionForm
            initial={null}
            onSave={async (draft) => add(draft)}
            onCancel={() => setEditingId(null)}
            onCreated={(created) => setEditingId(created.id)}
          />
        </div>
      )}
    </section>
  );
}
