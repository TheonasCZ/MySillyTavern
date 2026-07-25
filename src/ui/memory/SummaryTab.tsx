import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { listMessages } from "../../db/repositories/messagesRepo";
import { getSummary, upsertSummary, type Summary } from "../../db/repositories/summariesRepo";
import { inputStyle } from "./constants";

export function SummaryTab({ chatId }: { chatId: string }) {
  const { t } = useTranslation(["memory", "common"]);
  const [summary, setSummaryRow] = useState<Summary | null>(null);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    void (async () => {
      const row = await getSummary(chatId);
      setSummaryRow(row);
      setText(row?.text ?? "");
    })();
  }, [chatId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      let upToMessageId = summary?.upToMessageId ?? "";
      if (!upToMessageId) {
        const messages = await listMessages(chatId);
        upToMessageId = messages[messages.length - 1]?.id ?? "";
      }
      const updated = await upsertSummary(chatId, upToMessageId, text);
      setSummaryRow(updated);
      setSavedAt(Date.now());
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {summary && (
        <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>
          {t("summary.upToLabel")}: {summary.upToMessageId.slice(0, 8)}…
        </p>
      )}
      <textarea
        className="min-h-[16rem] rounded-[var(--radius-sm)] border px-3 py-2 text-sm"
        style={inputStyle}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t("summary.empty") ?? ""}
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="self-start rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          style={{ backgroundColor: "var(--color-accent)", color: "var(--color-accent-contrast)" }}
        >
          {t("summary.save")}
        </button>
        {savedAt && (
          <span className="text-xs" style={{ color: "var(--color-success)" }}>
            {t("facts.saved")}
          </span>
        )}
      </div>
    </div>
  );
}
