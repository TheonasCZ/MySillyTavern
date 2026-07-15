import type { ReactNode } from "react";

import { Sidebar } from "./Sidebar";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen w-screen overflow-hidden" style={{ color: "var(--color-text)" }}>
      <Sidebar />
      <main className="flex-1 overflow-y-auto" style={{ backgroundColor: "var(--color-bg)" }}>
        {children}
      </main>
    </div>
  );
}
