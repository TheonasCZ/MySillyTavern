import { execute, newId, nowIso, query } from "../database";

export type UsageKind = "chat" | "suggest" | "memory" | "embedding";

/** Records one API call's estimated token cost (M12 §3). Fire-and-forget by
 * design — callers should `.catch(() => {})` this so a logging hiccup never
 * breaks the chat. */
export async function logUsage(
  kind: UsageKind,
  connectionId: string | null,
  inputTokensEst: number,
  outputTokensEst: number,
): Promise<void> {
  await execute(
    `INSERT INTO usage_log (id, created_at, kind, connection_id, input_tokens_est, output_tokens_est)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [newId(), nowIso(), kind, connectionId, Math.round(inputTokensEst), Math.round(outputTokensEst)],
  );
}

export interface UsageBucket {
  requests: number;
  inputTokens: number;
  outputTokens: number;
}

export interface UsageStats {
  today: UsageBucket;
  week: UsageBucket;
  month: UsageBucket;
}

interface BucketRow {
  requests: number;
  input_tokens: number | null;
  output_tokens: number | null;
}

const EMPTY_BUCKET: UsageBucket = { requests: 0, inputTokens: 0, outputTokens: 0 };

function toBucket(row: BucketRow | undefined): UsageBucket {
  if (!row) return EMPTY_BUCKET;
  return {
    requests: row.requests,
    inputTokens: row.input_tokens ?? 0,
    outputTokens: row.output_tokens ?? 0,
  };
}

/** Aggregates request counts + token totals over today/7 days/30 days, one
 * query per bucket (three total — cheap at this scale, and simpler than a
 * single GROUP-BY-bucket query). "Today" is local-midnight cutoff based on
 * the ISO timestamp's date portion. */
export async function getUsageStats(): Promise<UsageStats> {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const monthStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const sql = `SELECT COUNT(*) AS requests,
                      SUM(input_tokens_est) AS input_tokens,
                      SUM(output_tokens_est) AS output_tokens
               FROM usage_log WHERE created_at >= $1`;

  const [todayRows, weekRows, monthRows] = await Promise.all([
    query<BucketRow>(sql, [todayStart]),
    query<BucketRow>(sql, [weekStart]),
    query<BucketRow>(sql, [monthStart]),
  ]);

  return {
    today: toBucket(todayRows[0]),
    week: toBucket(weekRows[0]),
    month: toBucket(monthRows[0]),
  };
}
