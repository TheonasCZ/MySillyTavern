import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { PromptReport } from "../../prompt/promptBuilder";

function CollapsibleSection({
  title,
  tokenCount,
  text,
  defaultOpen,
  variant,
}: {
  title: string;
  tokenCount: number;
  text: string;
  defaultOpen?: boolean;
  variant: "system" | "history" | "phi";
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);

  const borderColors: Record<string, string> = {
    system: "var(--color-accent)",
    history: "var(--color-brass)",
    phi: "var(--color-accent)",
  };

  return (
    <div
      className="rounded-[var(--radius-sm)] border"
      style={{ borderColor: borderColors[variant] }}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium"
        style={{ color: "var(--color-text)" }}
      >
        <span className="flex items-center gap-2">
          <span
            className="text-[0.65rem]"
            style={{ color: "var(--color-text-muted)" }}
          >
            {open ? "▼" : "▶"}
          </span>
          {title}
        </span>
        <span
          className="rounded-full px-2 py-0.5 text-xs"
          style={{
            backgroundColor: "var(--color-surface-2)",
            color: "var(--color-text-muted)",
          }}
        >
          {tokenCount} tok
        </span>
      </button>
      {open && (
        <div
          className="max-h-96 overflow-y-auto border-t px-3 py-2"
          style={{ borderColor: "var(--color-border)" }}
        >
          <pre
            className="whitespace-pre-wrap break-words text-xs leading-relaxed"
            style={{ color: "var(--color-text)" }}
          >
            {text || "(empty)"}
          </pre>
        </div>
      )}
    </div>
  );
}

export function PromptInspector({ report }: { report: PromptReport }) {
  const { t } = useTranslation("memory");
  const [copied, setCopied] = useState(false);

  const usagePct = Math.round(
    (report.estimatedTokens / Math.max(report.budget, 1)) * 100,
  );

  const fullText = [
    report.sections.systemText,
    report.sections.historyText,
    report.sections.phiText,
  ]
    .filter(Boolean)
    .join("\n\n");

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(fullText || "(empty)");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard may not be available (e.g. Tauri webview without permission)
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Token summary bar */}
      <div
        className="rounded-[var(--radius-sm)] border p-3 text-sm"
        style={{
          borderColor: report.overBudget
            ? "var(--color-danger)"
            : "var(--color-border)",
          backgroundColor: "var(--color-bg-elevated)",
        }}
      >
        <div className="flex items-center justify-between">
          <span style={{ color: "var(--color-text)" }}>
            {t("prompt.tokensLabel")}
          </span>
          <strong style={{ color: "var(--color-text)" }}>
            {report.estimatedTokens} / {report.budget}
            <span
              className="ml-1 font-normal"
              style={{ color: "var(--color-text-faint)" }}
            >
              ({usagePct}%)
            </span>
          </strong>
        </div>
        <div
          className="mt-2 h-2 w-full overflow-hidden rounded-full"
          style={{ backgroundColor: "var(--color-surface-2)" }}
          role="progressbar"
          aria-valuenow={Math.min(100, usagePct)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full transition-[width]"
            style={{
              width: `${Math.min(100, usagePct)}%`,
              backgroundColor: report.overBudget
                ? "var(--color-danger)"
                : "var(--color-success)",
            }}
          />
        </div>
        <div className="mt-1 flex items-center justify-between">
          <span
            className="text-xs"
            style={{
              color: report.overBudget
                ? "var(--color-danger)"
                : "var(--color-success)",
            }}
          >
            {report.overBudget
              ? t("prompt.overBudget")
              : t("prompt.underBudget")}
          </span>
          {report.overBudget && (
            <span
              className="rounded-full px-2 py-0.5 text-[0.65rem] font-bold uppercase"
              style={{
                backgroundColor: "var(--color-danger)",
                color: "var(--color-accent-contrast)",
              }}
            >
              !
            </span>
          )}
        </div>
        {report.overBudget && (
          <p
            className="mt-1 text-xs"
            style={{ color: "var(--color-text-muted)" }}
          >
            {t("prompt.overBudgetHint")}
          </p>
        )}
      </div>

      {/* Copy button */}
      <button
        type="button"
        onClick={() => void handleCopy()}
        className="self-start rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium transition-colors"
        style={{
          backgroundColor: copied
            ? "var(--color-success)"
            : "var(--color-surface-2)",
          color: copied
            ? "var(--color-accent-contrast)"
            : "var(--color-text)",
        }}
      >
        {copied ? t("prompt.copied") : t("prompt.copyAsText")}
      </button>

      {/* Collapsible sections */}
      <CollapsibleSection
        title={t("prompt.systemText")}
        tokenCount={report.sections.systemTokens}
        text={report.sections.systemText}
        variant="system"
        defaultOpen
      />
      <CollapsibleSection
        title={t("prompt.historyText")}
        tokenCount={report.sections.historyTokens}
        text={report.sections.historyText}
        variant="history"
      />
      <CollapsibleSection
        title={t("prompt.phiText")}
        tokenCount={report.sections.canonReminderTokens}
        text={report.sections.phiText}
        variant="phi"
      />

      {/* Trimmed notes */}
      <div>
        <h3
          className="mb-2 text-xs font-medium uppercase tracking-wide"
          style={{ color: "var(--color-text-faint)" }}
        >
          {t("prompt.trimmedTitle")}
        </h3>
        {report.trimmedNotes.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>
            {t("prompt.noneTrimmed")}
          </p>
        ) : (
          <ul
            className="flex flex-col gap-1 text-xs"
            style={{ color: "var(--color-text-muted)" }}
          >
            {report.trimmedNotes.map((note, i) => (
              <li key={i}>• {note}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
