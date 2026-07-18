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

type Tab = "connection" | "game" | "sound" | "sync" | "appearance" | "data" | "shortcuts";

const TABS: readonly { id: Tab; i18nKey: string }[] = [
  { id: "connection", i18nKey: "tabs.connection" },
  { id: "game", i18nKey: "tabs.game" },
  { id: "sound", i18nKey: "tabs.sound" },
  { id: "sync", i18nKey: "tabs.sync" },
  { id: "appearance", i18nKey: "tabs.appearance" },
  { id: "data", i18nKey: "tabs.data" },
  { id: "shortcuts", i18nKey: "tabs.shortcuts" },
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
  const [menuOpen, setMenuOpen] = useState(false);

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
    const match = /^#settings\/(connection|sound|sync|system|appearance|data|shortcuts)$/.exec(hash);
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

      {/* ---- Desktop tab bar (sm+) ---- */}
      <nav
        className="hidden gap-0 rounded-[var(--radius-md)] sm:flex"
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
              color: tab === id ? "var(--color-accent-contrast, #fff)" : "var(--color-text)",
            }}
          >
            {t(i18nKey)}
          </button>
        ))}
      </nav>

      {/* ---- Mobile burger dropdown (below sm) ---- */}
      <div className="relative sm:hidden">
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          className="flex w-full items-center justify-between rounded-[var(--radius-md)] px-4 py-2.5 text-sm font-medium"
          style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text)" }}
          aria-expanded={menuOpen}
        >
          <span>{t(TABS.find((t) => t.id === tab)!.i18nKey)}</span>
          <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>{menuOpen ? "▲" : "▼"}</span>
        </button>
        {menuOpen && (
          <>
            {/* Backdrop to close on outside click */}
            <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
            <div
              className="absolute left-0 right-0 z-50 mt-1 rounded-[var(--radius-md)] py-1 shadow-lg"
              style={{ backgroundColor: "var(--color-surface-2)", borderColor: "var(--color-border)", borderWidth: 1 }}
              role="menu"
            >
              {TABS.map(({ id, i18nKey }) => (
                <button
                  key={id}
                  type="button"
                  role="menuitem"
                  onClick={() => { switchTab(id); setMenuOpen(false); }}
                  className="block w-full px-4 py-2 text-left text-sm transition-colors"
                  style={{
                    backgroundColor: tab === id ? "var(--color-primary)" : "transparent",
                    color: tab === id ? "var(--color-accent-contrast, #fff)" : "var(--color-text)",
                  }}
                >
                  {t(i18nKey)}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Tab panels */}
      {tab === "connection" && <ConnectionsPanel />}

      {tab === "sound" && <TtsPanel />}

      {tab === "sync" && <SyncPanel />}

      {tab === "game" && (
        <>
          <PresetsPanel />
          <MemorySettingsPanel />
        </>
      )}

      {tab === "appearance" && <AppearancePanel />}

      {tab === "data" && (
        <>
          <BackupPanel />
          <UsagePanel />
          <DiagnosticsPanel />
        </>
      )}

      {tab === "shortcuts" && <ShortcutsPanel />}

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
