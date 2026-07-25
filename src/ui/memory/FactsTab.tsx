import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  createFact,
  deleteFact,
  listAllFacts,
  setFactCanon,
  setFactLocked,
  setFactStatus,
  updateFact,
  type LedgerCategory,
  type LedgerFact,
} from "../../db/repositories/ledgerRepo";
import { useUndoToast } from "../useUndoToast";
import { FactRow } from "./FactRow";
import { CATEGORIES, inputStyle } from "./constants";

export function FactsTab({ chatId }: { chatId: string }) {
  const { t } = useTranslation(["memory", "common"]);
  const { toastUndo } = useUndoToast();
  const [facts, setFacts] = useState<LedgerFact[]>([]);
  const [filter, setFilter] = useState<LedgerCategory | "all">("all");
  const [newSubject, setNewSubject] = useState("");
  const [newFact, setNewFact] = useState("");
  const [newCategory, setNewCategory] = useState<LedgerCategory>("world");

  const reload = async () => setFacts(await listAllFacts(chatId));

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  const visible = filter === "all" ? facts : facts.filter((f) => f.category === filter);

  const handleAdd = async () => {
    if (!newSubject.trim() || !newFact.trim()) return;
    await createFact(chatId, { category: newCategory, subject: newSubject.trim(), fact: newFact.trim() });
    setNewSubject("");
    setNewFact("");
    await reload();
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>
          {t("facts.filterLabel")}
        </span>
        <select
          className="rounded-[var(--radius-sm)] border px-2 py-1 text-xs"
          style={inputStyle}
          value={filter}
          onChange={(e) => setFilter(e.target.value as LedgerCategory | "all")}
        >
          <option value="all">{t("facts.filterAll")}</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(`facts.categories.${c}`)}
            </option>
          ))}
        </select>
      </div>

      {visible.length === 0 && (
        <p className="text-sm" style={{ color: "var(--color-text-faint)" }}>
          {t("facts.empty")}
        </p>
      )}

      {/* Canon facts first (M25.1/M25.5): hard-locked and auto-promoted,
          visually separated. The user stays the admin — everything can be
          unlocked/demoted/deleted, just with a warning. */}
      {visible.some((f) => f.locked || f.canon) && (
        <div
          className="flex flex-col gap-2 rounded-[var(--radius-sm)] border p-2"
          style={{ borderColor: "var(--color-accent)" }}
        >
          <span className="text-xs font-medium" style={{ color: "var(--color-accent)" }}>
            🔒 {t("facts.canonHeader")} ({visible.filter((f) => f.locked || f.canon).length})
          </span>
          {visible.filter((f) => f.locked || f.canon).map((f) => (
            <FactRow
              key={f.id}
              fact={f}
              onSave={async (patch) => {
                await updateFact(f.id, patch);
                await reload();
              }}
              onToggleLock={async () => {
                await setFactLocked(f.id, !f.locked);
                await reload();
              }}
              onToggleCanon={async () => {
                await setFactCanon(f.id, !f.canon);
                await reload();
              }}
              onToggleStatus={async () => {
                await setFactStatus(f.id, f.status === "active" ? "archived" : "active");
                await reload();
              }}
              onDelete={async () => {
                const deleted = f;
                await deleteFact(f.id);
                await reload();
                toastUndo(
                  `${t("deleted", { ns: "common" })}: ${deleted.subject}`,
                  async () => {
                    await createFact(chatId, { category: deleted.category, subject: deleted.subject, fact: deleted.fact });
                    await reload();
                  },
                );
              }}
            />
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2">
        {visible.filter((f) => !f.locked && !f.canon).map((f) => (
          <FactRow
            key={f.id}
            fact={f}
            onSave={async (patch) => {
              await updateFact(f.id, patch);
              await reload();
            }}
            onToggleLock={async () => {
              await setFactLocked(f.id, !f.locked);
              await reload();
            }}
            onToggleCanon={async () => {
              await setFactCanon(f.id, !f.canon);
              await reload();
            }}
            onToggleStatus={async () => {
              await setFactStatus(f.id, f.status === "active" ? "archived" : "active");
              await reload();
            }}
            onDelete={async () => {
              const deleted = f;
              await deleteFact(f.id);
              await reload();
              toastUndo(
                `${t("deleted", { ns: "common" })}: ${deleted.subject}`,
                async () => {
                  await createFact(chatId, { category: deleted.category, subject: deleted.subject, fact: deleted.fact });
                  await reload();
                },
              );
            }}
          />
        ))}
      </div>

      <div
        className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-dashed p-3"
        style={{ borderColor: "var(--color-border-strong)" }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="rounded-[var(--radius-sm)] border px-2 py-1 text-xs"
            style={inputStyle}
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value as LedgerCategory)}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`facts.categories.${c}`)}
              </option>
            ))}
          </select>
          <input
            className="min-w-0 flex-1 rounded-[var(--radius-sm)] border px-2 py-1 text-xs"
            style={inputStyle}
            value={newSubject}
            onChange={(e) => setNewSubject(e.target.value)}
            placeholder={t("facts.fields.subject") ?? ""}
          />
        </div>
        <textarea
          className="min-h-[2.5rem] rounded-[var(--radius-sm)] border px-2 py-1.5 text-xs"
          style={inputStyle}
          value={newFact}
          onChange={(e) => setNewFact(e.target.value)}
          placeholder={t("facts.fields.fact") ?? ""}
        />
        <button
          type="button"
          onClick={() => void handleAdd()}
          disabled={!newSubject.trim() || !newFact.trim()}
          className="self-start rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium disabled:opacity-40"
          style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text)" }}
        >
          {t("facts.addNew")}
        </button>
      </div>
    </div>
  );
}
