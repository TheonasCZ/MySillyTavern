import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { checkForUpdate, relaunchApp, type AvailableUpdate } from "../platform";

type Phase = "idle" | "available" | "downloading" | "error";

/**
 * Non-intrusive update notification (M32). Checks GitHub Releases once on
 * startup; when a newer version exists, shows a small toast with an
 * "update now" button. Download + install + signature verification is
 * handled by tauri-plugin-updater; we just relaunch afterwards.
 */
export function UpdateBanner() {
  const { t } = useTranslation();
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    void checkForUpdate().then((u) => {
      if (u) {
        setUpdate(u);
        setPhase("available");
      }
    });
  }, []);

  if (!update || dismissed || phase === "idle") return null;

  const install = async () => {
    setPhase("downloading");
    try {
      await update.downloadAndInstall();
      await relaunchApp();
    } catch (err) {
      console.warn("update failed:", err);
      setPhase("error");
    }
  };

  return (
    <div
      className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-lg px-4 py-3 shadow-lg"
      style={{
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        color: "var(--color-text)",
      }}
    >
      <span className="text-sm">
        {phase === "error"
          ? t("update.error")
          : phase === "downloading"
            ? t("update.downloading")
            : t("update.available", { version: update.version })}
      </span>
      {phase === "available" && (
        <button
          type="button"
          className="rounded px-3 py-1 text-sm font-medium"
          style={{ background: "var(--color-accent)", color: "var(--color-accent-contrast, #fff)" }}
          onClick={() => void install()}
        >
          {t("update.installNow")}
        </button>
      )}
      {phase !== "downloading" && (
        <button
          type="button"
          className="text-sm"
          style={{ color: "var(--color-text-muted)" }}
          onClick={() => setDismissed(true)}
          aria-label={t("update.dismiss")}
        >
          ✕
        </button>
      )}
    </div>
  );
}
