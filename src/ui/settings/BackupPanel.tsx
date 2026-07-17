import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  cancelPendingImport,
  getAutoBackupEnabled,
  getAutoBackupMaxCount,
  hasPendingImport,
  listBackups,
  pickAndExportBackup,
  pickAndStageImport,
  restartApp,
  runAutoBackup,
  setAutoBackupEnabled,
  setAutoBackupMaxCount,
  type BackupEntry,
} from "../../db/backup";

type ExportState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; path: string }
  | { status: "error"; message: string };

type ImportState = { status: "idle" } | { status: "staging" } | { status: "error"; message: string };

type AutoBackupState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; path: string }
  | { status: "error"; message: string };

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function BackupPanel() {
  const { t } = useTranslation("settings");
  const [exportState, setExportState] = useState<ExportState>({ status: "idle" });
  const [importState, setImportState] = useState<ImportState>({ status: "idle" });
  const [pending, setPending] = useState(false);
  const [autoEnabled, setAutoEnabled] = useState(true);
  const [autoMaxCount, setAutoMaxCount] = useState(5);
  const [autoBackupState, setAutoBackupState] = useState<AutoBackupState>({ status: "idle" });
  const [backups, setBackups] = useState<BackupEntry[]>([]);

  useEffect(() => {
    void hasPendingImport().then(setPending);
  }, []);

  useEffect(() => {
    void getAutoBackupEnabled().then(setAutoEnabled);
    void getAutoBackupMaxCount().then(setAutoMaxCount);
    void listBackups().then(setBackups).catch(() => setBackups([]));
  }, []);

  const refreshBackups = useCallback(() => {
    void listBackups().then(setBackups).catch(() => setBackups([]));
  }, []);

  const handleAutoEnabledToggle = async (enabled: boolean) => {
    setAutoEnabled(enabled);
    await setAutoBackupEnabled(enabled);
  };

  const handleAutoMaxCountChange = async (value: number) => {
    const clamped = Math.max(1, Math.min(20, Math.round(value)));
    setAutoMaxCount(clamped);
    await setAutoBackupMaxCount(clamped);
  };

  const handleBackupNow = async () => {
    setAutoBackupState({ status: "running" });
    try {
      const path = await runAutoBackup(autoMaxCount);
      setAutoBackupState({ status: "done", path });
      refreshBackups();
    } catch (err) {
      setAutoBackupState({ status: "error", message: String(err) });
    }
  };

  const handleExport = async () => {
    setExportState({ status: "running" });
    try {
      const path = await pickAndExportBackup();
      setExportState(path ? { status: "done", path } : { status: "idle" });
    } catch (err) {
      setExportState({ status: "error", message: String(err) });
    }
  };

  const handleImport = async () => {
    setImportState({ status: "staging" });
    try {
      const path = await pickAndStageImport();
      setImportState({ status: "idle" });
      if (path) setPending(true);
    } catch (err) {
      setImportState({ status: "error", message: String(err) });
    }
  };

  const handleCancelImport = async () => {
    await cancelPendingImport();
    setPending(false);
  };

  const handleRestart = async () => {
    // The actual data-overwriting step happens on the next app start (in
    // Rust's `setup()` hook), triggered by this restart — so the
    // destructive-action confirmation belongs right here, not at the file
    // picker (plan §7 M6: "confirmation dialog before import, warn that it
    // overwrites data").
    if (!confirm(t("backup.importWarning") ?? "")) return;
    await restartApp();
  };

  return (
    <section
      className="rounded-[var(--radius-lg)] border p-5"
      style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-surface)" }}
    >
      <h2 className="mb-1 font-[var(--font-display)] text-lg">{t("sections.backup")}</h2>
      <p className="mb-4 text-sm" style={{ color: "var(--color-text-muted)" }}>
        {t("backup.subtitle")}
      </p>

      {pending && (
        <div
          className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-sm)] border p-3 text-sm"
          style={{ borderColor: "var(--color-warning)", backgroundColor: "var(--color-bg-elevated)" }}
        >
          <span>{t("backup.pendingRestart")}</span>
          <span className="flex gap-2">
            <button
              type="button"
              onClick={() => void handleRestart()}
              className="rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium"
              style={{ backgroundColor: "var(--color-danger)", color: "var(--color-accent-contrast)" }}
            >
              {t("backup.restartNow")}
            </button>
            <button
              type="button"
              onClick={() => void handleCancelImport()}
              className="rounded-[var(--radius-sm)] px-3 py-1.5 text-xs"
              style={{ color: "var(--color-text-muted)" }}
            >
              {t("backup.cancelImport")}
            </button>
          </span>
        </div>
      )}

      <div className="flex flex-col gap-6 sm:flex-row">
        <div className="flex-1">
          <h3 className="mb-2 text-sm font-medium">{t("backup.exportTitle")}</h3>
          <p className="mb-3 text-xs" style={{ color: "var(--color-text-faint)" }}>
            {t("backup.exportHint")}
          </p>
          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={exportState.status === "running"}
            className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text)" }}
          >
            {exportState.status === "running" ? t("backup.exporting") : t("backup.exportButton")}
          </button>
          {exportState.status === "done" && (
            <p className="mt-2 text-xs" style={{ color: "var(--color-success)" }}>
              {t("backup.exportDone", { path: exportState.path })}
            </p>
          )}
          {exportState.status === "error" && (
            <p className="mt-2 text-xs" style={{ color: "var(--color-danger)" }}>
              {t("backup.exportError", { message: exportState.message })}
            </p>
          )}
        </div>

        <div
          className="flex-1 border-t pt-4 sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0"
          style={{ borderColor: "var(--color-border)" }}
        >
          <h3 className="mb-2 text-sm font-medium">{t("backup.importTitle")}</h3>
          <p className="mb-3 text-xs" style={{ color: "var(--color-text-faint)" }}>
            {t("backup.importHint")}
          </p>
          <button
            type="button"
            onClick={() => void handleImport()}
            disabled={importState.status === "staging" || pending}
            className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text)" }}
          >
            {importState.status === "staging" ? t("backup.importing") : t("backup.importButton")}
          </button>
          {importState.status === "error" && (
            <p className="mt-2 text-xs" style={{ color: "var(--color-danger)" }}>
              {t("backup.importError", { message: importState.message })}
            </p>
          )}
        </div>
      </div>

      {/* ── M14.1 auto-backup section ─────────────────────────────── */}
      <div
        className="mt-6 border-t pt-6"
        style={{ borderColor: "var(--color-border)" }}
      >
        <h3 className="mb-1 text-sm font-medium">{t("backup.autoBackupTitle")}</h3>
        <p className="mb-4 text-xs" style={{ color: "var(--color-text-faint)" }}>
          {t("backup.autoBackupHint")}
        </p>

        <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={autoEnabled}
              onChange={(e) => void handleAutoEnabledToggle(e.target.checked)}
              className="h-4 w-4"
            />
            {t("backup.autoBackupEnabled")}
          </label>

          <label className="flex items-center gap-2 text-sm">
            {t("backup.autoBackupMaxCount")}:
            <input
              type="number"
              min={1}
              max={20}
              value={autoMaxCount}
              onChange={(e) => void handleAutoMaxCountChange(Number(e.target.value))}
              className="w-16 rounded-[var(--radius-sm)] border px-2 py-1 text-sm"
              style={{
                borderColor: "var(--color-border)",
                backgroundColor: "var(--color-bg-elevated)",
                color: "var(--color-text)",
              }}
            />
          </label>

          <button
            type="button"
            onClick={() => void handleBackupNow()}
            disabled={autoBackupState.status === "running"}
            className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text)" }}
          >
            {autoBackupState.status === "running"
              ? t("backup.backupNowRunning")
              : t("backup.backupNow")}
          </button>
        </div>

        {autoBackupState.status === "done" && (
          <p className="mt-2 text-xs" style={{ color: "var(--color-success)" }}>
            {t("backup.backupNowDone", { path: autoBackupState.path })}
          </p>
        )}
        {autoBackupState.status === "error" && (
          <p className="mt-2 text-xs" style={{ color: "var(--color-danger)" }}>
            {t("backup.backupNowError", { message: autoBackupState.message })}
          </p>
        )}

        {/* existing backups list */}
        {backups.length > 0 && (
          <div className="mt-4">
            <h4 className="mb-2 text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
              {t("backup.existingBackups")} ({backups.length})
            </h4>
            <ul className="space-y-1">
              {backups.map((b) => (
                <li
                  key={b.path}
                  className="flex justify-between gap-3 rounded-[var(--radius-sm)] px-2 py-1 text-xs"
                  style={{ backgroundColor: "var(--color-bg-elevated)" }}
                >
                  <span className="truncate" style={{ color: "var(--color-text)" }}>
                    {b.path.split(/[/\\]/).pop() ?? b.path}
                  </span>
                  <span
                    className="shrink-0 tabular-nums"
                    style={{ color: "var(--color-text-faint)" }}
                  >
                    {formatSize(b.size)} — {b.created_at}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {backups.length === 0 && (
          <p className="mt-3 text-xs" style={{ color: "var(--color-text-faint)" }}>
            {t("backup.noBackups")}
          </p>
        )}
      </div>
    </section>
  );
}
