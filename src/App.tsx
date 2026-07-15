import { useEffect } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";

import { useSettingsStore } from "./stores/settingsStore";
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
          <Route path="/" element={<PlaceholderScreen ns="chat" titleKey="title" />} />
          <Route path="/chat/:id" element={<PlaceholderScreen ns="chat" titleKey="title" />} />
          <Route path="/characters" element={<PlaceholderScreen ns="characters" titleKey="title" />} />
          <Route path="/characters/:id" element={<PlaceholderScreen ns="characters" titleKey="title" />} />
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
