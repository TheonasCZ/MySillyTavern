import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { avatarSrc } from "../characters/avatarSrc";
import { usePersonasStore } from "../../stores/personasStore";
import { PersonaForm } from "./PersonaForm";
import { pickAndExportPersona, pickAndExportPersonaAsPng, pickAndImportPersona, pickAndImportPersonaFromPng } from "../../cards/personaExport";
import type { PersonaDraft } from "../../db/repositories/personasRepo";

export function PersonasScreen() {
  const { t } = useTranslation(["personas", "common"]);
  const { personas, loaded, load, create, update, setAvatar, setDefault, remove } = usePersonasStore();
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const handleImportJson = async () => {
    try {
      const draft = await pickAndImportPersona();
      if (!draft) return;
      await create(draft);
      setEditingId(null);
    } catch (e: unknown) {
      setImportError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleImportPng = async () => {
    try {
      const draft = await pickAndImportPersonaFromPng();
      if (!draft) return;
      await create(draft);
      setEditingId(null);
    } catch (e: unknown) {
      setImportError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleExportPersona = async (personaId: string) => {
    const p = personas.find((x) => x.id === personaId);
    if (!p) return;
    await pickAndExportPersona(p);
  };

  const handleExportPng = async (personaId: string) => {
    const p = personas.find((x) => x.id === personaId);
    if (!p) return;
    await pickAndExportPersonaAsPng(p);
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-8">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-[var(--font-display)] text-2xl">{t("title")}</h1>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void handleImportJson()} className="rounded-[var(--radius-sm)] px-2 py-1.5 text-xs" style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text-muted)" }}>
            {t("importButton")}
          </button>
          <button type="button" onClick={() => void handleImportPng()} className="rounded-[var(--radius-sm)] px-2 py-1.5 text-xs" style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text-muted)" }}>
            {t("importPngButton")}
          </button>
          <button
            type="button"
            onClick={() => setEditingId("new")}
            className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium"
            style={{ backgroundColor: "var(--color-accent)", color: "var(--color-accent-contrast)" }}
          >
            {t("newButton")}
          </button>
        </div>
      </div>

      <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
        {t("subtitle")}
      </p>

      {importError && (
        <div className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border px-3 py-2 text-sm" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}>
          <span>{importError}</span>
          <button type="button" onClick={() => setImportError(null)} className="shrink-0 opacity-80 hover:opacity-100">
            {t("actions.close", { ns: "common" })}
          </button>
        </div>
      )}

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
                onSave={async (patch) => {
                  await update(persona.id, patch as { name: string; gender: string; age: number | null; race: string; appearance: string; skills: typeof persona.skills; inventory: typeof persona.inventory });
                  setEditingId(null);
                }}
                onDelete={async () => {
                  await remove(persona.id);
                  setEditingId(null);
                }}
                onSetDefault={() => setDefault(persona.id)}
                onPickAvatar={(path) => setAvatar(persona.id, path)}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <div
                className="flex w-full flex-col gap-2 rounded-[var(--radius-md)] border px-4 py-3"
                style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-elevated)" }}
              >
                <div className="flex items-center gap-3">
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
                  <span className="flex-1 font-medium">{persona.name}</span>
                  {persona.isDefault && (
                    <span className="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium" style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-accent)" }}>
                      {t("defaultBadge")}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setEditingId(persona.id)}
                    className="rounded-[var(--radius-sm)] px-2 py-1 text-xs"
                    style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text-muted)" }}
                  >
                    ✎ {t("actions.edit", { ns: "common" })}
                  </button>
                </div>

                {/* Identity summary */}
                {(persona.gender || persona.age || persona.race) && (
                  <div className="flex flex-wrap gap-1 text-xs" style={{ color: "var(--color-text-muted)" }}>
                    {persona.gender && <span>{persona.gender}</span>}
                    {persona.age && <span>· {persona.age} let</span>}
                    {persona.race && <span>· {persona.race}</span>}
                  </div>
                )}

                {/* Appearance preview */}
                {persona.appearance && (
                  <p className="line-clamp-2 text-xs" style={{ color: "var(--color-text-faint)" }}>
                    {persona.appearance}
                  </p>
                )}

                {/* Skills summary */}
                {persona.skills.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {persona.skills.map((s, i) => (
                      <span key={i} className="rounded-full px-2 py-0.5 text-xs" style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text-muted)" }}>
                        {s.name} {s.level}
                      </span>
                    ))}
                  </div>
                )}

                {/* Export row */}
                <div className="flex items-center justify-end gap-2 border-t pt-2" style={{ borderColor: "var(--color-border)" }}>
                  <button type="button" onClick={() => void handleExportPersona(persona.id)} className="rounded-[var(--radius-sm)] px-2 py-1 text-xs" style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text-muted)" }}>
                    ↗ {t("exportJson")}
                  </button>
                  <button type="button" onClick={() => void handleExportPng(persona.id)} className="rounded-[var(--radius-sm)] px-2 py-1 text-xs" style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text-muted)" }}>
                    ↗ {t("exportPng")}
                  </button>
                </div>

              </div>
            )}
          </li>
        ))}
      </ul>

      {editingId === "new" && (
        <PersonaForm
          initial={null}
          onSave={async (draft) => {
            await create(draft as PersonaDraft);
            setEditingId(null);
          }}
          onCancel={() => setEditingId(null)}
        />
      )}
    </div>
  );
}
