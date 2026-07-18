import { showConfirm } from "../../platform";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { resetAllSettings } from "../../db/repositories/settingsRepo";
import { AppearancePanel } from "./AppearancePanel";
import { BackupPanel } from "./BackupPanel";
import { ConnectionsPanel } from "./ConnectionsPanel";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { MemorySettingsPanel } from "./MemorySettingsPanel";
import { PresetsPanel } from "./PresetsPanel";
import { ShortcutsPanel } from "./ShortcutsPanel";
import { SyncPanel } from "./SyncPanel";
import { TtsPanel } from "./TtsPanel";
import { UsagePanel } from "./UsagePanel";

type Tab = "connection" | "play" | "appearance" | "data";

const TABS: readonly { id: Tab; i18nKey: string }[] = [
  { id: "connection", i18nKey: "tabs.connection" },
  { id: "play", i18nKey: "tabs.play" },
  { id: "appearance", i18nKey: "tabs.appearance" },
  { id: "data", i18nKey: "tabs.data" },
] as const;

const STORAGE_KEY = "settings-tab";

function readStoredTab(): Tab {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && TABS.some((t) => t.id === stored)) return stored as Tab;
  } catch {
    // localStorage unavailable
  }
  return "connection";
}

function storeTab(tab: Tab) {
  try {
    localStorage.setItem(STORAGE_KEY, tab);
  } catch {
    // localStorage unavailable
  }
}

export function SettingsScreen() {
  const { t } = useTranslation("settings");
  const [tab, setTab] = useState<Tab>(readStoredTab);
  const [resetDone, setResetDone] = useState(false);

  const switchTab = useCallback(
    (next: Tab) => {
      setTab(next);
      storeTab(next);
      // Update URL hash so deep links work
      if (window.location.hash !== `#settings/${next}`) {
        history.replaceState(null, "", `#settings/${next}`);
      }
    },
    [],
  );

  // On mount, read the hash if present
  useEffect(() => {
    const hash = window.location.hash;
    const match = /^#settings\/(connection|play|appearance|data)$/.exec(hash);
    if (match) {
      const hashTab = match[1] as Tab;
      setTab(hashTab);
      storeTab(hashTab);
    } else if (hash.startsWith("#settings")) {
      // Legacy hash — just adopt current tab
      history.replaceState(null, "", `#settings/${tab}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-8">
      <h1 className="font-[var(--font-display)] text-2xl">{t("title")}</h1>

      {/* Tab bar */}
      <nav
        className="flex gap-0 overflow-x-auto rounded-[var(--radius-md)]"
        style={{ backgroundColor: "var(--color-surface-2)" }}
        role="tablist"
      >
        {TABS.map(({ id, i18nKey }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => switchTab(id)}
            className="flex-1 whitespace-nowrap px-4 py-2 text-sm font-medium transition-colors first:rounded-l-[var(--radius-md)] last:rounded-r-[var(--radius-md)]"
            style={{
              backgroundColor: tab === id ? "var(--color-primary)" : "transparent",
              color: tab === id ? "var(--color-primary-contrast, #fff)" : "var(--color-text)",
            }}
          >
            {t(i18nKey)}
          </button>
        ))}
      </nav>

      {/* Tab panels */}
      {tab === "connection" && <ConnectionsPanel />}

      {tab === "play" && (
        <>
          <PresetsPanel />
          <TtsPanel />
          <SyncPanel />
        </>
      )}

      {tab === "appearance" && (
        <>
          <AppearancePanel />
          <MemorySettingsPanel />
        </>
      )}

      {tab === "data" && (
        <>
          <BackupPanel />
          <UsagePanel />
          <DiagnosticsPanel />
          <ShortcutsPanel />
        </>
      )}

      <div className="border-t pt-4" style={{ borderColor: "var(--color-border)" }}>
        <button
          type="button"
          onClick={async () => {
            if (await showConfirm(t("resetConfirm") ?? "Obnovit výchozí nastavení?")) {
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
