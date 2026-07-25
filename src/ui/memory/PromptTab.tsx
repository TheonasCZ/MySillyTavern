import { useTranslation } from "react-i18next";

import { useChatStore } from "../../stores/chatStore";
import { PromptInspector } from "./PromptInspector";

export function PromptTab() {
  const { t } = useTranslation("memory");
  const report = useChatStore((s) => s.lastPromptReport);

  if (!report) {
    return (
      <p className="text-sm" style={{ color: "var(--color-text-faint)" }}>
        {t("prompt.empty")}
      </p>
    );
  }

  return <PromptInspector report={report} />;
}
