import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { openDialog, showConfirm } from "../../platform";

import {
  pushAllLocalSecretsToSync,
  retryDecryptAllSyncedSecrets,
} from "../../db/repositories/connectionSecretsRepo";
import { ensureDeviceId, getSetting, setSetting } from "../../db/repositories/settingsRepo";
import { exportAllToSync } from "../../db/syncExport";
import { resetSyncJournal } from "../../db/syncJournal";
import { runSyncOnStartup } from "../../db/syncReader";

export function SyncPanel() {
  const { t } = useTranslation("settings");
  const [folderPath, setFolderPath] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [hasPassphrase, setHasPassphrase] = useState(false);
  const [passphraseInput, setPassphraseInput] = useState("");
  const [passphraseBusy, setPassphraseBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const folder = (await getSetting("sync_folder_path")) ?? "";
      const devId = await ensureDeviceId();
      setFolderPath(folder);
      setDeviceId(devId);
      const last = await getSetting("sync_last_run");
      setLastSync(last);
      setHasPassphrase(await invoke<boolean>("has_sync_passphrase"));
    })();
  }, []);

  const handleSavePassphrase = async () => {
    if (!passphraseInput) return;
    setPassphraseBusy(true);
    try {
      await invoke("set_sync_passphrase", { passphrase: passphraseInput });
      await pushAllLocalSecretsToSync();
      await retryDecryptAllSyncedSecrets();
      setHasPassphrase(true);
      setPassphraseInput("");
    } catch (err) {
      console.warn("[sync] failed to set passphrase:", err);
    } finally {
      setPassphraseBusy(false);
    }
  };

  const handleClearPassphrase = async () => {
    const confirmed = await showConfirm(t("sync.passphraseClearConfirm") ?? "");
    if (!confirmed) return;
    await invoke("clear_sync_passphrase");
    setHasPassphrase(false);
  };

  const handlePickFolder = async () => {
    const selected = await openDialog({ directory: true, title: t("sync.pickFolder") ?? "Choose sync folder" });
    if (selected && typeof selected === "string") {
      setFolderPath(selected);
      await setSetting("sync_folder_path", selected);
      await ensureDeviceId();
      resetSyncJournal(); // re-init journal with new path
    }
  };

  const handleClearFolder = async () => {
    setFolderPath("");
    await setSetting("sync_folder_path", "");
    resetSyncJournal();
  };

  const handleExportAll = async () => {
    setExporting(true);
    setExportStatus(null);
    try {
      await exportAllToSync();
      setExportStatus(t("sync.exportAllDone"));
    } catch (err) {
      setExportStatus(t("sync.exportAllError", { message: String(err) }));
    } finally {
      setExporting(false);
    }
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      await runSyncOnStartup();
      const now = new Date().toISOString();
      await setSetting("sync_last_run", now);
      setLastSync(now);
    } catch (err) {
      console.warn("[sync] manual sync failed:", err);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-[var(--font-display)] text-lg" style={{ color: "var(--color-text)" }}>
          {t("sync.title")}
        </h2>
        <p className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
          {t("sync.subtitle")}
        </p>
      </div>

      {/* Folder path */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
          {t("sync.folderPath")}
        </label>
        <div className="flex items-center gap-2">
          <input
            type="text"
            readOnly
            value={folderPath}
            placeholder={t("sync.disabled") ?? ""}
            className="flex-1 rounded-[var(--radius-sm)] px-3 py-1.5 text-sm"
            style={{
              backgroundColor: "var(--color-surface-2)",
              color: "var(--color-text)",
              border: "1px solid var(--color-border)",
            }}
          />
          <button
            type="button"
            onClick={handlePickFolder}
            className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm"
            style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text)" }}
          >
            {t("sync.pickFolder")}
          </button>
          {folderPath && (
            <button
              type="button"
              onClick={handleClearFolder}
              className="rounded-[var(--radius-sm)] px-2 py-1 text-sm"
              style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-danger)" }}
            >
              ✕
            </button>
          )}
        </div>
        <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
          {t("sync.folderHelp")}
        </p>
      </div>

      {/* Device ID (read-only) */}
      {deviceId && (
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
            {t("sync.deviceId")}
          </label>
          <input
            type="text"
            readOnly
            value={deviceId}
            className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-mono"
            style={{
              backgroundColor: "var(--color-surface-2)",
              color: "var(--color-text-muted)",
              border: "1px solid var(--color-border)",
            }}
          />
          <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
            {t("sync.deviceIdHelp")}
          </p>
        </div>
      )}

      {/* Status & manual sync */}
      {folderPath && (
        <div className="flex items-center gap-3">
          <span className="text-sm" style={{ color: "var(--color-text-muted)" }}>
            {t("sync.lastSync")}: {lastSync ? new Date(lastSync).toLocaleString() : t("sync.never")}
          </span>
          <button
            type="button"
            onClick={handleSyncNow}
            disabled={syncing}
            className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm"
            style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text)" }}
          >
            {syncing ? t("sync.syncing") : t("sync.syncNow")}
          </button>
        </div>
      )}

      {/* Sync passphrase — encrypted API key sync */}
      {folderPath && (
        <div className="flex flex-col gap-1.5 border-t pt-4" style={{ borderColor: "var(--color-border)" }}>
          <label className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
            {t("sync.passphraseTitle")}
          </label>
          <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
            {t("sync.passphraseHelp")}
          </p>
          <div className="flex items-center gap-2">
            <input
              type="password"
              value={passphraseInput}
              onChange={(e) => setPassphraseInput(e.target.value)}
              placeholder={t("sync.passphrasePlaceholder") ?? ""}
              className="flex-1 rounded-[var(--radius-sm)] px-3 py-1.5 text-sm"
              style={{
                backgroundColor: "var(--color-surface-2)",
                color: "var(--color-text)",
                border: "1px solid var(--color-border)",
              }}
            />
            <button
              type="button"
              onClick={handleSavePassphrase}
              disabled={passphraseBusy || !passphraseInput}
              className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm"
              style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text)" }}
            >
              {passphraseBusy ? t("sync.passphraseSaving") : t("sync.passphraseSave")}
            </button>
            {hasPassphrase && (
              <button
                type="button"
                onClick={handleClearPassphrase}
                className="rounded-[var(--radius-sm)] px-2 py-1 text-sm"
                style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-danger)" }}
              >
                {t("sync.passphraseClear")}
              </button>
            )}
          </div>
          <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
            {hasPassphrase ? t("sync.passphraseSet") : t("sync.passphraseNotSet")}
          </span>
        </div>
      )}

      {/* One-shot backfill of existing data — normal sync only journals
          future writes, so pre-existing chats/characters/settings need an
          explicit push for a fresh second device to see them. */}
      {folderPath && (
        <div className="flex flex-col gap-1.5 border-t pt-4" style={{ borderColor: "var(--color-border)" }}>
          <label className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
            {t("sync.exportAllTitle")}
          </label>
          <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
            {t("sync.exportAllHelp")}
          </p>
          <div>
            <button
              type="button"
              onClick={handleExportAll}
              disabled={exporting}
              className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm"
              style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text)" }}
            >
              {exporting ? t("sync.exportAllRunning") : t("sync.exportAllButton")}
            </button>
          </div>
          {exportStatus && (
            <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              {exportStatus}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
