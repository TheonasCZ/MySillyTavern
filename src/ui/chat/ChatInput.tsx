import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";

import { invoke } from "@tauri-apps/api/core";

import { isDiceCommand, extractDiceExpression } from "../../chat/diceCommand";
import { stripEmphasis } from "../../chat/inlineSuggestions";
import type { SkillEntry } from "../../db/repositories/personasRepo";

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
  /** Chat-scoped skills — matched against `pendingCheckSkill` to auto-add a
   *  bonus to the quick roll (see `rollQuickDice`). */
  skills?: SkillEntry[];
  /** The skill named by the GM's last [CHECK:skill name] tag, decided by
   *  the model itself from full scene context — not derived from local text
   *  matching, which is too easy to fool (the player's own draft is
   *  editable, and naive substring matching false-positives on unrelated
   *  words, e.g. "mech" the plant matching inside "Mechanika"). Null when
   *  the GM didn't name one (or it was already spent on a prior roll). */
  pendingCheckSkill?: string | null;
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
  skills = [],
  pendingCheckSkill = null,
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
  /** A roll made via the 🎲 quick-roll button, held here (not yet a chat
   *  message) until the next send — one roll per message, no re-rolling
   *  until it's actually used, and it's silently discarded on chat switch
   *  (see the draftKey effect above). Distinct from the free-form `/r`
   *  command below, which still posts its own immediate system message.
   *  `bonus`/`skillName` come from the GM's own [CHECK:...] tag via
   *  `pendingCheckSkill` (see `rollQuickDice`) — not a manual picker and not
   *  the player's own draft, so there's nothing for the player to edit to
   *  cherry-pick their best skill regardless of the situation. */
  const [pendingRoll, setPendingRoll] = useState<{
    expression: string;
    total: number;
    base: number;
    bonus: number;
    skillName?: string;
  } | null>(null);
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
    setPendingRoll(null);
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
    if (disabled || (!trimmed && !pendingRoll)) return;

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

    // A quick-roll (🎲 button) attaches as a trailing [ROLL:expr=total] tag
    // on the message it's sent with — the model's contract for reading it
    // is in TWO_ROLES_INSTRUCTIONS (RISK AND COST). Once attached, the roll
    // is spent: it can't be re-rolled or reused for a later message.
    const content = pendingRoll
      ? `${trimmed}${trimmed ? "\n\n" : ""}[ROLL:${pendingRoll.expression}=${pendingRoll.total}]`
      : trimmed;
    onSend(content);
    setPendingRoll(null);
    // Save to history (max 50 entries) — the roll tag is deliberately not
    // stored in the recall history, only the text the player actually typed.
    if (trimmed) historyRef.current = [trimmed, ...historyRef.current.slice(0, 49)];
    setHistoryIndex(-1);
    setValue("");
    localStorage.removeItem(draftKey);
  }, [value, disabled, onSend, onDiceRoll, pendingRoll]);

  /** Quick-roll button — rolls once and holds the result here (badge on the
   *  button) until the player actually sends a message; see `submit()`.
   *  Locked while a roll is pending so it can't be re-rolled away.
   *
   *  The skill bonus comes from `pendingCheckSkill` — the GM's own
   *  [CHECK:skill name] tag, matched exactly (case-insensitive) against the
   *  player's current skills. Deliberately not derived from any local text
   *  (the player's draft is editable and easy to game; naive substring
   *  matching on prose also false-positives on unrelated words). If the GM
   *  didn't name a skill, or named one the player doesn't have, the roll is
   *  plain — there's no bonus to find. */
  const rollQuickDice = useCallback(async () => {
    if (pendingRoll) return;
    const matched = pendingCheckSkill
      ? skills.find((s) => s.name.trim().toLowerCase() === pendingCheckSkill.trim().toLowerCase())
      : undefined;
    const bonus = matched?.level ?? 0;
    const expression = bonus !== 0 ? `1d20+${bonus}` : "1d20";
    try {
      const result: string = await invoke("eval_dice", { expression: "1d20" });
      const base = parseInt(result.slice(result.lastIndexOf("=") + 1).trim(), 10);
      const safeBase = Number.isNaN(base) ? 0 : base;
      setPendingRoll({ expression, total: safeBase + bonus, base: safeBase, bonus, skillName: matched?.name });
    } catch (err) {
      console.error("Dice roll failed:", err);
    }
  }, [pendingRoll, pendingCheckSkill, skills]);

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
      {onDiceRoll && (
      <button
        type="button"
        onClick={() => void rollQuickDice()}
        disabled={disabled}
        title={
          pendingRoll
            ? (pendingRoll.bonus !== 0
                ? t("room.rollDicePendingWithBonus", { base: pendingRoll.base, bonus: pendingRoll.bonus, skill: pendingRoll.skillName, total: pendingRoll.total })
                : t("room.rollDicePending", { total: pendingRoll.total })) ?? ""
            : t("room.rollDice") ?? ""
        }
        className="relative shrink-0 rounded-[var(--radius-md)] border px-2.5 py-2 text-base disabled:opacity-50"
        style={{
          borderColor: pendingRoll ? "var(--color-brass)" : "var(--color-border-strong)",
          backgroundColor: "var(--color-surface-2)",
          color: "var(--color-text-muted)",
        }}
      >
        🎲
        {pendingRoll && (
          <span
            className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center whitespace-nowrap rounded-full px-1 text-xs font-bold"
            style={{ backgroundColor: "var(--color-brass)", color: "var(--color-accent-contrast)" }}
          >
            {pendingRoll.bonus !== 0 ? `${pendingRoll.base} +${pendingRoll.bonus}` : pendingRoll.total}
          </span>
        )}
      </button>
      )}
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
          disabled={disabled || (!value.trim() && !pendingRoll)}
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
