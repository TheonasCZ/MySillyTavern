import { useTranslation } from "react-i18next";

import { FieldHelp } from "../common/FieldHelp";
import { inputStyle } from "./constants";

export function LorebookMetaForm({
  name,
  description,
  onNameChange,
  onDescriptionChange,
  onSave,
}: {
  name: string;
  description: string;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onSave: () => void;
}) {
  const { t } = useTranslation(["lorebooks", "common"]);

  return (
    <div
      className="flex flex-col gap-3 rounded-[var(--radius-md)] border p-4"
      style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-elevated)" }}
    >
      <label className="flex flex-col gap-1 text-sm">
        <span className="flex items-center gap-1">
          {t("editor.fields.name")}
          <FieldHelp text={t("editor.help.name")} />
        </span>
        <input
          className="rounded-[var(--radius-sm)] border px-2 py-1.5"
          style={inputStyle}
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="flex items-center gap-1">
          {t("editor.fields.description")}
          <FieldHelp text={t("editor.help.description")} />
        </span>
        <textarea
          className="min-h-[3rem] rounded-[var(--radius-sm)] border px-2 py-1.5 text-sm"
          style={inputStyle}
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
        />
      </label>
      <button
        type="button"
        onClick={onSave}
        className="self-start rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium"
        style={{ backgroundColor: "var(--color-accent)", color: "var(--color-accent-contrast)" }}
      >
        {t("actions.save", { ns: "common" })}
      </button>
    </div>
  );
}
