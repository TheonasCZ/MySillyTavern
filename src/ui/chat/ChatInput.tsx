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
  /** Scopes the auto-saved draft to this chat, so an unsent draft never
   *  leaks into a different (or newly created) chat. */
  chatId: string;
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
  /** Rendered before the textarea — the persona avatar/switcher, so it's
   *  visually clear who is writing. Owned by the caller (ChatScreen) since
   *  it needs the personas list + setPersona, not ChatInput's concern. */
  personaSlot?: React.ReactNode;
}

export function ChatInput({
  chatId,
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
  personaSlot,
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

  // Auto-save draft — per chat, so switching chats doesn't leak an unsent
  // draft from one chat into another (or into a freshly created one).
  const draftKey = `chat_draft_${chatId}`;
  useEffect(() => {
    // Always overwrite, even to "" — otherwise a leftover draft from the
    // previous chat stays visible (and could get sent) in a chat that has
    // no saved draft of its own.
    setValue(localStorage.getItem(draftKey) ?? "");
  }, [draftKey]);

  const handleChange = (val: string) => {
    setValue(val);
    localStorage.setItem(draftKey, val);
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
    <div className="flex flex-col gap-2 py-3">
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
      <div className="flex items-center gap-2">
      {personaSlot}
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
      {/* Extra gap so the suggest button isn't mistaken for / misclicked
          into Send — a deliberate spacer, not just the row's own gap-2. */}
      <div className="w-2 shrink-0" aria-hidden />
      {streaming ? (
        <button
          type="button"
          onClick={onStop}
          title={t("room.stop") ?? ""}
          className="shrink-0 rounded-[var(--radius-md)] border px-2.5 py-2 text-base"
          style={{ borderColor: "var(--color-danger)", backgroundColor: "var(--color-danger)", color: "var(--color-accent-contrast)" }}
        >
          ⏹
        </button>
      ) : (
        <button
          type="button"
          onClick={submit}
          disabled={disabled || !value.trim()}
          title={t("room.send") ?? ""}
          className="shrink-0 rounded-[var(--radius-md)] border px-2.5 py-2 text-base disabled:opacity-50"
          style={{ borderColor: "var(--color-accent)", backgroundColor: "var(--color-accent)", color: "var(--color-accent-contrast)" }}
        >
          ➤
        </button>
      )}
      </div>
    </div>
  );
}
