import { useTranslation } from "react-i18next";

import type { ChatUsageBucket } from "../../db/repositories/usageRepo";
import type { ConnectionConfig } from "../../providers/types";

interface BalanceInfo { currency: string; total_balance: string; granted_balance: string; topped_up_balance: string; }
interface UserBalance { is_available: boolean; balance_infos: BalanceInfo[]; }

interface ToggleButton {
  icon: string;
  open: boolean;
  onToggle: () => void;
  title: string;
}

/** Right chat-tools sidebar — mirrors the app's main Sidebar.tsx language. */
export function ChatToolsSidebar({
  panelToggles,
  actionToggles,
  connection,
  deepseekBalance,
  balanceError,
  chatUsage,
  contextUsage,
}: {
  panelToggles: ToggleButton[];
  actionToggles: ToggleButton[];
  connection: ConnectionConfig | undefined;
  deepseekBalance: UserBalance | null;
  balanceError: string | null;
  chatUsage: ChatUsageBucket | null;
  contextUsage: number;
}) {
  const { t } = useTranslation(["chat", "common", "memory"]);

  const balance = deepseekBalance?.balance_infos?.[0];
  const hasBalance = balance && !balanceError;
  // Token → cost estimate: DeepSeek V4-Flash $0.14/$0.28, V4-Pro $0.435/$0.87
  // Use the cheaper Flash pricing as a conservative floor.
  const inputCost = chatUsage ? chatUsage.inputTokens / 1_000_000 * 0.14 : 0;
  const outputCost = chatUsage ? chatUsage.outputTokens / 1_000_000 * 0.28 : 0;
  const estCost = inputCost + outputCost;

  return (
    <nav
      className="flex w-14 shrink-0 flex-col items-center gap-1 border-l p-2"
      style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-elevated)" }}
      aria-label={t("room.toolsSidebar")}
    >
      {panelToggles.map(({ icon, open, onToggle, title }) => (
        <button
          key={icon}
          type="button"
          onClick={onToggle}
          title={title}
          aria-pressed={open}
          className="flex w-full items-center justify-center rounded-[var(--radius-sm)] py-2 text-base transition-colors"
          style={{
            backgroundColor: open ? "var(--color-accent)" : "var(--color-surface)",
            color: open ? "var(--color-accent-contrast)" : "var(--color-text-muted)",
          }}
        >
          {icon}
        </button>
      ))}

      <div className="my-1 w-8 border-t" style={{ borderColor: "var(--color-border)" }} />

      {actionToggles.map(({ icon, open, onToggle, title }) => (
        <button
          key={icon}
          type="button"
          onClick={onToggle}
          title={title}
          aria-pressed={open}
          className="flex w-full items-center justify-center rounded-[var(--radius-sm)] py-2 text-base transition-colors"
          style={{
            backgroundColor: open ? "var(--color-accent)" : "var(--color-surface)",
            color: open ? "var(--color-accent-contrast)" : "var(--color-text-muted)",
          }}
        >
          {icon}
        </button>
      ))}

      {/* Balance + chat cost (above connection indicator) */}
      {connection && (
        <div
          className="mt-auto flex w-full flex-col items-center gap-1 px-1 pt-2 text-center"
          style={{ borderTop: "1px solid var(--color-border)" }}
        >
          {hasBalance ? (
            <div className="w-full text-[10px] leading-tight" title={balanceError ?? undefined}>
              <div style={{ color: "var(--color-text-muted)" }}>
                {balance.currency === "CNY" ? "¥" : "$"}{balance.total_balance}
              </div>
              <div className="text-[9px]" style={{ color: "var(--color-text-faint)" }}>
                {chatUsage ? `${chatUsage.requests}×` : "…"} ~${estCost.toFixed(3)}
              </div>
            </div>
          ) : balanceError ? (
            <div className="text-[9px] leading-tight" style={{ color: "var(--color-danger)" }} title={balanceError}>
              ⚠
            </div>
          ) : chatUsage ? (
            <div className="text-[10px] leading-tight" style={{ color: "var(--color-text-muted)" }}>
              {chatUsage.requests}×
            </div>
          ) : null}
        </div>
      )}

      <div className="flex flex-col items-center pt-2">
        <div
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-sm"
          style={{
            borderColor: connection ? "var(--color-success)" : "var(--color-danger)",
            backgroundColor: "var(--color-surface-2)",
          }}
          title={
            connection
              ? `${t("room.connectionLabel")} ${connection.name}\n${t("room.contextLabel")}: ${Math.round(contextUsage * 100)}%`
              : t("room.errors.noConnection")
          }
        >
          {connection ? "🔌" : "⚠️"}
        </div>
      </div>
    </nav>
  );
}
