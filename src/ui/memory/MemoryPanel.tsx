import { showConfirm } from "../../platform";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { getChat, type Chat } from "../../db/repositories/chatsRepo";
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
import {
  listEmbeddings,
  type StoredEmbedding,
} from "../../db/repositories/embeddingsRepo";
import { listMessages } from "../../db/repositories/messagesRepo";
import { getSummary, upsertSummary, type Summary } from "../../db/repositories/summariesRepo";
import {
  backfillSceneEmbeddings,
  canEmbed,
  reindexChatEmbeddings,
  semanticSearch,
  type SearchResult,
} from "../../memory/embeddingsEngine";
import type { ConnectionConfig } from "../../providers/types";
import { useChatListStore } from "../../stores/chatListStore";
import { useChatStore } from "../../stores/chatStore";
import { useConnectionsStore } from "../../stores/connectionsStore";
import { PromptInspector } from "./PromptInspector";
import { useUndoToast } from "../useUndoToast";

const inputStyle = {
  backgroundColor: "var(--color-surface-2)",
  borderColor: "var(--color-border-strong)",
  color: "var(--color-text)",
} as const;

const CATEGORIES: LedgerCategory[] = ["world", "player", "npc", "quest", "event"];

type Tab = "facts" | "summary" | "search" | "prompt" | "chronicle";

function FactRow({
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

function FactsTab({ chatId }: { chatId: string }) {
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

function SummaryTab({ chatId }: { chatId: string }) {
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

function SearchTab({ chatId }: { chatId: string }) {
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

type ChronicleEntry =
  | { kind: "message"; id: string; timestamp: string; text: string; messageId: string }
  | { kind: "fact"; id: string; timestamp: string; text: string; category: LedgerCategory; subject: string };

function ChronicleTab({
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

function PromptTab() {
  const { t } = useTranslation("memory");
  const report = useChatStore((s) => s.lastPromptReport);

  if (!report) {
    return (
      <p className="text-sm" style={{ color: "var(--color-text-faint)" }}>
        {t("prompt.empty")}
      </p>
    );
  }

  return <PromptInspector report={report} />;
}

function ExtractionConnectionPicker({ chatId }: { chatId: string }) {
  const { t } = useTranslation("memory");
  const { connections } = useConnectionsStore();
  const { setExtractionConnection } = useChatListStore();
  const [chat, setChat] = useState<Chat | null>(null);

  useEffect(() => {
    void getChat(chatId).then(setChat);
  }, [chatId]);

  if (!chat) return null;

  return (
    <label className="flex flex-col gap-1 text-xs">
      {t("extractionConnection.label")}
      <select
        className="rounded-[var(--radius-sm)] border px-2 py-1"
        style={inputStyle}
        value={chat.extractionConnectionId ?? ""}
        onChange={async (e) => {
          const value = e.target.value || null;
          await setExtractionConnection(chatId, value);
          setChat((c) => (c ? { ...c, extractionConnectionId: value } : c));
        }}
      >
        <option value="">{t("extractionConnection.useDefault")}</option>
        {connections.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function MemoryPanel({
  chatId,
  onClose,
  onJumpToMessage,
}: {
  chatId: string;
  onClose: () => void;
  /** Chronicle tab: navigate the chat to this message (closes the panel). */
  onJumpToMessage?: (messageId: string) => void;
}) {
  const { t } = useTranslation("memory");
  const [tab, setTab] = useState<Tab>("facts");

  const tabs: { key: Tab; label: string }[] = [
    { key: "facts", label: t("tabs.facts") },
    { key: "summary", label: t("tabs.summary") },
    { key: "chronicle", label: t("tabs.chronicle") },
    { key: "search", label: t("tabs.search") },
    { key: "prompt", label: t("tabs.prompt") },
  ];

  return (
    <div
      className="flex h-full flex-col"
      style={{ backgroundColor: "var(--color-bg-elevated)", boxShadow: "var(--shadow-panel)" }}
    >
      <div
        className="flex items-center justify-between gap-2 border-b px-4 py-3"
        style={{ borderColor: "var(--color-border)" }}
      >
        <h2 className="font-[var(--font-display)] text-base">{t("title")}</h2>
        <button
          type="button"
          onClick={onClose}
          className="text-sm"
          style={{ color: "var(--color-text-muted)" }}
        >
          {t("close")}
        </button>
      </div>

      <div className="border-b px-4 py-2" style={{ borderColor: "var(--color-border)" }}>
        <ExtractionConnectionPicker chatId={chatId} />
      </div>

      <div
        className="flex gap-1 border-b px-4 py-2"
        style={{ borderColor: "var(--color-border)" }}
      >
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            aria-pressed={tab === key}
            className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm transition-colors"
            style={{
              backgroundColor: tab === key ? "var(--color-accent)" : "transparent",
              color: tab === key ? "var(--color-accent-contrast)" : "var(--color-text-muted)",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {tab === "facts" && <FactsTab chatId={chatId} />}
        {tab === "summary" && <SummaryTab chatId={chatId} />}
        {tab === "chronicle" && <ChronicleTab chatId={chatId} onJumpToMessage={onJumpToMessage} />}
        {tab === "search" && <SearchTab chatId={chatId} />}
        {tab === "prompt" && <PromptTab />}
      </div>
    </div>
  );
}
