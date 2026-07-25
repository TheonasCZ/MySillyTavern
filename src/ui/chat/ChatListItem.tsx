import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import type { Chat } from "../../db/repositories/chatsRepo";
import type { Character } from "../../db/repositories/charactersRepo";
import type { ChatMember } from "../../db/repositories/chatMembersRepo";
import type { Persona } from "../../db/repositories/personasRepo";
import type { ConnectionConfig } from "../../providers/types";
import type { Preset } from "../../db/repositories/presetsRepo";
import { inputStyle } from "../common/inputStyle";

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function ChatListItem({
  chat,
  characters,
  connections,
  personas,
  presets,
  allMembers,
  unreadCount,
  isRenaming,
  renameValue,
  onRenameValueChange,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onDelete,
  onSetConnection,
  onSetPersona,
  onSetPreset,
}: {
  chat: Chat;
  characters: Character[];
  connections: ConnectionConfig[];
  personas: Persona[];
  presets: Preset[];
  allMembers: ChatMember[];
  unreadCount: number | null;
  isRenaming: boolean;
  renameValue: string;
  onRenameValueChange: (value: string) => void;
  onStartRename: () => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onDelete: () => void;
  onSetConnection: (connectionId: string | null) => void;
  onSetPersona: (personaId: string | null) => void;
  onSetPreset: (presetId: string | null) => void;
}) {
  const { t } = useTranslation(["chat", "common", "settings"]);
  const navigate = useNavigate();

  return (
    <li
      className="flex cursor-pointer flex-col gap-2 rounded-[var(--radius-md)] border px-4 py-3 transition-colors hover:border-[var(--color-border-strong)]"
      style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-elevated)" }}
      onClick={() => {
        // The whole card opens the chat; interactive children (rename
        // input, buttons, selects) stop propagation below.
        if (!isRenaming) navigate(`/chat/${chat.id}`);
      }}
    >
      <div className="flex items-center justify-between gap-2">
        {isRenaming ? (
          <input
            autoFocus
            className="flex-1 rounded-[var(--radius-sm)] border px-2 py-1 text-sm"
            style={inputStyle}
            value={renameValue}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onRenameValueChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onCommitRename();
              if (e.key === "Escape") onCancelRename();
            }}
            onBlur={onCommitRename}
          />
        ) : (
          <button
            type="button"
            className="flex-1 truncate text-left font-medium"
            onClick={() => navigate(`/chat/${chat.id}`)}
          >
            {chat.hardcoreMode && (
              <span
                className="mr-1"
                title={t("newChat.hardcoreMode") ?? ""}
                style={{ color: "var(--color-danger)" }}
              >
                💀
              </span>
            )}
            {chat.title}
            {unreadCount ? (
              <span
                className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs font-bold"
                style={{ backgroundColor: "var(--color-accent)", color: "var(--color-accent-contrast)" }}
              >
                {unreadCount}
              </span>
            ) : null}
          </button>
        )}

        <div className="flex shrink-0 items-center gap-1 text-xs">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onStartRename();
            }}
            className="rounded-[var(--radius-sm)] px-2 py-1 text-xs transition-colors"
            style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text)" }}
          >
            {t("actions.edit", { ns: "common" })}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="rounded-[var(--radius-sm)] px-2 py-1 text-xs transition-colors"
            style={{
              backgroundColor: "var(--color-surface-2)",
              color: "var(--color-danger)",
            }}
          >
            {t("actions.delete", { ns: "common" })}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs" style={{ color: "var(--color-text-faint)" }}>
        <span>
          {(() => {
            const memberIds = allMembers
              .filter((m) => m.chatId === chat.id)
              .map((m) => m.characterId);
            const names = memberIds
              .map((cid) => characters.find((c) => c.id === cid)?.name)
              .filter((n): n is string => !!n);
            return names.length > 0
              ? names.join(", ")
              : characters.find((c) => c.id === chat.characterId)?.name ?? "?";
          })()}
          {" · "}
          {t("list.updatedAt", { date: formatDate(chat.updatedAt) })}
        </span>
        <select
          className="rounded-[var(--radius-sm)] border px-2 py-1 text-xs"
          style={inputStyle}
          value={chat.connectionId ?? ""}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onSetConnection(e.target.value || null)}
        >
          <option value="">{t("list.noConnection")}</option>
          {connections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          className="rounded-[var(--radius-sm)] border px-2 py-1 text-xs"
          style={inputStyle}
          value={chat.personaId ?? ""}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onSetPersona(e.target.value || null)}
        >
          <option value="">{t("newChat.noPersona")}</option>
          {personas.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          className="rounded-[var(--radius-sm)] border px-2 py-1 text-xs"
          style={inputStyle}
          value={chat.presetId ?? ""}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onSetPreset(e.target.value || null)}
        >
          <option value="">{t("presets.noPreset", { ns: "settings" }) ?? "No preset"}</option>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
    </li>
  );
}
