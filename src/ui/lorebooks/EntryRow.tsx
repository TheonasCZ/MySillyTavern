import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { LoreEntry } from "../../db/repositories/lorebooksRepo";
import type { LoreEntryFields } from "../../lorebooks/worldInfoImport";
import { FieldHelp } from "../common/FieldHelp";
import { csvToKeys, inputStyle } from "./constants";

export function EntryRow({
  entry,
  onSave,
  onDelete,
}: {
  entry: LoreEntry;
  onSave: (fields: LoreEntryFields) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const { t } = useTranslation(["lorebooks", "common"]);
  const [fields, setFields] = useState<LoreEntryFields>(entry);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const patch = (partial: Partial<LoreEntryFields>) => setFields({ ...fields, ...partial });

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(fields);
      setSavedAt(Date.now());
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="flex flex-col gap-3 rounded-[var(--radius-md)] border p-4"
      style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-elevated)" }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="flex items-center gap-1">
            {t("editor.entryFields.keys")}
            <FieldHelp text={t("editor.help.entryKeys")} />
          </span>
          <input
            className="rounded-[var(--radius-sm)] border px-2 py-1.5"
            style={inputStyle}
            value={fields.keys.join(", ")}
            placeholder={t("editor.entryFields.keysPlaceholder") ?? ""}
            onChange={(e) => patch({ keys: csvToKeys(e.target.value) })}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="flex items-center gap-1">
            {t("editor.entryFields.secondaryKeys")}
            <FieldHelp text={t("editor.help.entrySecondaryKeys")} />
          </span>
          <input
            className="rounded-[var(--radius-sm)] border px-2 py-1.5"
            style={inputStyle}
            value={fields.secondaryKeys.join(", ")}
            placeholder={t("editor.entryFields.keysPlaceholder") ?? ""}
            onChange={(e) => patch({ secondaryKeys: csvToKeys(e.target.value) })}
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="flex items-center gap-1">
          {t("editor.entryFields.content")}
          <FieldHelp text={t("editor.help.entryContent")} />
        </span>
        <textarea
          className="min-h-[5rem] rounded-[var(--radius-sm)] border px-2 py-1.5 text-sm"
          style={inputStyle}
          value={fields.content}
          onChange={(e) => patch({ content: e.target.value })}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="flex items-center gap-1">
          {t("editor.entryFields.comment")}
          <FieldHelp text={t("editor.help.entryComment")} />
        </span>
        <input
          className="rounded-[var(--radius-sm)] border px-2 py-1.5"
          style={inputStyle}
          value={fields.comment}
          onChange={(e) => patch({ comment: e.target.value })}
        />
      </label>

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <span className="flex items-center gap-1">
            {t("editor.entryFields.priority")}
            <FieldHelp text={t("editor.help.entryPriority")} />
          </span>
          <input
            type="number"
            className="w-20 rounded-[var(--radius-sm)] border px-2 py-1"
            style={inputStyle}
            value={fields.priority}
            onChange={(e) => patch({ priority: Number(e.target.value) })}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={fields.alwaysOn}
            onChange={(e) => patch({ alwaysOn: e.target.checked })}
          />
          <span className="flex items-center gap-1">
            {t("editor.entryFields.alwaysOn")}
            <FieldHelp text={t("editor.help.entryAlwaysOn")} />
          </span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={fields.caseSensitive}
            onChange={(e) => patch({ caseSensitive: e.target.checked })}
          />
          <span className="flex items-center gap-1">
            {t("editor.entryFields.caseSensitive")}
            <FieldHelp text={t("editor.help.entryCaseSensitive")} />
          </span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={fields.enabled}
            onChange={(e) => patch({ enabled: e.target.checked })}
          />
          <span className="flex items-center gap-1">
            {t("editor.entryFields.enabled")}
            <FieldHelp text={t("editor.help.entryEnabled")} />
          </span>
        </label>
      </div>

      {/* ---- M27: Recursive activation ---- */}
      <div className="flex flex-wrap items-center gap-4 border-t pt-3" style={{ borderColor: "var(--color-border)" }}>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={fields.recursiveActivation}
            onChange={(e) => patch({ recursiveActivation: e.target.checked })}
          />
          <span className="flex items-center gap-1">
            {t("editor.entryFields.recursiveActivation", "Rekurzivní aktivace")}
            <FieldHelp text={t("editor.help.recursiveActivation", "Když je zapnuto, klíče této položky mohou aktivovat další položky.")} />
          </span>
        </label>
        {fields.recursiveActivation && (
          <label className="flex items-center gap-2 text-sm">
            <span>{t("editor.entryFields.activationDepth", "Hloubka")}</span>
            <input
              type="number"
              className="w-16 rounded-[var(--radius-sm)] border px-2 py-1"
              style={inputStyle}
              min={1}
              max={10}
              value={fields.activationDepth}
              onChange={(e) => patch({ activationDepth: Math.max(1, Number(e.target.value) || 1) })}
            />
          </label>
        )}
      </div>

      {/* ---- M27: Selective AND/NOT keys ---- */}
      <div className="flex flex-col gap-2 border-t pt-3" style={{ borderColor: "var(--color-border)" }}>
        <span className="text-sm font-medium">
          {t("editor.entryFields.selectiveKeys", "Selektivní klíče (AND/NOT)")}
          <FieldHelp text={t("editor.help.selectiveKeys", "AND: všechny musí být v textu. NOT: žádný nesmí být v textu.")} />
        </span>
        {fields.selectiveKeys.map((sk, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              className="flex-1 rounded-[var(--radius-sm)] border px-2 py-1 text-sm"
              style={inputStyle}
              value={sk.key}
              placeholder="klíčové slovo"
              onChange={(e) => {
                const next = [...fields.selectiveKeys];
                next[i] = { ...next[i], key: e.target.value };
                patch({ selectiveKeys: next });
              }}
            />
            <select
              className="rounded-[var(--radius-sm)] border px-2 py-1 text-sm"
              style={inputStyle}
              value={sk.logic}
              onChange={(e) => {
                const next = [...fields.selectiveKeys];
                next[i] = { ...next[i], logic: e.target.value as "AND" | "NOT" };
                patch({ selectiveKeys: next });
              }}
            >
              <option value="AND">AND</option>
              <option value="NOT">NOT</option>
            </select>
            <button
              type="button"
              onClick={() => {
                const next = fields.selectiveKeys.filter((_, j) => j !== i);
                patch({ selectiveKeys: next });
              }}
              className="rounded-[var(--radius-sm)] px-1.5 py-0.5 text-xs transition-colors"
              style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-danger)" }}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => patch({ selectiveKeys: [...fields.selectiveKeys, { key: "", logic: "AND" }] })}
          className="self-start rounded-[var(--radius-sm)] px-2 py-1 text-xs"
          style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text)" }}
        >
          + {t("editor.addSelectiveKey", "Přidat klíč")}
        </button>
      </div>

      {/* ---- M27: Timed effects ---- */}
      <div className="flex flex-col gap-2 border-t pt-3" style={{ borderColor: "var(--color-border)" }}>
        <span className="text-sm font-medium">
          {t("editor.entryFields.timedEffects", "Časové efekty")}
          <FieldHelp text={t("editor.help.timedEffects", "Sticky: zůstane aktivní N zpráv. Cooldown: nelze aktivovat N zpráv. Delay: aktivace se zpozdí o N zpráv.")} />
        </span>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <span>{t("editor.entryFields.sticky", "Sticky")}</span>
            <input
              type="number"
              className="w-16 rounded-[var(--radius-sm)] border px-2 py-1"
              style={inputStyle}
              min={0}
              value={fields.timed?.sticky ?? 0}
              placeholder="0"
              onChange={(e) => {
                const v = Math.max(0, Number(e.target.value) || 0);
                const t = { ...(fields.timed ?? {}) };
                if (v > 0) t.sticky = v; else delete t.sticky;
                patch({ timed: Object.keys(t).length > 0 ? t : null });
              }}
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span>{t("editor.entryFields.cooldown", "Cooldown")}</span>
            <input
              type="number"
              className="w-16 rounded-[var(--radius-sm)] border px-2 py-1"
              style={inputStyle}
              min={0}
              value={fields.timed?.cooldown ?? 0}
              placeholder="0"
              onChange={(e) => {
                const v = Math.max(0, Number(e.target.value) || 0);
                const t = { ...(fields.timed ?? {}) };
                if (v > 0) t.cooldown = v; else delete t.cooldown;
                patch({ timed: Object.keys(t).length > 0 ? t : null });
              }}
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span>{t("editor.entryFields.delay", "Delay")}</span>
            <input
              type="number"
              className="w-16 rounded-[var(--radius-sm)] border px-2 py-1"
              style={inputStyle}
              min={0}
              value={fields.timed?.delay ?? 0}
              placeholder="0"
              onChange={(e) => {
                const v = Math.max(0, Number(e.target.value) || 0);
                const t = { ...(fields.timed ?? {}) };
                if (v > 0) t.delay = v; else delete t.delay;
                patch({ timed: Object.keys(t).length > 0 ? t : null });
              }}
            />
          </label>
        </div>
      </div>

      {/* ---- M27: Vector activation ---- */}
      <div className="flex flex-wrap items-center gap-4 border-t pt-3" style={{ borderColor: "var(--color-border)" }}>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={fields.vectorThreshold !== null}
            onChange={(e) => patch({ vectorThreshold: e.target.checked ? 0.6 : null })}
          />
          <span className="flex items-center gap-1">
            {t("editor.entryFields.vectorActivation", "Vektorová aktivace")}
            <FieldHelp text={t("editor.help.vectorActivation", "Aktivuje položku podle podobnosti embeddingu, bez potřeby klíčových slov.")} />
          </span>
        </label>
        {fields.vectorThreshold !== null && (
          <>
            <label className="flex items-center gap-2 text-sm">
              <span>{t("editor.entryFields.vectorThreshold", "Práh")}</span>
              <input
                type="range"
                className="w-20"
                min={0.3}
                max={0.95}
                step={0.05}
                value={fields.vectorThreshold}
                onChange={(e) => patch({ vectorThreshold: Number(e.target.value) })}
              />
              <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                {fields.vectorThreshold.toFixed(2)}
              </span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <span>{t("editor.entryFields.vectorBudget", "Budget")}</span>
              <input
                type="number"
                className="w-16 rounded-[var(--radius-sm)] border px-2 py-1"
                style={inputStyle}
                min={1}
                max={20}
                value={fields.vectorBudget}
                onChange={(e) => patch({ vectorBudget: Math.max(1, Number(e.target.value) || 2) })}
              />
            </label>
          </>
        )}
      </div>

      <div className="flex items-center gap-2 border-t pt-3" style={{ borderColor: "var(--color-border)" }}>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          style={{ backgroundColor: "var(--color-accent)", color: "var(--color-accent-contrast)" }}
        >
          {t("actions.save", { ns: "common" })}
        </button>
        <button
          type="button"
          onClick={() => void onDelete()}
          className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm transition-colors"
          style={{
            backgroundColor: "var(--color-surface-2)",
            color: "var(--color-danger)",
          }}
        >
          {t("actions.delete", { ns: "common" })}
        </button>
        {savedAt && (
          <span className="text-xs" style={{ color: "var(--color-success)" }}>
            {t("editor.saved")}
          </span>
        )}
      </div>
    </div>
  );
}
