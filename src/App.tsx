import { useEffect } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";

import { getAutoBackupEnabled, getAutoBackupMaxCount, runAutoBackup } from "./db/backup";
import { runSyncOnStartup } from "./db/syncReader";
import { useSettingsStore } from "./stores/settingsStore";
import { CardEditor } from "./ui/characters/CardEditor";
import { GalleryScreen } from "./ui/characters/GalleryScreen";
import { ChatListScreen } from "./ui/chat/ChatListScreen";
import { ChatScreen } from "./ui/chat/ChatScreen";
import { AppShell } from "./ui/layout/AppShell";
import { LorebookEditor } from "./ui/lorebooks/LorebookEditor";
import { LorebooksListScreen } from "./ui/lorebooks/LorebooksListScreen";
import { PersonasScreen } from "./ui/personas/PersonasScreen";
import { SettingsScreen } from "./ui/settings/SettingsScreen";
import { UpdateBanner } from "./ui/UpdateBanner";

function App() {
  const { hydrated, hydrate } = useSettingsStore();

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
      }
    })();
  }, [hydrated]);

  if (!hydrated) {
    return null;
  }

  return (
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
        <UpdateBanner />
      </AppShell>
    </HashRouter>
  );
}

export default App;
