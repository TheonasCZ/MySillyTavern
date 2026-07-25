import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import type { Chat } from "../../db/repositories/chatsRepo";
import type { MessageSearchHit } from "../../db/repositories/messagesRepo";
import { searchSnippet } from "../../chat/searchSnippet";

export function ChatSearchResults({
  searchHits,
  searchTerm,
  chats,
}: {
  searchHits: MessageSearchHit[];
  searchTerm: string;
  chats: Chat[];
}) {
  const { t } = useTranslation(["chat", "common"]);
  const navigate = useNavigate();

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>
        {t("list.searchResults", { count: searchHits.length })}
      </h2>
      {searchHits.length === 0 && (
        <p className="text-sm" style={{ color: "var(--color-text-faint)" }}>
          {t("list.searchEmpty")}
        </p>
      )}
      {searchHits.map((hit) => {
        const chat = chats.find((c) => c.id === hit.chatId);
        return (
          <button
            key={hit.messageId}
            type="button"
            onClick={() => navigate(`/chat/${hit.chatId}`)}
            className="flex flex-col gap-1 rounded-[var(--radius-md)] border px-4 py-2 text-left"
            style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-elevated)" }}
          >
            <span className="text-sm font-medium">{chat?.title ?? "…"}</span>
            <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              {searchSnippet(hit.content, searchTerm.trim())}
            </span>
          </button>
        );
      })}
    </div>
  );
}
