import { useState } from "react";
import type { KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

interface Props {
  disabled: boolean;
  streaming: boolean;
  onSend: (content: string) => void;
  onStop: () => void;
  suggestions: string[] | null;
  suggesting: boolean;
  onSuggest: () => void;
  onClearSuggestions: () => void;
}

export function ChatInput({
  disabled,
  streaming,
  onSend,
  onStop,
  suggestions,
  suggesting,
  onSuggest,
  onClearSuggestions,
}: Props) {
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
      className="flex flex-col gap-2 border-t px-4 py-3 sm:px-8"
      style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-elevated)" }}
    >
      {suggestions && suggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setValue(s);
                onClearSuggestions();
              }}
              className="max-w-full rounded-[var(--radius-md)] border px-3 py-1.5 text-left text-xs"
              style={{
                borderColor: "var(--color-border-strong)",
                backgroundColor: "var(--color-surface-2)",
                color: "var(--color-text)",
              }}
            >
              {s}
            </button>
          ))}
          <button
            type="button"
            onClick={onClearSuggestions}
            className="text-xs"
            style={{ color: "var(--color-text-faint)" }}
          >
            {t("room.suggest.dismiss")}
          </button>
        </div>
      )}
      <div className="flex items-end gap-2">
      <button
        type="button"
        onClick={onSuggest}
        disabled={disabled || streaming || suggesting}
        title={t("room.suggest.tooltip") ?? ""}
        className="shrink-0 rounded-[var(--radius-md)] border px-3 py-2 text-sm disabled:opacity-50"
        style={{
          borderColor: "var(--color-border-strong)",
          backgroundColor: "var(--color-surface-2)",
          color: "var(--color-text-muted)",
        }}
      >
        {suggesting ? t("room.suggest.loading") : t("room.suggest.button")}
      </button>
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
    </div>
  );
}
