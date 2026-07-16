import { useTranslation } from "react-i18next";

import type { Character } from "../../db/repositories/charactersRepo";
import { avatarSrc } from "../characters/avatarSrc";

interface Props {
  members: Character[];
  selectedSpeakerId: string | null;
  predictedSpeakerId: string | null;
  autoReply: boolean;
  streaming: boolean;
  onSelect: (id: string) => void;
  onReplyNow: (id: string) => void;
}

/** Row of member avatar buttons between MessageList and ChatInput, shown
 * only for multi-member chats (plan §7). Manual mode: clicking picks the
 * next speaker. Auto mode: clicking triggers an immediate reply from that
 * member instead (the predicted next speaker is highlighted, not the
 * clicked one — auto mode ignores manual selection). */
export function SpeakerPicker({
  members,
  selectedSpeakerId,
  predictedSpeakerId,
  autoReply,
  streaming,
  onSelect,
  onReplyNow,
}: Props) {
  const { t } = useTranslation("chat");
  const highlightedId = autoReply ? predictedSpeakerId : selectedSpeakerId;

  return (
    <div
      className="flex items-center gap-3 overflow-x-auto border-t px-4 py-2 sm:px-8"
      style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-elevated)" }}
    >
      {members.map((member) => {
        const isHighlighted = member.id === highlightedId;
        return (
          <div key={member.id} className="flex shrink-0 flex-col items-center gap-0.5">
            <div className="relative">
              <button
                type="button"
                onClick={() => (autoReply ? onReplyNow(member.id) : onSelect(member.id))}
                title={member.name}
                className="flex h-10 w-10 items-center justify-center rounded-full border-2 object-cover transition-colors"
                style={{
                  borderColor: isHighlighted ? "var(--color-accent)" : "var(--color-border-strong)",
                  boxShadow: isHighlighted ? "0 0 0 2px var(--color-accent)" : undefined,
                }}
              >
                {avatarSrc(member.avatarPath) ? (
                  <img
                    src={avatarSrc(member.avatarPath)}
                    alt={member.name}
                    className="h-full w-full rounded-full object-cover"
                  />
                ) : (
                  <span
                    aria-hidden
                    className="flex h-full w-full items-center justify-center rounded-full text-sm font-medium"
                    style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text-muted)" }}
                  >
                    {(member.name || "?").trim().charAt(0).toUpperCase() || "?"}
                  </span>
                )}
              </button>
              {!autoReply && (
                <button
                  type="button"
                  onClick={() => onReplyNow(member.id)}
                  disabled={streaming}
                  title={t("group.replyNow") ?? ""}
                  className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full border text-[0.6rem] leading-none disabled:opacity-40"
                  style={{
                    borderColor: "var(--color-border-strong)",
                    backgroundColor: "var(--color-accent)",
                    color: "var(--color-accent-contrast)",
                  }}
                >
                  ▶
                </button>
              )}
            </div>
            <span className="max-w-[3.5rem] truncate text-[0.65rem]" style={{ color: "var(--color-text-faint)" }}>
              {member.name}
            </span>
          </div>
        );
      })}
    </div>
  );
}
