import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import { getUsageForChat, type ChatUsageBucket } from "../../db/repositories/usageRepo";
import type { ConnectionConfig } from "../../providers/types";

interface BalanceInfo { currency: string; total_balance: string; granted_balance: string; topped_up_balance: string; }
interface UserBalance { is_available: boolean; balance_infos: BalanceInfo[]; }

/** DeepSeek account balance + per-chat token usage, shown in the tools
 * sidebar's cost widget. Balance is only fetched for DeepSeek connections
 * (openai-shaped provider with a deepseek baseUrl); other providers just
 * get `null`. */
export function useDeepseekBalance(id: string | undefined, connection: ConnectionConfig | undefined) {
  const [deepseekBalance, setDeepseekBalance] = useState<UserBalance | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [chatUsage, setChatUsage] = useState<ChatUsageBucket | null>(null);

  // Load per-chat token usage
  useEffect(() => {
    if (!id) return;
    void getUsageForChat(id).then(setChatUsage).catch(() => setChatUsage(null));
  }, [id]);

  // Load DeepSeek balance if the connection is for DeepSeek
  const loadBalance = useCallback(() => {
    if (!connection || connection.provider !== "openai" || !connection.baseUrl?.includes("deepseek")) {
      setDeepseekBalance(null);
      setBalanceError(null);
      return;
    }
    void invoke<UserBalance>("get_user_balance", {
      connectionId: connection.id,
      baseUrl: connection.baseUrl,
    })
      .then((b) => { setDeepseekBalance(b); setBalanceError(null); })
      .catch((e: unknown) => { setBalanceError(String(e)); setDeepseekBalance(null); });
  }, [connection]);

  useEffect(() => { loadBalance(); }, [loadBalance]);

  return { deepseekBalance, balanceError, chatUsage };
}
