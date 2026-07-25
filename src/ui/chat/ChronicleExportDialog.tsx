import { invoke } from "@tauri-apps/api/core";

import type { ChronicleTheme } from "../../chat/chronicleTypes";
import { THEMES } from "../../chat/chronicleThemes";
import type { ConnectionConfig } from "../../providers/types";
import { inputStyle as selectStyle } from "../common/inputStyle";
import type { useChatActions } from "./useChatActions";

export function ChronicleExportDialog({
  actions,
  chatId,
  personaId,
  exportConnections,
  onClose,
}: {
  actions: ReturnType<typeof useChatActions>;
  chatId: string;
  personaId: string | null | undefined;
  exportConnections: ConnectionConfig[];
  onClose: () => void;
}) {
  return (
    <>
      <div
        className="fixed inset-0 z-50"
        style={{ backgroundColor: "var(--color-overlay)" }}
        onClick={onClose}
      />
      <div
        className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-md)] border p-6 shadow-xl"
        style={{
          borderColor: "var(--color-border-strong)",
          backgroundColor: "var(--color-bg-elevated)",
          color: "var(--color-text)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {actions.exportJobId ? (
          /* ---- Progress ---- */
          <div className="space-y-3">
            <h3 className="font-[var(--font-display)] text-lg">📖 Export kroniky</h3>
            {actions.exportStatus ? (
              <>
                <div
                  className="h-2 w-full rounded-full overflow-hidden"
                  style={{ backgroundColor: "var(--color-surface-2)" }}
                >
                  <div
                    className="h-full transition-all duration-300"
                    style={{
                      width: `${actions.exportStatus.progress}%`,
                      backgroundColor: "var(--color-accent)",
                    }}
                  />
                </div>
                <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                  Exportuji {actions.exportStatus.progress}% ({actions.exportStatus.currentChunk}/{actions.exportStatus.totalChunks} kapitol)
                </p>
                {actions.exportStatus.status === "done" && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium" style={{ color: "var(--color-success, #22c55e)" }}>
                      ✅ Hotovo!
                    </p>
                    {actions.exportStatus.outputPath && (
                      <button
                        type="button"
                        className="rounded-[var(--radius-sm)] border px-3 py-1 text-xs transition-colors"
                        style={{
                          borderColor: "var(--color-border-strong)",
                          color: "var(--color-text)",
                        }}
                        onClick={() => {
                          void invoke("open_path", { path: actions.exportStatus!.outputPath });
                        }}
                      >
                        Otevřít složku
                      </button>
                    )}
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>Spouštím export…</p>
            )}
          </div>
        ) : (
          /* ---- Export form ---- */
          <div className="space-y-4">
            <h3 className="font-[var(--font-display)] text-lg">📖 Export kroniky</h3>

            <label className="block text-xs" style={{ color: "var(--color-text-muted)" }}>
              Připojení
              <select
                className="mt-1 block w-full rounded-[var(--radius-sm)] border px-2 py-1 text-sm"
                style={selectStyle}
                value={actions.exportConnectionId}
                onChange={(e) => actions.setExportConnectionId(e.target.value)}
              >
                <option value="">-- vyberte --</option>
                {exportConnections.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>

            <label className="block text-xs" style={{ color: "var(--color-text-muted)" }}>
              Téma
              <select
                className="mt-1 block w-full rounded-[var(--radius-sm)] border px-2 py-1 text-sm"
                style={selectStyle}
                value={actions.exportTheme}
                onChange={(e) => actions.setExportTheme(e.target.value as ChronicleTheme)}
              >
                {THEMES.map((theme) => (
                  <option key={theme.key} value={theme.key}>{theme.label}</option>
                ))}
              </select>
            </label>

            <fieldset className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              <legend className="mb-1">Formát</legend>
              <label className="mr-4 inline-flex items-center gap-1">
                <input type="radio" name="exportFormat" value="html" checked={actions.exportFormat === "html"} onChange={() => actions.setExportFormat("html")} />
                HTML
              </label>
              <label className="inline-flex items-center gap-1">
                <input type="radio" name="exportFormat" value="pdf" checked={actions.exportFormat === "pdf"} onChange={() => actions.setExportFormat("pdf")} />
                PDF
              </label>
            </fieldset>

            <label className="flex items-center gap-2 text-xs" style={{ color: "var(--color-text-muted)" }}>
              <input type="checkbox" checked={actions.exportIllustrations} onChange={(e) => actions.setExportIllustrations(e.target.checked)} />
              Ilustrace
            </label>

            <button
              className="w-full rounded-[var(--radius-sm)] px-3 py-2 text-sm font-medium transition-colors"
              onClick={async () => {
                try {
                  const result: { jobId: string } = await invoke("start_export", {
                    chatId,
                    personaId: personaId ?? undefined,
                    connectionId: actions.exportConnectionId,
                    theme: actions.exportTheme,
                    format: actions.exportFormat,
                    includeIllustrations: actions.exportIllustrations,
                  });
                  actions.setExportJobId(result.jobId);
                  actions.setExportStatus(null);
                } catch (err) {
                  console.error("ChatScreen: chronicle export start failed for chat", chatId, err);
                }
              }}
              disabled={!actions.exportConnectionId}
              style={{
                backgroundColor: actions.exportConnectionId ? "var(--color-accent)" : "var(--color-surface-2)",
                color: actions.exportConnectionId ? "var(--color-accent-contrast)" : "var(--color-text-faint)",
              }}
            >
              Spustit export
            </button>
          </div>
        )}
      </div>
    </>
  );
}
