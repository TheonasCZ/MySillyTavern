import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import type { Character } from "../../db/repositories/charactersRepo";
import type { ChatMember } from "../../db/repositories/chatMembersRepo";
import type { Chat } from "../../db/repositories/chatsRepo";
import type { ConnectionConfig } from "../../providers/types";
import {
  formatTimeHHMM,
  monthDisplayName,
  seasonIcon,
  weatherIcon,
  type CalendarDate,
  type CalendarMode,
} from "../../memory/calendar";
import { GroupMembersPopover } from "./GroupMembersPopover";
import type { MemberInfo } from "./MessageList";

export function ChatHeader({
  chat,
  chatId,
  calendarDate,
  calendarMode,
  weather,
  fallbackCharacter,
  groupOpen,
  onToggleGroup,
  onCloseGroup,
  members,
  memberCharacters,
  allCharacters,
  autoReply,
  promotionConnection,
  onAddMember,
  onRemoveMember,
  onSetAutoReply,
}: {
  chat: Chat | null;
  chatId: string;
  calendarDate: CalendarDate | null;
  calendarMode: CalendarMode;
  weather: string;
  fallbackCharacter: MemberInfo | null;
  groupOpen: boolean;
  onToggleGroup: () => void;
  onCloseGroup: () => void;
  members: ChatMember[];
  memberCharacters: Character[];
  allCharacters: Character[];
  autoReply: boolean;
  promotionConnection: ConnectionConfig | null;
  onAddMember: (characterId: string) => Promise<void>;
  onRemoveMember: (characterId: string) => Promise<boolean>;
  onSetAutoReply: (on: boolean) => Promise<void>;
}) {
  const { t } = useTranslation(["chat", "common", "memory"]);
  const navigate = useNavigate();

  return (
    <header
      className="grid grid-cols-3 items-center gap-3 border-b px-4 py-3 sm:px-8"
      style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-elevated)" }}
    >
      <div className="flex items-center gap-3 overflow-hidden">
        <button
          type="button"
          onClick={() => navigate("/")}
          className="shrink-0 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-sm"
          style={{ color: "var(--color-text-muted)", backgroundColor: "var(--color-surface-2)" }}
          title={t("room.backToList")}
        >
          ←
        </button>
        <h1 className="truncate font-[var(--font-display)] text-lg">{chat?.title}</h1>
      </div>
      {calendarDate ? (
        <div className="flex flex-col items-center text-center leading-tight">
          <span className="text-xs whitespace-nowrap" style={{ color: "var(--color-text-muted)" }}>
            {calendarDate.day}. {monthDisplayName(calendarDate.month, calendarMode)}, {calendarDate.year} {seasonIcon(calendarDate.season)}
          </span>
          <span className="text-xs whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>
            {formatTimeHHMM(calendarDate.hourOfDay ?? 6, calendarDate.minuteOfHour ?? 0)} · {weatherIcon(weather)} {weather}
          </span>
        </div>
      ) : (
        <div />
      )}
      <div className="flex items-center justify-end gap-2">
        {fallbackCharacter && (
          <div className="relative">
            <button
              type="button"
              onClick={onToggleGroup}
              title={`${t("room.gmLabel")} ${fallbackCharacter.name}`}
              aria-pressed={groupOpen}
              className="flex"
            >
              {fallbackCharacter.avatarUrl ? (
                <img
                  src={fallbackCharacter.avatarUrl}
                  alt={fallbackCharacter.name}
                  className="h-10 w-10 rounded-[var(--radius-md)] border object-cover object-top"
                  style={{ borderColor: groupOpen ? "var(--color-accent)" : "var(--color-border-strong)" }}
                />
              ) : (
                <span
                  className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] border text-sm font-medium"
                  style={{ borderColor: "var(--color-border-strong)", backgroundColor: "var(--color-surface-2)", color: "var(--color-text-muted)" }}
                >
                  {(fallbackCharacter.name || "?").trim().charAt(0).toUpperCase() || "?"}
                </span>
              )}
            </button>
            {groupOpen && chat && (
              <GroupMembersPopover
                chatId={chatId}
                chatCharacterId={chat.characterId}
                members={members}
                memberCharacters={memberCharacters}
                allCharacters={allCharacters}
                autoReply={autoReply}
                promotionConnection={promotionConnection}
                onAddMember={onAddMember}
                onRemoveMember={onRemoveMember}
                onSetAutoReply={onSetAutoReply}
                onClose={onCloseGroup}
              />
            )}
          </div>
        )}
      </div>
    </header>
  );
}
