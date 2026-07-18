import { useEffect, useState } from "react";
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

// Diagnostics section (roadmap M11 §3): surfaces the error log path
// (src/logging.ts writes here via the Rust `append_log` command) and
// buttons to open the log file itself or the containing folder, so a user
// can attach `app.log` when reporting a bug instead of describing it from
// memory.
export function DiagnosticsPanel() {
  const { t } = useTranslation("settings");
  const [logPath, setLogPath] = useState<string | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updateCheck, setUpdateCheck] = useState<UpdateCheckState>({ phase: "idle" });
  const [logLevel, setLogLevelState] = useState<LogLevel>("info");

  useEffect(() => {
    void invoke<string>("get_log_path")
      .then(setLogPath)
      .catch((err) => setError(String(err)));
    void getVersion()
      .then(setVersion)
      .catch(() => {});
    // Re-read from the DB (not just the in-memory cache) so this always
    // reflects the persisted value, then keep the cache in sync too.
    void refreshLogLevel().then(() => setLogLevelState(getLogLevel()));
  }, []);

  const handleLogLevelChange = (level: LogLevel) => {
    setLogLevelState(level);
    // Persists to DB and refreshes the in-memory cache used to gate file
    // writes, so the change takes effect immediately without a restart.
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
      // `openPath` tries to open the file with the default app; if the
      // file doesn't exist yet we fall back to revealing its parent dir.
      await openPath(logPath);
    } catch {
      // openPath may fail if the file doesn't exist — fall back to folder
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

      {error && (
        <p className="mt-2 text-xs" style={{ color: "var(--color-danger)" }}>
          {error}
        </p>
      )}
    </section>
  );
}
