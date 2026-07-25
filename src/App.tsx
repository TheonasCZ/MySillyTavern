import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";

import { getAutoBackupEnabled, getAutoBackupMaxCount, runAutoBackup } from "./db/backup";
import { runSyncOnStartup } from "./db/syncReader";
import { useSettingsStore } from "./stores/settingsStore";
import { CardEditor } from "./ui/characters/CardEditor";
import { GalleryScreen } from "./ui/characters/GalleryScreen";
import { ChatListScreen } from "./ui/chat/ChatListScreen";
import { ChatScreen } from "./ui/chat/ChatScreen";
import { SamplerToast } from "./ui/common/SamplerToast";
import { UndoToast } from "./ui/common/UndoToast";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import { AppShell } from "./ui/layout/AppShell";
import { LorebookEditor } from "./ui/lorebooks/LorebookEditor";
import { LorebooksListScreen } from "./ui/lorebooks/LorebooksListScreen";
import { PersonasScreen } from "./ui/personas/PersonasScreen";
import { SettingsScreen } from "./ui/settings/SettingsScreen";
import { UpdateBanner } from "./ui/UpdateBanner";
import { KeyboardShortcutListener } from "./ui/useKeyboardShortcuts";

function App() {
  const { t } = useTranslation("common");
  const { hydrated, hydrate } = useSettingsStore();
  // Startup auto-backup and sync both run once, independently of each
  // other, alongside settings hydration — the loading screen stays up
  // until all three are done, not just `hydrated`, so the app is never
  // shown mid-backup/mid-sync (plan follow-up after the M14.1 auto-backup
  // command was found to briefly block the window — see backup.rs).
  const [backupDone, setBackupDone] = useState(false);
  const [syncDone, setSyncDone] = useState(false);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // Startup auto-backup (M14.1) — driven from the frontend so it can respect
  // the settings stored in SQLite and checkpoint the WAL before zipping.
  useEffect(() => {
    void (async () => {
      try {
        if (await getAutoBackupEnabled()) {
          await runAutoBackup(await getAutoBackupMaxCount());
        }
      } catch (err) {
        console.warn("startup auto-backup failed:", err);
      } finally {
        setBackupDone(true);
      }
    })();
  }, []);

  // Startup sync (M14) — scan and apply foreign device journals after DB is ready.
  useEffect(() => {
    if (!hydrated) return;
    void (async () => {
      try {
        await runSyncOnStartup();
      } catch (err) {
        console.warn("[sync] startup sync failed:", err);
      } finally {
        setSyncDone(true);
      }
    })();
  }, [hydrated]);

  const ready = hydrated && backupDone && syncDone;

  if (!ready) {
    // Hardcoded colors, not CSS vars — the theme class (which defines
    // --color-bg/--color-text etc.) is only applied once `hydrate()`
    // resolves, so vars aren't available yet during this exact window.
    // Dark values match the app's dark-first default theme.
    return (
      <div
        className="flex h-screen w-screen flex-col items-center justify-center gap-3"
        style={{ backgroundColor: "#14110f", color: "#e8dfd2" }}
      >
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-t-transparent"
          style={{ borderColor: "#d97742", borderTopColor: "transparent" }}
        />
        <span className="text-sm tracking-wide opacity-70">{t("state.loading")}</span>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <HashRouter>
        <AppShell>
          <Routes>
            <Route path="/" element={<ChatListScreen />} />
            <Route path="/chat/:id" element={<ChatScreen />} />
            <Route path="/characters" element={<GalleryScreen />} />
            <Route path="/characters/:id" element={<CardEditor />} />
            <Route path="/personas" element={<PersonasScreen />} />
            <Route path="/lorebooks" element={<LorebooksListScreen />} />
            <Route path="/lorebooks/:id" element={<LorebookEditor />} />
            <Route path="/settings" element={<SettingsScreen />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <KeyboardShortcutListener />
          <UpdateBanner />
          <SamplerToast />
          <UndoToast />
        </AppShell>
      </HashRouter>
    </ErrorBoundary>
  );
}

export default App;
