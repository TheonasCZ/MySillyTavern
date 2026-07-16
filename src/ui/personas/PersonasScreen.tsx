import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { avatarSrc } from "../characters/avatarSrc";
import { usePersonasStore } from "../../stores/personasStore";
import { PersonaForm } from "./PersonaForm";

export function PersonasScreen() {
  const { t } = useTranslation(["personas", "common"]);
  const { personas, loaded, load, create, update, setAvatar, setDefault, remove } = usePersonasStore();
  const [editingId, setEditingId] = useState<string | "new" | null>(null);

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-8">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-[var(--font-display)] text-2xl">{t("title")}</h1>
        <button
          type="button"
          onClick={() => setEditingId("new")}
          className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium"
          style={{ backgroundColor: "var(--color-accent)", color: "var(--color-accent-contrast)" }}
        >
          {t("newButton")}
        </button>
      </div>
      <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
        {t("subtitle")}
      </p>

      {personas.length === 0 && editingId === null && (
        <p className="text-sm" style={{ color: "var(--color-text-faint)" }}>
          {t("empty")}
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {personas.map((persona) => (
          <li key={persona.id}>
            {editingId === persona.id ? (
              <PersonaForm
                initial={persona}
                onSave={(patch) => update(persona.id, patch as { name: string; description: string })}
                onDelete={async () => {
                  await remove(persona.id);
                  setEditingId(null);
                }}
                onSetDefault={() => setDefault(persona.id)}
                onPickAvatar={(path) => setAvatar(persona.id, path)}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <button
                type="button"
                onClick={() => setEditingId(persona.id)}
                className="flex w-full items-center gap-3 rounded-[var(--radius-md)] border px-4 py-3 text-left transition-colors hover:opacity-90"
                style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-elevated)" }}
              >
                <div
                  className="h-10 w-10 shrink-0 overflow-hidden rounded-full"
                  style={{ backgroundColor: "var(--color-surface-2)" }}
                >
                  {avatarSrc(persona.avatarPath) ? (
                    <img src={avatarSrc(persona.avatarPath)} alt={persona.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <span className="text-sm" style={{ color: "var(--color-text-faint)" }}>
                        {persona.name.slice(0, 1).toUpperCase()}
                      </span>
                    </div>
                  )}
                </div>
                <span className="flex-1">
                  <span className="block font-medium">{persona.name}</span>
                  {persona.description && (
                    <span className="block truncate text-xs" style={{ color: "var(--color-text-muted)" }}>
                      {persona.description}
                    </span>
                  )}
                </span>
                {persona.isDefault && (
                  <span
                    className="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium"
                    style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-accent)" }}
                  >
                    {t("defaultBadge")}
                  </span>
                )}
              </button>
            )}
          </li>
        ))}
      </ul>

      {editingId === "new" && (
        <PersonaForm
          initial={null}
          onSave={async (draft) => {
            await create(draft as { name: string; description: string; avatarPath: string | null });
            setEditingId(null);
          }}
          onCancel={() => setEditingId(null)}
        />
      )}
    </div>
  );
}
