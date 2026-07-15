import { useState } from "react";
import type { KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

interface Props {
  disabled: boolean;
  streaming: boolean;
  onSend: (content: string) => void;
  onStop: () => void;
}

export function ChatInput({ disabled, streaming, onSend, onStop }: Props) {
  const { t } = useTranslation("chat");
  const [value, setValue] = useState("");

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div
      className="flex items-end gap-2 border-t px-4 py-3 sm:px-8"
      style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-elevated)" }}
    >
      <textarea
        className="min-h-[2.5rem] max-h-40 flex-1 resize-none rounded-[var(--radius-md)] border px-3 py-2 text-sm"
        style={{
          backgroundColor: "var(--color-surface-2)",
          borderColor: "var(--color-border-strong)",
          color: "var(--color-text)",
        }}
        placeholder={t("room.inputPlaceholder") ?? ""}
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={1}
      />
      {streaming ? (
        <button
          type="button"
          onClick={onStop}
          className="shrink-0 rounded-[var(--radius-md)] px-4 py-2 text-sm font-medium"
          style={{ backgroundColor: "var(--color-danger)", color: "var(--color-accent-contrast)" }}
        >
          {t("room.stop")}
        </button>
      ) : (
        <button
          type="button"
          onClick={submit}
          disabled={disabled || !value.trim()}
          className="shrink-0 rounded-[var(--radius-md)] px-4 py-2 text-sm font-medium disabled:opacity-50"
          style={{ backgroundColor: "var(--color-accent)", color: "var(--color-accent-contrast)" }}
        >
          {t("room.send")}
        </button>
      )}
    </div>
  );
}
