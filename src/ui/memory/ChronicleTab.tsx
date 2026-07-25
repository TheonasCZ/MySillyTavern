import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { listAllFacts, type LedgerCategory, type LedgerFact } from "../../db/repositories/ledgerRepo";
import {
  listEmbeddings,
  type StoredEmbedding,
} from "../../db/repositories/embeddingsRepo";

type ChronicleEntry =
  | { kind: "message"; id: string; timestamp: string; text: string; messageId: string }
  | { kind: "fact"; id: string; timestamp: string; text: string; category: LedgerCategory; subject: string };

export function ChronicleTab({
  chatId,
  onJumpToMessage,
}: {
  chatId: string;
  onJumpToMessage?: (messageId: string) => void;
}) {
  const { t } = useTranslation("memory");
  const [entries, setEntries] = useState<ChronicleEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const [embeddings, facts] = await Promise.all([
          listEmbeddings(chatId, "message"),
          listAllFacts(chatId),
        ]);

        const msgEntries: ChronicleEntry[] = embeddings.map((e: StoredEmbedding) => ({
          kind: "message",
          id: e.id,
          timestamp: e.createdAt,
          text: e.text.length > 120 ? `${e.text.slice(0, 120)}…` : e.text,
          messageId: e.refId,
        }));

        const factEntries: ChronicleEntry[] = facts.map((f: LedgerFact) => ({
          kind: "fact",
          id: f.id,
          timestamp: f.createdAt,
          text: `(${f.category}) ${f.subject}: ${f.fact}`,
          category: f.category,
          subject: f.subject,
        }));

        const merged = [...msgEntries, ...factEntries].sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
        );
        setEntries(merged);
      } catch {
        // silently fail
      } finally {
        setLoading(false);
      }
    })();
  }, [chatId]);

  if (loading) {
    return (
      <p className="text-sm" style={{ color: "var(--color-text-faint)" }}>
        {t("state.loading", { ns: "common" })}
      </p>
    );
  }

  if (entries.length === 0) {
    return (
      <p className="text-sm" style={{ color: "var(--color-text-faint)" }}>
        {t("chronicle.empty")}
      </p>
    );
  }

  const formatTimestamp = (iso: string): string => {
    try {
      const d = new Date(iso);
      return d.toLocaleString();
    } catch {
      return iso;
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {entries.map((entry) => (
        <div
          key={`${entry.kind}-${entry.id}`}
          className="rounded-[var(--radius-sm)] border p-3 text-xs"
          style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-elevated)" }}
        >
          <div className="mb-1 flex items-center justify-between gap-2">
            <span
              className="rounded-full px-2 py-0.5 text-[0.65rem] font-medium uppercase tracking-wide"
              style={{
                backgroundColor: entry.kind === "fact" ? "var(--color-surface-2)" : "var(--color-accent)",
                color: entry.kind === "fact" ? "var(--color-text-muted)" : "var(--color-accent-contrast)",
              }}
            >
              {entry.kind === "message"
                ? t("chronicle.messagePrefix")
                : t("chronicle.factPrefix")}
            </span>
            <span style={{ color: "var(--color-text-faint)" }}>
              {formatTimestamp(entry.timestamp)}
            </span>
          </div>
          <p className="whitespace-pre-wrap" style={{ color: "var(--color-text)" }}>
            {entry.text}
          </p>
          {entry.kind === "message" && onJumpToMessage && (
            <button
              type="button"
              className="mt-1 text-xs underline"
              style={{ color: "var(--color-accent)" }}
              onClick={() => onJumpToMessage(entry.messageId)}
            >
              {t("chronicle.jumpToMessage")}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
