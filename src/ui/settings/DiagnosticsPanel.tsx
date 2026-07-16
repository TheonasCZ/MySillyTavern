import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";

// Diagnostics section (roadmap M11 §3): surfaces the error log path
// (src/logging.ts writes here via the Rust `append_log` command) and a
// button to open the containing folder, so a user can attach `app.log`
// when reporting a bug instead of describing it from memory.
export function DiagnosticsPanel() {
  const { t } = useTranslation("settings");
  const [logPath, setLogPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void invoke<string>("get_log_path")
      .then(setLogPath)
      .catch((err) => setError(String(err)));
  }, []);

  const handleOpen = async () => {
    if (!logPath) return;
    try {
      await revealItemInDir(logPath);
    } catch (err) {
      setError(String(err));
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

      {logPath && (
        <p className="mb-3 break-all text-xs" style={{ color: "var(--color-text-faint)" }}>
          {t("diagnostics.logPathLabel")}: {logPath}
        </p>
      )}

      <button
        type="button"
        onClick={() => void handleOpen()}
        disabled={!logPath}
        className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
        style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text)" }}
      >
        {t("diagnostics.openLogs")}
      </button>

      {error && (
        <p className="mt-2 text-xs" style={{ color: "var(--color-danger)" }}>
          {error}
        </p>
      )}
    </section>
  );
}
