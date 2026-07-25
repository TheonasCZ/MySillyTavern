import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { Persona } from "../../db/repositories/personasRepo";
import { avatarSrc } from "../characters/avatarSrc";

/** Persona avatar + switcher, rendered as the first item in ChatInput's
 * row so it's clear whose voice is being typed. Popover opens upward
 * (this trigger sits at the very bottom of the window). */
export function PersonaSwitcher({
  chatId,
  persona,
  personas,
  currentPersonaId,
  onSetPersona,
}: {
  chatId: string;
  persona: Persona | undefined;
  personas: Persona[];
  currentPersonaId: string | null | undefined;
  onSetPersona: (chatId: string, personaId: string | null) => Promise<void>;
}) {
  const { t } = useTranslation(["chat", "common", "memory"]);
  const [open, setOpen] = useState(false);

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={persona ? `${t("room.personaLabel")} ${persona.name}` : t("room.noPersona")}
        aria-pressed={open}
        className="flex"
      >
        {persona && avatarSrc(persona.avatarPath) ? (
          <img
            src={avatarSrc(persona.avatarPath) ?? undefined}
            alt={persona.name}
            className="h-10 w-10 rounded-full border object-cover object-top"
            style={{ borderColor: "var(--color-border-strong)" }}
          />
        ) : (
          <span
            className="flex h-10 w-10 items-center justify-center rounded-full border text-sm font-medium"
            style={{ borderColor: "var(--color-border-strong)", backgroundColor: "var(--color-surface-2)", color: "var(--color-text-muted)" }}
          >
            {(persona?.name ?? "?").trim().charAt(0).toUpperCase() || "?"}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute bottom-full left-0 z-50 mb-2 w-64 rounded-[var(--radius-md)] border p-1 shadow-lg"
            style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-surface)" }}
          >
            <button
              type="button"
              className="block w-full rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-sm transition-colors hover:opacity-90"
              style={{
                backgroundColor: !currentPersonaId ? "var(--color-surface-2)" : "transparent",
                color: "var(--color-text)",
              }}
              onClick={async () => {
                await onSetPersona(chatId, null);
                setOpen(false);
              }}
            >
              {t("room.noPersona")}
            </button>
            {personas.map((p) => (
              <button
                key={p.id}
                type="button"
                className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-sm transition-colors hover:opacity-90"
                style={{
                  backgroundColor: currentPersonaId === p.id ? "var(--color-surface-2)" : "transparent",
                  color: "var(--color-text)",
                }}
                onClick={async () => {
                  await onSetPersona(chatId, p.id);
                  setOpen(false);
                }}
              >
                {avatarSrc(p.avatarPath) ? (
                  <img src={avatarSrc(p.avatarPath) ?? undefined} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover object-top" />
                ) : (
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm"
                    style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text-muted)" }}
                  >
                    {p.name.trim().charAt(0).toUpperCase() || "?"}
                  </span>
                )}
                <span className="flex flex-col overflow-hidden">
                  <span className="truncate">{p.name}</span>
                  <span className="truncate text-xs" style={{ color: "var(--color-text-muted)" }}>
                    {[p.age ? t("room.ageYears", { age: p.age }) : null, p.race || null].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
