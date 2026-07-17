import { useState } from "react";
import { useTranslation } from "react-i18next";

import { resetAllSettings } from "../../db/repositories/settingsRepo";
import { AppearancePanel } from "./AppearancePanel";
import { BackupPanel } from "./BackupPanel";
import { ConnectionsPanel } from "./ConnectionsPanel";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { MemorySettingsPanel } from "./MemorySettingsPanel";
import { PresetsPanel } from "./PresetsPanel";
import { TtsPanel } from "./TtsPanel";
import { UsagePanel } from "./UsagePanel";

export function SettingsScreen() {
  const { t } = useTranslation("settings");
  const [resetDone, setResetDone] = useState(false);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-8">
      <h1 className="font-[var(--font-display)] text-2xl">{t("title")}</h1>
      <ConnectionsPanel />
      <PresetsPanel />
      <MemorySettingsPanel />
      <AppearancePanel />
      <TtsPanel />
      <BackupPanel />
      <UsagePanel />
      <DiagnosticsPanel />
      <div className="border-t pt-4" style={{ borderColor: "var(--color-border)" }}>
        <button
          type="button"
          onClick={async () => {
            if (confirm(t("resetConfirm") ?? "Obnovit výchozí nastavení?")) {
              await resetAllSettings();
              setResetDone(true);
              setTimeout(() => setResetDone(false), 2000);
              window.location.reload();
            }
          }}
          className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm"
          style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-danger)" }}
        >
          {resetDone ? "✅ " + (t("resetDone") ?? "Obnoveno!") : t("resetButton") ?? "Obnovit výchozí hodnoty"}
        </button>
      </div>
    </div>
  );
}
