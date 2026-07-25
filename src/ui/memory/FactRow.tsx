import { showConfirm } from "../../platform";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { LedgerCategory, LedgerFact } from "../../db/repositories/ledgerRepo";
import { CATEGORIES, inputStyle } from "./constants";

export function FactRow({
  fact,
  onSave,
  onToggleLock,
  onToggleCanon,
  onToggleStatus,
  onDelete,
}: {
  fact: LedgerFact;
  onSave: (patch: { category: LedgerCategory; subject: string; fact: string }) => Promise<void>;
  onToggleLock: () => Promise<void>;
  /** Demotes/promotes the soft-canon flag (M25.5). */
  onToggleCanon: () => Promise<void>;
  onToggleStatus: () => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const { t } = useTranslation(["memory", "common"]);
  const [category, setCategory] = useState(fact.category);
  const [subject, setSubject] = useState(fact.subject);
  const [factText, setFactText] = useState(fact.fact);
  const [saving, setSaving] = useState(false);

  const dirty = category !== fact.category || subject !== fact.subject || factText !== fact.fact;
  const isCanon = fact.locked || fact.canon;

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({ category, subject, fact: factText });
    } finally {
      setSaving(false);
    }
  };

  // The user is the admin (M25.5): everything stays possible, but touching
  // canon gets a gentle "are you sure" nudge first.
  const handleToggleLock = async () => {
    if (fact.locked && !await showConfirm(t("facts.canonUnlockWarn") ?? "")) return;
    void onToggleLock();
  };
  const handleToggleCanon = async () => {
    if (fact.canon && !await showConfirm(t("facts.canonDemoteWarn") ?? "")) return;
    void onToggleCanon();
  };
  const handleDelete = async () => {
    const msg = isCanon ? t("facts.canonDeleteWarn") : t("facts.deleteConfirm");
    if (await showConfirm(msg ?? "")) void onDelete();
  };

  return (
    <div
      className="flex flex-col gap-2 rounded-[var(--radius-sm)] border p-3 text-sm"
      style={{
        borderColor: isCanon ? "var(--color-brass)" : "var(--color-border)",
        backgroundColor: "var(--color-bg-elevated)",
        opacity: fact.status === "archived" ? 0.6 : 1,
      }}
    >
      {isCanon && (
        <span className="text-[0.65rem] font-medium uppercase tracking-wide" style={{ color: "var(--color-brass)" }}>
          {fact.locked ? `🔒 ${t("facts.canonHardBadge")}` : `✨ ${t("facts.canonAutoBadge")}`}
        </span>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="rounded-[var(--radius-sm)] border px-2 py-1 text-xs"
          style={inputStyle}
          value={category}
          onChange={(e) => setCategory(e.target.value as LedgerCategory)}
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
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder={t("facts.fields.subject") ?? ""}
        />
      </div>
      <textarea
        className="min-h-[3rem] rounded-[var(--radius-sm)] border px-2 py-1.5 text-xs"
        style={inputStyle}
        value={factText}
        onChange={(e) => setFactText(e.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={!dirty || saving}
          className="rounded-[var(--radius-sm)] px-2 py-1 text-xs font-medium disabled:opacity-40"
          style={{ backgroundColor: "var(--color-accent)", color: "var(--color-accent-contrast)" }}
        >
          {t("actions.save", { ns: "common" })}
        </button>
        <button
          type="button"
          onClick={handleToggleLock}
          className="rounded-[var(--radius-sm)] px-2 py-1 text-xs"
          style={{
            backgroundColor: fact.locked ? "var(--color-brass)" : "var(--color-surface-2)",
            color: fact.locked ? "var(--color-accent-contrast)" : "var(--color-text)",
          }}
        >
          {fact.locked ? t("facts.unlock") : t("facts.lock")}
        </button>
        {fact.canon && !fact.locked && (
          <button
            type="button"
            onClick={handleToggleCanon}
            className="rounded-[var(--radius-sm)] px-2 py-1 text-xs"
            style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text)" }}
          >
            {t("facts.canonDemote")}
          </button>
        )}
        <button
          type="button"
          onClick={() => void onToggleStatus()}
          className="rounded-[var(--radius-sm)] px-2 py-1 text-xs"
          style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text)" }}
        >
          {fact.status === "active" ? t("facts.archive") : t("facts.restore")}
        </button>
        <button
          type="button"
          onClick={handleDelete}
          className="ml-auto text-xs"
          style={{ color: "var(--color-danger)" }}
        >
          {t("actions.delete", { ns: "common" })}
        </button>
      </div>
    </div>
  );
}
