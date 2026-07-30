import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { getChat, type Chat } from "../../db/repositories/chatsRepo";
import { useChatListStore } from "../../stores/chatListStore";
import { useConnectionsStore } from "../../stores/connectionsStore";
import { inputStyle } from "./constants";

export function ImageConnectionPicker({ chatId }: { chatId: string }) {
  const { t } = useTranslation("memory");
  const { connections } = useConnectionsStore();
  const { setImageConnection } = useChatListStore();
  const [chat, setChat] = useState<Chat | null>(null);

  useEffect(() => {
    void getChat(chatId).then(setChat);
  }, [chatId]);

  if (!chat) return null;

  return (
    <label className="flex flex-col gap-1 text-xs">
      {t("imageConnection.label")}
      <select
        className="rounded-[var(--radius-sm)] border px-2 py-1"
        style={inputStyle}
        value={chat.imageConnectionId ?? ""}
        onChange={async (e) => {
          const value = e.target.value || null;
          await setImageConnection(chatId, value);
          setChat((c) => (c ? { ...c, imageConnectionId: value } : c));
        }}
      >
        <option value="">{t("imageConnection.useDefault")}</option>
        {connections.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  );
}
