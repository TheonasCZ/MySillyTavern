import { useState } from "react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";

import type { Persona, PersonaDraft, PersonaUpdate } from "../../db/repositories/personasRepo";
import { avatarSrc } from "../characters/avatarSrc";
import { FieldHelp } from "../common/FieldHelp";

const inputStyle = {
  backgroundColor: "var(--color-surface-2)",
  borderColor: "var(--color-border-strong)",
  color: "var(--color-text)",
} as const;

interface Props {
  initial: Persona | null;
  onSave: (draft: PersonaDraft | PersonaUpdate) => Promise<void>;
  onDelete?: () => Promise<void>;
  onSetDefault?: () => Promise<void>;
  onPickAvatar?: (path: string) => Promise<void>;
  onCancel: () => void;
}

export function PersonaForm({ initial, onSave, onDelete, onSetDefault, onPickAvatar, onCancel }: Props) {
  const { t } = useTranslation(["personas", "common"]);
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      if (initial) {
        await onSave({ name, description });
      } else {
        await onSave({ name, description, avatarPath: null });
      }
    } finally {
      setSaving(false);
    }
  };

  const handlePickAvatar = async () => {
    if (!onPickAvatar) return;
    const path = await open({
      multiple: false,
      filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp"] }],
    });
    if (!path || Array.isArray(path)) return;
    await onPickAvatar(path);
  };

  return (
    <div
      className="flex flex-col gap-4 rounded-[var(--radius-md)] border p-4"
      style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-elevated)" }}
    >
      <div className="flex items-start gap-4">
        <div
          className="h-20 w-20 shrink-0 overflow-hidden rounded-[var(--radius-md)]"
          style={{ backgroundColor: "var(--color-surface-2)" }}
        >
          {initial && avatarSrc(initial.avatarPath) ? (
            <img src={avatarSrc(initial.avatarPath)} alt={name} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <span className="font-[var(--font-display)] text-2xl" style={{ color: "var(--color-text-faint)" }}>
                {name.slice(0, 1).toUpperCase() || "?"}
              </span>
            </div>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="flex items-center gap-1">
              {t("form.fields.name")}
              <FieldHelp text={t("form.help.name")} />
            </span>
            <input
              className="rounded-[var(--radius-sm)] border px-2 py-1.5"
              style={inputStyle}
              value={name}
              placeholder={t("form.fields.namePlaceholder") ?? ""}
              onChange={(e) => setName(e.target.value)}
            />
          </label>

          {initial && onPickAvatar && (
            <button
              type="button"
              onClick={() => void handlePickAvatar()}
              className="self-start rounded-[var(--radius-sm)] px-2 py-1 text-xs"
              style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text-muted)" }}
            >
              {t("form.pickAvatar")}
            </button>
          )}
        </div>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="flex items-center gap-1">
          {t("form.fields.description")}
          <FieldHelp text={t("form.help.description")} />
        </span>
        <textarea
          className="min-h-[6rem] rounded-[var(--radius-sm)] border px-2 py-1.5 text-sm"
          style={inputStyle}
          value={description}
          placeholder={t("form.fields.descriptionPlaceholder") ?? ""}
          onChange={(e) => setDescription(e.target.value)}
        />
        <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>
          {t("form.descriptionHint")}
        </span>
      </label>

      {initial?.isDefault && (
        <span className="text-xs font-medium" style={{ color: "var(--color-accent)" }}>
          {t("form.isDefaultBadge")}
        </span>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t pt-3" style={{ borderColor: "var(--color-border)" }}>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || !name.trim()}
          className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          style={{ backgroundColor: "var(--color-accent)", color: "var(--color-accent-contrast)" }}
        >
          {t("actions.save", { ns: "common" })}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm"
          style={{ color: "var(--color-text-muted)" }}
        >
          {t("actions.cancel", { ns: "common" })}
        </button>
        {initial && onSetDefault && !initial.isDefault && (
          <button
            type="button"
            onClick={() => void onSetDefault()}
            className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm"
            style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text)" }}
          >
            {t("form.makeDefault")}
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            onClick={() => {
              if (confirm(t("form.deleteConfirm") ?? "")) void onDelete();
            }}
            className="ml-auto rounded-[var(--radius-sm)] px-3 py-1.5 text-sm"
            style={{ color: "var(--color-danger)" }}
          >
            {t("actions.delete", { ns: "common" })}
          </button>
        )}
      </div>
    </div>
  );
}
