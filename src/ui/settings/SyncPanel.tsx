import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { openDialog } from "../../platform";

import { ensureDeviceId, getSetting, setSetting } from "../../db/repositories/settingsRepo";
import { resetSyncJournal } from "../../db/syncJournal";
import { runSyncOnStartup } from "../../db/syncReader";

export function SyncPanel() {
  const { t } = useTranslation("settings");
  const [folderPath, setFolderPath] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const folder = (await getSetting("sync_folder_path")) ?? "";
      const devId = await ensureDeviceId();
      setFolderPath(folder);
      setDeviceId(devId);
      const last = await getSetting("sync_last_run");
      setLastSync(last);
    })();
  }, []);

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
    </div>
  );
}
