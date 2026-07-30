import { useState } from "react";
import { useTranslation } from "react-i18next";

import { EmbeddingConnectionPicker } from "./EmbeddingConnectionPicker";
import { ExtractionConnectionPicker } from "./ExtractionConnectionPicker";
import { FactsTab } from "./FactsTab";
import { SummaryTab } from "./SummaryTab";
import { ChronicleTab } from "./ChronicleTab";
import { SearchTab } from "./SearchTab";
import { PromptTab } from "./PromptTab";
import type { Tab } from "./constants";

export function MemoryPanel({
  chatId,
  onClose,
  onJumpToMessage,
}: {
  chatId: string;
  onClose: () => void;
  /** Chronicle tab: navigate the chat to this message (closes the panel). */
  onJumpToMessage?: (messageId: string) => void;
}) {
  const { t } = useTranslation("memory");
  const [tab, setTab] = useState<Tab>("facts");

  const tabs: { key: Tab; label: string }[] = [
    { key: "facts", label: t("tabs.facts") },
    { key: "summary", label: t("tabs.summary") },
    { key: "chronicle", label: t("tabs.chronicle") },
    { key: "search", label: t("tabs.search") },
    { key: "prompt", label: t("tabs.prompt") },
  ];

  return (
    <div
      className="flex h-full flex-col"
      style={{ backgroundColor: "var(--color-bg-elevated)", boxShadow: "var(--shadow-panel)" }}
    >
      <div
        className="flex items-center justify-between gap-2 border-b px-4 py-3"
        style={{ borderColor: "var(--color-border)" }}
      >
        <h2 className="font-[var(--font-display)] text-base">{t("title")}</h2>
        <button
          type="button"
          onClick={onClose}
          className="text-sm"
          style={{ color: "var(--color-text-muted)" }}
        >
          {t("close")}
        </button>
      </div>

      <div className="flex flex-wrap gap-4 border-b px-4 py-2" style={{ borderColor: "var(--color-border)" }}>
        <ExtractionConnectionPicker chatId={chatId} />
        <EmbeddingConnectionPicker chatId={chatId} />
      </div>

      <div
        className="flex gap-1 border-b px-4 py-2"
        style={{ borderColor: "var(--color-border)" }}
      >
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            aria-pressed={tab === key}
            className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm transition-colors"
            style={{
              backgroundColor: tab === key ? "var(--color-accent)" : "transparent",
              color: tab === key ? "var(--color-accent-contrast)" : "var(--color-text-muted)",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {tab === "facts" && <FactsTab chatId={chatId} />}
        {tab === "summary" && <SummaryTab chatId={chatId} />}
        {tab === "chronicle" && <ChronicleTab chatId={chatId} onJumpToMessage={onJumpToMessage} />}
        {tab === "search" && <SearchTab chatId={chatId} />}
        {tab === "prompt" && <PromptTab />}
      </div>
    </div>
  );
}
