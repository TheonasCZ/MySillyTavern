import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { query } from "../../db/database";
import { getUsageStats, type UsageStats } from "../../db/repositories/usageRepo";

interface DbSizeRow {
  size: number;
}

/** DB size in bytes via SQLite's page-count pragmas exposed as table-valued
 * functions — some SQLite builds/plugins don't expose these as functions,
 * so a failure here just hides the row rather than blocking the panel. */
async function getDbSizeBytes(): Promise<number | null> {
  try {
    const rows = await query<DbSizeRow>(
      "SELECT page_count * page_size AS size FROM pragma_page_count(), pragma_page_size()",
    );
    return rows[0]?.size ?? null;
  } catch {
    return null;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Usage/statistics panel (M12 §3): request counts + rough token totals per
 * period, so the user can see how much of a free-tier daily request quota
 * they've burned — the request count matters far more than token counts for
 * that limit, hence it's visually emphasized. */
export function UsagePanel() {
  const { t } = useTranslation("settings");
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [dbSize, setDbSize] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const load = () => {
    setLoading(true);
    void Promise.all([getUsageStats(), getDbSizeBytes()])
      .then(([s, size]) => {
        setStats(s);
        setDbSize(size);
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const rows: Array<{ label: string; bucket: UsageStats[keyof UsageStats] | null }> = [
    { label: t("usage.today"), bucket: stats?.today ?? null },
    { label: t("usage.week"), bucket: stats?.week ?? null },
    { label: t("usage.month"), bucket: stats?.month ?? null },
  ];

  return (
    <section
      className="rounded-[var(--radius-lg)] border p-5"
      style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-surface)" }}
    >
      <h2 className="mb-1 font-[var(--font-display)] text-lg">{t("sections.usage")}</h2>
      <p className="mb-4 text-sm" style={{ color: "var(--color-text-muted)" }}>
        {t("usage.subtitle")}
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr style={{ color: "var(--color-text-faint)" }}>
              <th className="pb-2 pr-4 font-normal"></th>
              <th className="pb-2 pr-4 font-normal">{t("usage.requests")}</th>
              <th className="pb-2 pr-4 font-normal">{t("usage.inputTokens")}</th>
              <th className="pb-2 font-normal">{t("usage.outputTokens")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.label} style={{ borderTop: i === 0 ? "none" : "1px solid var(--color-border)" }}>
                <td className="py-1.5 pr-4">{row.label}</td>
                <td
                  className="py-1.5 pr-4"
                  style={i === 0 ? { fontWeight: 600, color: "var(--color-accent)" } : undefined}
                >
                  {row.bucket?.requests ?? "…"}
                </td>
                <td className="py-1.5 pr-4">{row.bucket?.inputTokens ?? "…"}</td>
                <td className="py-1.5">{row.bucket?.outputTokens ?? "…"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs" style={{ color: "var(--color-text-faint)" }}>
        {t("usage.hint")}
      </p>

      {dbSize !== null && (
        <p className="mt-2 text-xs" style={{ color: "var(--color-text-faint)" }}>
          {t("usage.dbSize")}: {formatBytes(dbSize)}
        </p>
      )}

      <button
        type="button"
        onClick={load}
        disabled={loading}
        className="mt-3 rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
        style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text)" }}
      >
        {t("usage.refresh")}
      </button>
    </section>
  );
}
