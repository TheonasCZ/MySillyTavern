import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";

import { isDiceCommand, extractDiceExpression } from "../../chat/diceCommand";
import { stripEmphasis } from "../../chat/inlineSuggestions";

const chipMarkdownComponents = {
  em: (props: React.HTMLAttributes<HTMLElement>) => (
    <em style={{ color: "var(--color-brass)", fontStyle: "italic" }} {...props} />
  ),
  p: (props: React.HTMLAttributes<HTMLParagraphElement>) => <p className="inline" {...props} />,
};

interface Props {
  disabled: boolean;
  streaming: boolean;
  onSend: (content: string) => void;
  onDiceRoll?: (expression: string) => void;
  onStop: () => void;
  suggestions: string[] | null;
  suggesting: boolean;
  /** Hidden when the last reply already carries its own inline options —
   * the extra LLM call would be redundant. */
  showSuggestButton?: boolean;
  onSuggest: () => void;
  onClearSuggestions: () => void;
  /** 0.0–1.0 fill ratio of the context budget. Green < 0.5, yellow < 0.8, red >= 0.8. */
  contextUsage?: number;
}

export function ChatInput({
  disabled,
  streaming,
  onSend,
  onDiceRoll,
  onStop,
  suggestions,
  suggesting,
  showSuggestButton = true,
  onSuggest,
  onClearSuggestions,
  contextUsage,
}: Props) {
  const { t } = useTranslation("chat");
  const [value, setValue] = useState("");
  const [diceFlash, setDiceFlash] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const historyRef = useRef<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const draftBeforeHistoryRef = useRef("");

  // --- Android soft keyboard / viewport handling ---
  // On mobile, the soft keyboard pushes the visual viewport up. We adjust
  // the input bar's bottom padding so it stays above the keyboard.
  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;

    const handleViewportResize = () => {
      const vv = window.visualViewport!;
      const keyboardHeight = window.innerHeight - vv.height;
      // Apply the keyboard offset as padding-bottom on the root scroll container
      // so content isn't hidden behind the keyboard.
      const root = document.getElementById("root");
      if (root) {
        root.style.paddingBottom = `${keyboardHeight}px`;
      }
    };

    window.visualViewport.addEventListener("resize", handleViewportResize);
    window.visualViewport.addEventListener("scroll", handleViewportResize);

    return () => {
      window.visualViewport!.removeEventListener("resize", handleViewportResize);
      window.visualViewport!.removeEventListener("scroll", handleViewportResize);
      const root = document.getElementById("root");
      if (root) root.style.paddingBottom = "";
    };
  }, []);

  // Auto-save draft — restore on mount, save on change
  const draftKey = "chat_draft";
  useEffect(() => {
    if (draftKey) {
      const saved = localStorage.getItem(draftKey);
      if (saved) setValue(saved);
    }
  }, [draftKey]);

  const handleChange = (val: string) => {
    setValue(val);
    if (draftKey) localStorage.setItem(draftKey, val);
  };

  // Expose insertText via a global callback — InventoryPanel calls this
  // to insert item names into the input without a complex prop chain.
  if (typeof window !== "undefined") {
    (window as unknown as Record<string, unknown>).__mstInsertPrompt = (text: string) => {
      setValue((prev) => (prev ? `${prev} ${text}` : text));
      textareaRef.current?.focus();
    };
  }

  const submit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;

    if (isDiceCommand(trimmed) && onDiceRoll) {
      const expression = extractDiceExpression(trimmed);
      if (expression) {
        onDiceRoll(expression);
        // Save to history
        historyRef.current = [trimmed, ...historyRef.current.slice(0, 50)];
        setHistoryIndex(-1);
        setValue("");
        localStorage.removeItem(draftKey);
        setDiceFlash(true);
        setTimeout(() => setDiceFlash(false), 300);
        return;
      }
    }

    onSend(trimmed);
    // Save to history (max 50 entries)
    historyRef.current = [trimmed, ...historyRef.current.slice(0, 49)];
    setHistoryIndex(-1);
    setValue("");
    localStorage.removeItem(draftKey);
  }, [value, disabled, onSend, onDiceRoll]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter or Ctrl+Enter sends
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }

    // PageUp: previous message from history
    if (e.key === "PageUp") {
      e.preventDefault();
      const history = historyRef.current;
      if (history.length === 0) return;
      if (historyIndex === -1) {
        draftBeforeHistoryRef.current = value;
      }
      const nextIdx = Math.min(historyIndex + 1, history.length - 1);
      setHistoryIndex(nextIdx);
      setValue(history[nextIdx]);
    }

    // PageDown: next message from history
    if (e.key === "PageDown") {
      e.preventDefault();
      const history = historyRef.current;
      if (historyIndex <= 0) {
        setHistoryIndex(-1);
        setValue(draftBeforeHistoryRef.current);
        return;
      }
      const nextIdx = historyIndex - 1;
      setHistoryIndex(nextIdx);
      setValue(history[nextIdx]);
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
                setValue(stripEmphasis(s));
                onClearSuggestions();
              }}
              className="max-w-full rounded-[var(--radius-md)] border px-3 py-1.5 text-left text-xs"
              style={{
                borderColor: "var(--color-border-strong)",
                backgroundColor: "var(--color-surface-2)",
                color: "var(--color-text)",
              }}
            >
              <ReactMarkdown components={chipMarkdownComponents}>{s}</ReactMarkdown>
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
      {/* Context bar — shows how full the prompt window is */}
      {contextUsage !== undefined && (
        <div className="flex items-center gap-2 text-[11px]" style={{ color: "var(--color-text-faint)" }}>
          <div className="h-1 flex-1 rounded-full overflow-hidden" style={{ backgroundColor: "var(--color-surface-2)" }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.min(contextUsage * 100, 100)}%`,
                backgroundColor: contextUsage > 0.8 ? "var(--color-danger)" : contextUsage > 0.5 ? "var(--color-brass)" : "var(--color-success)",
              }}
            />
          </div>
          <span>{Math.round(contextUsage * 100)}%</span>
        </div>
      )}

      <div className="flex items-end gap-2">
      {showSuggestButton && (
      <button
        type="button"
        onClick={onSuggest}
        disabled={disabled || streaming || suggesting}
        title={suggesting ? t("room.suggest.loading") : t("room.suggest.tooltip") ?? ""}
        className="shrink-0 rounded-[var(--radius-md)] border px-2.5 py-2 text-base disabled:opacity-50"
        style={{
          borderColor: "var(--color-border-strong)",
          backgroundColor: "var(--color-surface-2)",
          color: "var(--color-text-muted)",
        }}
      >
        {suggesting ? "⏳" : "💡"}
      </button>
      )}
      <textarea
        ref={textareaRef}
        className="min-h-[2.5rem] max-h-40 flex-1 resize-none rounded-[var(--radius-md)] border px-3 py-2 text-sm transition-colors duration-150"
        style={{
          backgroundColor: diceFlash ? "var(--color-accent)" : "var(--color-surface-2)",
          borderColor: diceFlash ? "var(--color-brass)" : "var(--color-border-strong)",
          color: "var(--color-text)",
        }}
        placeholder={t("room.inputPlaceholder") ?? ""}
        value={value}
        disabled={disabled}
        onChange={(e) => handleChange(e.target.value)}
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
