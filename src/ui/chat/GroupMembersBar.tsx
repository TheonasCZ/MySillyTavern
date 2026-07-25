import { useTranslation } from "react-i18next";

import type { Character } from "../../db/repositories/charactersRepo";
import { avatarSrc } from "../characters/avatarSrc";

const MAX_VISIBLE_AVATARS = 5;

/** Bottom bar: group members avatar strip, opens the group members popover. */
export function GroupMembersBar({
  memberCharacters,
  groupOpen,
  onToggleGroup,
}: {
  memberCharacters: Character[];
  groupOpen: boolean;
  onToggleGroup: () => void;
}) {
  const { t } = useTranslation(["chat", "common", "memory"]);

  if (memberCharacters.length <= 1) return null;

  return (
    <div className="flex shrink-0 items-center gap-3 border-t px-4 py-1.5" style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-elevated)" }}>
      <div className="relative">
        <button
          type="button"
          onClick={onToggleGroup}
          aria-pressed={groupOpen}
          title={t("room.groupMembers") ?? ""}
          className="flex items-center rounded-[var(--radius-sm)] border px-1.5 py-1 transition-colors"
          style={{
            borderColor: "var(--color-border-strong)",
            backgroundColor: groupOpen ? "var(--color-accent)" : "transparent",
          }}
        >
          {memberCharacters.slice(0, MAX_VISIBLE_AVATARS).map((c, i) => {
            const url = avatarSrc(c.avatarPath);
            return url ? (
              <img
                key={c.id}
                src={url}
                alt={c.name}
                title={c.name}
                className="h-6 w-6 rounded-full border object-cover object-top"
                style={{ borderColor: "var(--color-border-strong)", marginLeft: i === 0 ? 0 : "-0.4rem" }}
              />
            ) : (
              <span
                key={c.id}
                title={c.name}
                aria-hidden
                className="flex h-6 w-6 items-center justify-center rounded-full border text-[0.6rem] font-medium"
                style={{
                  borderColor: "var(--color-border-strong)",
                  backgroundColor: "var(--color-surface-2)",
                  color: "var(--color-text-muted)",
                  marginLeft: i === 0 ? 0 : "-0.4rem",
                }}
              >
                {(c.name || "?").trim().charAt(0).toUpperCase() || "?"}
              </span>
            );
          })}
          {memberCharacters.length > MAX_VISIBLE_AVATARS && (
            <span
              className="flex h-6 w-6 items-center justify-center rounded-full border text-[0.6rem] font-medium"
              style={{
                borderColor: "var(--color-border-strong)",
                backgroundColor: "var(--color-surface-2)",
                color: "var(--color-text-muted)",
                marginLeft: "-0.4rem",
              }}
            >
              +{memberCharacters.length - MAX_VISIBLE_AVATARS}
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
