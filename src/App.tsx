import { useEffect } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";

import { useSettingsStore } from "./stores/settingsStore";
import { CardEditor } from "./ui/characters/CardEditor";
import { GalleryScreen } from "./ui/characters/GalleryScreen";
import { ChatListScreen } from "./ui/chat/ChatListScreen";
import { ChatScreen } from "./ui/chat/ChatScreen";
import { AppShell } from "./ui/layout/AppShell";
import { PlaceholderScreen } from "./ui/layout/PlaceholderScreen";
import { SettingsScreen } from "./ui/settings/SettingsScreen";

function App() {
  const { hydrated, hydrate } = useSettingsStore();

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

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
          <Route path="/personas" element={<PlaceholderScreen ns="personas" titleKey="title" />} />
          <Route path="/lorebooks" element={<PlaceholderScreen ns="lorebooks" titleKey="title" />} />
          <Route path="/lorebooks/:id" element={<PlaceholderScreen ns="lorebooks" titleKey="title" />} />
          <Route path="/settings" element={<SettingsScreen />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell>
    </HashRouter>
  );
}

export default App;
