import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { useOnlineStatus } from "../useOnlineStatus";
import { Sidebar } from "./Sidebar";

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation("common");
  const online = useOnlineStatus();

  return (
    <div className="flex h-screen w-screen overflow-hidden" style={{ color: "var(--color-text)" }}>
      <Sidebar />
      <main className="flex flex-1 flex-col overflow-hidden" style={{ backgroundColor: "var(--color-bg)" }}>
        {!online && (
          <div
            className="shrink-0 px-4 py-1.5 text-center text-xs font-medium"
            style={{ backgroundColor: "var(--color-warning)", color: "var(--color-accent-contrast)" }}
            role="status"
          >
            {t("offline")}
          </div>
        )}
        <div className="flex-1 overflow-y-auto">{children}</div>
      </main>
    </div>
  );
}
