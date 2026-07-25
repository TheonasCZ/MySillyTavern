import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { checkForUpdate, openPath, relaunchApp, revealItemInDir } from "../../platform";
import { getLogLevel, setLogLevel, refreshLogLevel } from "../../logging";
import type { LogLevel } from "../../db/repositories/settingsRepo";

const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

type UpdateCheckState =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "upToDate" }
  | { phase: "available"; version: string }
  | { phase: "downloading" }
  | { phase: "error" };

interface ChatLogEntry {
  chat_id: string;
  size_bytes: number;
}

const CHAT_LOG_DEFAULT_TAIL = 200_000; // read last ~200 KB by default

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

export function DiagnosticsPanel() {
  const { t } = useTranslation("settings");
  const [logPath, setLogPath] = useState<string | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updateCheck, setUpdateCheck] = useState<UpdateCheckState>({ phase: "idle" });
  const [logLevel, setLogLevelState] = useState<LogLevel>("info");

  // ── chat log viewer state ──
  const [chatLogs, setChatLogs] = useState<ChatLogEntry[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string>("");
  const [chatLogText, setChatLogText] = useState<string | null>(null); // null = not loaded yet
  const [chatLogLoading, setChatLogLoading] = useState(false);
  const [extractorLogText, setExtractorLogText] = useState<string | null>(null);

  const refreshChatLogList = useCallback(async () => {
    try {
      const logs: ChatLogEntry[] = await invoke("list_chat_logs");
      setChatLogs(logs);
      // If nothing is selected yet, pick the first one.
      if (!selectedChatId && logs.length > 0) {
        setSelectedChatId(logs[0].chat_id);
      }
    } catch {
      // list may fail if the logs dir is inaccessible — not critical
    }
  }, [selectedChatId]);

  useEffect(() => {
    void invoke<string>("get_log_path")
      .then(setLogPath)
      .catch((err) => setError(String(err)));
    void getVersion()
      .then(setVersion)
      .catch(() => {});
    void refreshLogLevel().then(() => setLogLevelState(getLogLevel()));
    void refreshChatLogList();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLogLevelChange = (level: LogLevel) => {
    setLogLevelState(level);
    void setLogLevel(level);
  };

  const handleOpenFolder = async () => {
    if (!logPath) return;
    try {
      await revealItemInDir(logPath);
    } catch (err) {
      setError(String(err));
    }
  };

  const handleOpenFile = async () => {
    if (!logPath) return;
    try {
      await openPath(logPath);
    } catch {
      try {
        await revealItemInDir(logPath);
      } catch (err) {
        setError(String(err));
      }
    }
  };

  const handleCheckUpdate = async () => {
    setUpdateCheck({ phase: "checking" });
    try {
      const update = await checkForUpdate();
      setUpdateCheck(update ? { phase: "available", version: update.version } : { phase: "upToDate" });
    } catch {
      setUpdateCheck({ phase: "error" });
    }
  };

  const handleInstallUpdate = async () => {
    setUpdateCheck({ phase: "downloading" });
    try {
      const update = await checkForUpdate();
      if (!update) {
        setUpdateCheck({ phase: "upToDate" });
        return;
      }
      await update.downloadAndInstall();
      await relaunchApp();
    } catch {
      setUpdateCheck({ phase: "error" });
    }
  };

  // ── chat log handlers ──
  const handleLoadChatLog = async () => {
    if (!selectedChatId) return;
    setChatLogLoading(true);
    try {
      const text = await invoke<string>("read_chat_log", {
        chatId: selectedChatId,
        maxBytes: CHAT_LOG_DEFAULT_TAIL,
      });
      setChatLogText(text || "");
    } catch (err) {
      setChatLogText(`Chyba: ${String(err)}`);
    } finally {
      setChatLogLoading(false);
    }
  };

  const handleClearChatLog = async () => {
    if (!selectedChatId) return;
    try {
      const path = await invoke<string>("get_chat_log_path", { chatId: selectedChatId });
      await invoke("write_text_file", { path, content: "" });
      setChatLogText("");
      void refreshChatLogList();
    } catch (err) {
      setError(String(err));
    }
  };

  const handleDeleteChatLog = async () => {
    if (!selectedChatId) return;
    try {
      await invoke("delete_chat_log", { chatId: selectedChatId });
      setChatLogText(null);
      await refreshChatLogList();
    } catch (err) {
      setError(String(err));
    }
  };

  const handleOpenChatLog = async () => {
    if (!selectedChatId) return;
    try {
      const path = await invoke<string>("get_chat_log_path", { chatId: selectedChatId });
      await openPath(path);
    } catch {
      // fall through
    }
  };

  const hasChatLogs = chatLogs.length > 0;
  const chatLoaded = chatLogText !== null && chatLogText.length > 0;

  return (
    <section
      className="rounded-[var(--radius-lg)] border p-5"
      style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-surface)" }}
    >
      <h2 className="mb-1 font-[var(--font-display)] text-lg">{t("sections.diagnostics")}</h2>
      <p className="mb-4 text-sm" style={{ color: "var(--color-text-muted)" }}>
        {t("diagnostics.subtitle")}
      </p>

      {version && (
        <p className="mb-1 text-xs" style={{ color: "var(--color-text-faint)" }}>
          {t("diagnostics.versionLabel")}: {version}
        </p>
      )}

      {logPath && (
        <p className="mb-3 break-all text-xs" style={{ color: "var(--color-text-faint)" }}>
          {t("diagnostics.logPathLabel")}: {logPath}
        </p>
      )}

      <div className="mb-4">
        <label htmlFor="log-level-select" className="mb-1 block text-sm font-medium">
          {t("diagnostics.logLevelLabel")}
        </label>
        <select
          id="log-level-select"
          value={logLevel}
          onChange={(e) => handleLogLevelChange(e.target.value as LogLevel)}
          className="rounded-[var(--radius-sm)] border px-2 py-1.5 text-sm"
          style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-surface-2)", color: "var(--color-text)" }}
        >
          {LOG_LEVELS.map((level) => (
            <option key={level} value={level}>
              {t(`diagnostics.logLevel${level.charAt(0).toUpperCase()}${level.slice(1)}`)}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs" style={{ color: "var(--color-text-muted)" }}>
          {t("diagnostics.logLevelHint")}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void handleOpenFolder()}
          disabled={!logPath}
          className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text)" }}
        >
          {t("diagnostics.openLogs")}
        </button>
        <button
          type="button"
          onClick={() => void handleOpenFile()}
          disabled={!logPath}
          className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text)" }}
        >
          {t("diagnostics.openLogFile")}
        </button>

        {updateCheck.phase === "available" ? (
          <button
            type="button"
            onClick={() => void handleInstallUpdate()}
            className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium"
            style={{ backgroundColor: "var(--color-accent)", color: "var(--color-accent-contrast, #fff)" }}
          >
            {t("diagnostics.updateInstall", { version: updateCheck.version })}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void handleCheckUpdate()}
            disabled={updateCheck.phase === "checking" || updateCheck.phase === "downloading"}
            className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text)" }}
          >
            {t("diagnostics.updateCheck")}
          </button>
        )}

        {updateCheck.phase === "checking" && (
          <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
            {t("diagnostics.updateChecking")}
          </span>
        )}
        {updateCheck.phase === "downloading" && (
          <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
            {t("diagnostics.updateDownloading")}
          </span>
        )}
        {updateCheck.phase === "upToDate" && (
          <span className="text-xs" style={{ color: "var(--color-success)" }}>
            {t("diagnostics.updateUpToDate")}
          </span>
        )}
        {updateCheck.phase === "error" && (
          <span className="text-xs" style={{ color: "var(--color-danger)" }}>
            {t("diagnostics.updateError")}
          </span>
        )}
      </div>

      {/* ── chat log ─────────────────────────────────────────────── */}
      <hr
        className="my-5"
        style={{ borderColor: "var(--color-border)" }}
      />
      <h3 className="mb-1 font-[var(--font-display)] text-base">
        {t("diagnostics.chatLogTitle")}
      </h3>
      <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
        {t("diagnostics.chatLogSubtitle")}
      </p>

      {hasChatLogs ? (
        <div className="mb-3">
          <label htmlFor="chat-log-select" className="mb-1 block text-xs font-medium">
            {t("diagnostics.chatLogSelectLabel")}
          </label>
          <select
            id="chat-log-select"
            value={selectedChatId}
            onChange={(e) => {
              setSelectedChatId(e.target.value);
              setChatLogText(null);
            }}
            className="rounded-[var(--radius-sm)] border px-2 py-1.5 text-sm max-w-full"
            style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-surface-2)", color: "var(--color-text)" }}
          >
            {chatLogs.map((l) => (
              <option key={l.chat_id} value={l.chat_id}>
                {l.chat_id} ({fmtSize(l.size_bytes)})
              </option>
            ))}
          </select>
        </div>
      ) : (
        <p className="mb-3 text-xs" style={{ color: "var(--color-text-muted)" }}>
          {t("diagnostics.chatLogEmpty")}
        </p>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void handleLoadChatLog()}
          disabled={chatLogLoading || !selectedChatId}
          className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text)" }}
        >
          {chatLogLoading ? t("common.state.loading") : t("diagnostics.chatLogLoad")}
        </button>
        {chatLoaded && (
          <button
            type="button"
            onClick={() => void handleClearChatLog()}
            className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium"
            style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text)" }}
          >
            {t("diagnostics.chatLogClear")}
          </button>
        )}
        <button
          type="button"
          onClick={() => void handleOpenChatLog()}
          disabled={!selectedChatId}
          className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text)" }}
        >
          {t("diagnostics.chatLogOpen")}
        </button>
        {hasChatLogs && (
          <button
            type="button"
            onClick={() => void handleDeleteChatLog()}
            className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium"
            style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-danger, #ef4444)" }}
          >
            {t("diagnostics.chatLogDelete")}
          </button>
        )}
      </div>

      {selectedChatId && chatLogText === null && (
        <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
          {t("diagnostics.chatLogNotLoaded")}
        </p>
      )}
      {chatLoaded && (
        <textarea
          readOnly
          value={chatLogText}
          rows={18}
          className="w-full resize-y rounded-[var(--radius-sm)] border p-3 font-mono text-xs leading-snug"
          style={{
            borderColor: "var(--color-border)",
            backgroundColor: "var(--color-surface-2)",
            color: "var(--color-text)",
            whiteSpace: "pre",
            overflowWrap: "normal",
          }}
        />
      )}

      {/* ── Extractor debug log ────────────────────────────────────── */}
      <hr
        className="my-5"
        style={{ borderColor: "var(--color-border)" }}
      />
      <h3 className="mb-1 font-[var(--font-display)] text-base">
        {t("diagnostics.extractorLogTitle")}
      </h3>
      <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
        {t("diagnostics.extractorLogSubtitle")}
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={async () => {
            try {
              const text = await invoke<string>("read_extractor_log", { maxBytes: 100_000 });
              setExtractorLogText(text || "");
            } catch (err) {
              setExtractorLogText(`Chyba: ${String(err)}`);
            }
          }}
          className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium"
          style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text)" }}
        >
          {t("diagnostics.extractorLogLoad")}
        </button>
        <button
          type="button"
          onClick={async () => {
            try {
              const path = await invoke<string>("get_extractor_log_path");
              await openPath(path);
            } catch { /* fall through */ }
          }}
          className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium"
          style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text)" }}
        >
          {t("diagnostics.extractorLogOpen")}
        </button>
        <button
          type="button"
          onClick={() => {
            void invoke("tail_extractor_log").catch((err) => setError(String(err)));
          }}
          className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium"
          style={{ backgroundColor: "var(--color-accent)", color: "var(--color-accent-contrast, #fff)" }}
        >
          {t("diagnostics.extractorLogTerminal")}
        </button>
      </div>

      {extractorLogText === null ? (
        <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
          {t("diagnostics.extractorLogNotLoaded")}
        </p>
      ) : extractorLogText.length === 0 ? (
        <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
          {t("diagnostics.extractorLogEmpty")}
        </p>
      ) : (
        <textarea
          readOnly
          value={extractorLogText}
          rows={12}
          className="w-full resize-y rounded-[var(--radius-sm)] border p-3 font-mono text-xs leading-snug"
          style={{
            borderColor: "var(--color-border)",
            backgroundColor: "var(--color-surface-2)",
            color: "var(--color-text)",
            whiteSpace: "pre",
            overflowWrap: "normal",
          }}
        />
      )}

      {error && (
        <p className="mt-2 text-xs" style={{ color: "var(--color-danger)" }}>
          {error}
        </p>
      )}
    </section>
  );
}
