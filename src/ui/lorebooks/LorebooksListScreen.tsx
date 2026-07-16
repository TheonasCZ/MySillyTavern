import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { useLorebooksStore } from "../../stores/lorebooksStore";

const inputStyle = {
  backgroundColor: "var(--color-surface-2)",
  borderColor: "var(--color-border-strong)",
  color: "var(--color-text)",
} as const;

export function LorebooksListScreen() {
  const { t } = useTranslation(["lorebooks", "common"]);
  const navigate = useNavigate();
  const { lorebooks, loaded, load, create } = useLorebooksStore();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const handleCreate = async () => {
    const name = newName.trim() || t("list.defaultName");
    const lorebook = await create({ name, description: "" });
    setCreating(false);
    setNewName("");
    navigate(`/lorebooks/${lorebook.id}`);
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-8">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-[var(--font-display)] text-2xl">{t("title")}</h1>
        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium"
          style={{ backgroundColor: "var(--color-accent)", color: "var(--color-accent-contrast)" }}
        >
          {t("list.newButton")}
        </button>
      </div>

      {creating && (
        <div
          className="flex flex-col gap-3 rounded-[var(--radius-md)] border p-4"
          style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-elevated)" }}
        >
          <label className="flex flex-col gap-1 text-sm">
            {t("list.nameLabel")}
            <input
              autoFocus
              className="rounded-[var(--radius-sm)] border px-2 py-1.5"
              style={inputStyle}
              value={newName}
              placeholder={t("list.defaultName") ?? ""}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleCreate();
              }}
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void handleCreate()}
              className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium"
              style={{ backgroundColor: "var(--color-accent)", color: "var(--color-accent-contrast)" }}
            >
              {t("actions.add", { ns: "common" })}
            </button>
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm"
              style={{ color: "var(--color-text-muted)" }}
            >
              {t("actions.cancel", { ns: "common" })}
            </button>
          </div>
        </div>
      )}

      {lorebooks.length === 0 && !creating && (
        <p className="text-sm" style={{ color: "var(--color-text-faint)" }}>
          {t("empty")}
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {lorebooks.map((lorebook) => (
          <li key={lorebook.id}>
            <button
              type="button"
              onClick={() => navigate(`/lorebooks/${lorebook.id}`)}
              className="flex w-full flex-col gap-1 rounded-[var(--radius-md)] border px-4 py-3 text-left transition-colors hover:opacity-90"
              style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-elevated)" }}
            >
              <span className="font-medium">{lorebook.name}</span>
              {lorebook.description && (
                <span className="truncate text-xs" style={{ color: "var(--color-text-muted)" }}>
                  {lorebook.description}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
