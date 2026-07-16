import { useTranslation } from "react-i18next";

import { AppearancePanel } from "./AppearancePanel";
import { BackupPanel } from "./BackupPanel";
import { ConnectionsPanel } from "./ConnectionsPanel";
import { MemorySettingsPanel } from "./MemorySettingsPanel";

export function SettingsScreen() {
  const { t } = useTranslation("settings");

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-8">
      <h1 className="font-[var(--font-display)] text-2xl">{t("title")}</h1>
      <ConnectionsPanel />
      <MemorySettingsPanel />
      <AppearancePanel />
      <BackupPanel />
    </div>
  );
}
