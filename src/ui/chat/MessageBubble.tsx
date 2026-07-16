import { useState } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { Message } from "../../db/repositories/messagesRepo";

const markdownComponents = {
  em: (props: React.HTMLAttributes<HTMLElement>) => (
    <em style={{ color: "var(--color-brass)", fontStyle: "italic" }} {...props} />
  ),
  p: (props: React.HTMLAttributes<HTMLParagraphElement>) => (
    <p className="whitespace-pre-wrap [&:not(:last-child)]:mb-2" {...props} />
  ),
};

interface Props {
  message: Message;
  content: string;
  isStreaming: boolean;
  isUser: boolean;
  canEdit: boolean;
  canRegenerate: boolean;
  /** Message content is a partial response (stream stopped/errored before
   * completion) — shows a badge plus a "continue" action alongside
   * regenerate (plan §9). */
  isInterrupted?: boolean;
  /** Avatar image URL of the message author (character or persona);
   * falls back to an initial-letter circle when missing. */
  avatarUrl?: string;
  /** Author display name — used for the avatar fallback/alt text. */
  authorName?: string;
  /** Shows `authorName` as a small caption above the bubble content — group
   * chats only, so it's clear which member is speaking (plan §7). */
  showAuthorCaption?: boolean;
  /** Shown when set and not streaming — forks the story at this message. */
  onBranch?: () => void;
  onEdit: (content: string) => void;
  onRegenerate: () => void;
  onContinue?: () => void;
  onSwipe: (offset: number) => void;
}

function Avatar({ url, name, isUser }: { url?: string; name?: string; isUser: boolean }) {
  const initial = (name ?? "?").trim().charAt(0).toUpperCase() || "?";
  return url ? (
    <img
      src={url}
      alt={name ?? ""}
      title={name}
      className="h-9 w-9 shrink-0 rounded-full border object-cover"
      style={{ borderColor: "var(--color-border-strong)" }}
    />
  ) : (
    <span
      title={name}
      aria-hidden
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm font-medium"
      style={{
        borderColor: "var(--color-border-strong)",
        backgroundColor: isUser ? "var(--color-accent)" : "var(--color-surface-2)",
        color: isUser ? "var(--color-accent-contrast)" : "var(--color-text-muted)",
      }}
    >
      {initial}
    </span>
  );
}

export function MessageBubble({
  message,
  content,
  isStreaming,
  isUser,
  canEdit,
  canRegenerate,
  isInterrupted = false,
  avatarUrl,
  authorName,
  showAuthorCaption = false,
  onBranch,
  onEdit,
  onRegenerate,
  onContinue,
  onSwipe,
}: Props) {
  const { t } = useTranslation("chat");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content);

  const startEdit = () => {
    setDraft(content);
    setEditing(true);
  };

  const commitEdit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== content) onEdit(trimmed);
  };

  const swipeCount = message.swipes.length;
  const showSwipeControls = !isUser && swipeCount > 1 && !isStreaming;

  return (
    <div className={`flex w-full items-end gap-2 ${isUser ? "flex-row-reverse" : ""}`}>
      <Avatar url={avatarUrl} name={authorName} isUser={isUser} />
      <div
        className="flex max-w-[75%] flex-col gap-1.5 rounded-[var(--radius-lg)] border px-4 py-3"
        style={{
          borderColor: isUser ? "var(--color-accent)" : "var(--color-border)",
          backgroundColor: isUser ? "var(--color-surface-2)" : "var(--color-surface)",
          boxShadow: "var(--shadow-panel)",
        }}
      >
        {showAuthorCaption && authorName && !editing && (
          <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
            {authorName}
          </span>
        )}
        {isInterrupted && !editing && !isStreaming && (
          <span
            className="self-start rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[0.65rem] font-medium uppercase tracking-wide"
            style={{ backgroundColor: "var(--color-warning)", color: "var(--color-accent-contrast)" }}
          >
            {t("room.interrupted")}
          </span>
        )}
        {editing ? (
          <div className="flex flex-col gap-2">
            <textarea
              autoFocus
              className="min-h-[4rem] resize-y rounded-[var(--radius-sm)] border px-2 py-1.5 text-sm"
              style={{
                backgroundColor: "var(--color-bg-elevated)",
                borderColor: "var(--color-border-strong)",
                color: "var(--color-text)",
              }}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={commitEdit}
                className="rounded-[var(--radius-sm)] px-2.5 py-1 text-xs font-medium"
                style={{ backgroundColor: "var(--color-accent)", color: "var(--color-accent-contrast)" }}
              >
                {t("room.save")}
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded-[var(--radius-sm)] px-2.5 py-1 text-xs"
                style={{ color: "var(--color-text-muted)" }}
              >
                {t("room.cancel")}
              </button>
            </div>
          </div>
        ) : (
          <div className="text-sm leading-relaxed" style={{ color: "var(--color-text)" }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {content || " "}
            </ReactMarkdown>
            {isStreaming && (
              <span
                aria-hidden
                className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse align-middle"
                style={{ backgroundColor: "var(--color-accent)" }}
              />
            )}
          </div>
        )}

        {!editing && !isStreaming && (
          <div className="flex items-center gap-2 text-xs" style={{ color: "var(--color-text-faint)" }}>
            {canEdit && (
              <button type="button" onClick={startEdit} className="hover:opacity-80">
                {t("room.edit")}
              </button>
            )}
            {canRegenerate && isInterrupted && onContinue && (
              <button type="button" onClick={onContinue} className="hover:opacity-80">
                {t("room.continue")}
              </button>
            )}
            {canRegenerate && (
              <button type="button" onClick={onRegenerate} className="hover:opacity-80">
                {t("room.regenerate")}
              </button>
            )}
            {onBranch && (
              <button
                type="button"
                onClick={onBranch}
                title={t("room.branchHint") ?? ""}
                className="hover:opacity-80"
              >
                {t("room.branch")}
              </button>
            )}
            {showSwipeControls && (
              <span className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onSwipe(-1)}
                  disabled={message.activeSwipe === 0}
                  className="disabled:opacity-30"
                  aria-label={t("room.previousSwipe") ?? undefined}
                >
                  ‹
                </button>
                <span>{t("room.swipeOf", { current: message.activeSwipe + 1, total: swipeCount })}</span>
                <button
                  type="button"
                  onClick={() => onSwipe(1)}
                  disabled={message.activeSwipe === swipeCount - 1}
                  className="disabled:opacity-30"
                  aria-label={t("room.nextSwipe") ?? undefined}
                >
                  ›
                </button>
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
