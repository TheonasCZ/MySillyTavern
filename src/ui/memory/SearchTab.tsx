import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { getChat, type Chat } from "../../db/repositories/chatsRepo";
import {
  backfillSceneEmbeddings,
  canEmbed,
  reindexChatEmbeddings,
  semanticSearch,
  type SearchResult,
} from "../../memory/embeddingsEngine";
import type { ConnectionConfig } from "../../providers/types";
import { useConnectionsStore } from "../../stores/connectionsStore";
import { inputStyle } from "./constants";

export function SearchTab({ chatId }: { chatId: string }) {
  const { t } = useTranslation("memory");
  const { connections } = useConnectionsStore();
  const [chat, setChat] = useState<Chat | null>(null);
  const [queryText, setQueryText] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [busy, setBusy] = useState<"search" | "reindex" | "backfill" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reindexed, setReindexed] = useState<number | null>(null);
  const [backfilled, setBackfilled] = useState<number | null>(null);

  useEffect(() => {
    void getChat(chatId).then(setChat);
  }, [chatId]);

  const resolve = (id: string | null): ConnectionConfig | null =>
    (id && connections.find((c) => c.id === id)) || null;
  const connection = chat
    ? (resolve(chat.extractionConnectionId) ?? resolve(chat.connectionId))
    : null;

  if (!canEmbed(connection)) {
    return (
      <p className="text-sm" style={{ color: "var(--color-text-faint)" }}>
        {t("search.unavailable")}
      </p>
    );
  }

  const handleSearch = async () => {
    if (!queryText.trim()) return;
    setBusy("search");
    setError(null);
    try {
      setResults(await semanticSearch(chatId, connection, queryText.trim()));
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
  };

  const handleReindex = async () => {
    setBusy("reindex");
    setError(null);
    setReindexed(null);
    try {
      setReindexed(await reindexChatEmbeddings(chatId, connection));
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
  };

  const handleBackfill = async () => {
    setBusy("backfill");
    setError(null);
    setBackfilled(null);
    try {
      setBackfilled(await backfillSceneEmbeddings(chatId, connection));
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <input
          className="min-w-0 flex-1 rounded-[var(--radius-sm)] border px-2 py-1.5 text-sm"
          style={inputStyle}
          value={queryText}
          placeholder={t("search.placeholder") ?? ""}
          onChange={(e) => setQueryText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleSearch();
          }}
        />
        <button
          type="button"
          onClick={() => void handleSearch()}
          disabled={busy !== null || !queryText.trim()}
          className="shrink-0 rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          style={{ backgroundColor: "var(--color-accent)", color: "var(--color-accent-contrast)" }}
        >
          {busy === "search" ? t("search.searching") : t("search.button")}
        </button>
      </div>

      {error && (
        <p className="text-xs" style={{ color: "var(--color-danger)" }}>
          {error}
        </p>
      )}

      {results !== null && results.length === 0 && (
        <p className="text-sm" style={{ color: "var(--color-text-faint)" }}>
          {t("search.noResults")}
        </p>
      )}

      <div className="flex flex-col gap-2">
        {results?.map((r) => (
          <div
            key={`${r.kind}-${r.refId}`}
            className="rounded-[var(--radius-sm)] border p-3 text-xs"
            style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-elevated)" }}
          >
            <div className="mb-1 flex items-center justify-between gap-2">
              <span
                className="rounded-full px-2 py-0.5 text-[0.65rem] font-medium uppercase tracking-wide"
                style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text-muted)" }}
              >
                {t(`search.kinds.${r.kind}`)}
              </span>
              <span style={{ color: "var(--color-brass)" }}>{Math.round(r.score * 100)} %</span>
            </div>
            <p className="whitespace-pre-wrap" style={{ color: "var(--color-text)" }}>
              {r.text}
            </p>
          </div>
        ))}
      </div>

      <div
        className="mt-2 flex flex-col gap-2 border-t pt-3"
        style={{ borderColor: "var(--color-border)" }}
      >
        <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>
          {t("search.reindexHint")}
        </span>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void handleReindex()}
            disabled={busy !== null}
            className="self-start rounded-[var(--radius-sm)] px-3 py-1.5 text-xs disabled:opacity-50"
            style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text)" }}
          >
            {busy === "reindex" ? t("search.reindexing") : t("search.reindex")}
          </button>
          {reindexed !== null && (
            <span className="text-xs" style={{ color: "var(--color-success)" }}>
              {t("search.reindexed", { count: reindexed })}
            </span>
          )}
        </div>
        <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>
          {t("search.backfillHint")}
        </span>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void handleBackfill()}
            disabled={busy !== null}
            className="self-start rounded-[var(--radius-sm)] px-3 py-1.5 text-xs disabled:opacity-50"
            style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text)" }}
          >
            {busy === "backfill" ? t("search.backfilling") : t("search.backfill")}
          </button>
          {backfilled !== null && (
            <span className="text-xs" style={{ color: "var(--color-success)" }}>
              {t("search.backfilled", { count: backfilled })}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
