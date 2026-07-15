import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import type { Message } from "../../db/repositories/messagesRepo";
import { MessageBubble } from "./MessageBubble";

interface Props {
  messages: Message[];
  streaming: boolean;
  streamingMessageId: string | null;
  streamingText: string;
  onEdit: (messageId: string, content: string) => void;
  onRegenerate: (messageId: string) => void;
  onSwipe: (messageId: string, offset: number) => void;
}

export function MessageList({
  messages,
  streaming,
  streamingMessageId,
  streamingText,
  onEdit,
  onRegenerate,
  onSwipe,
}: Props) {
  const { t } = useTranslation("chat");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, streamingText]);

  const lastAssistantId = [...messages].reverse().find((m) => m.role === "assistant")?.id ?? null;

  if (messages.length === 0 && !streaming) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 text-center">
        <p className="text-sm" style={{ color: "var(--color-text-faint)" }}>
          {t("room.empty")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4 sm:px-8">
      {messages.map((message) => {
        const isRegeneratingThis = streaming && streamingMessageId === message.id;
        const content = isRegeneratingThis ? streamingText : message.content;
        return (
          <MessageBubble
            key={message.id}
            message={message}
            content={content}
            isStreaming={isRegeneratingThis}
            isUser={message.role === "user"}
            canEdit={!streaming}
            canRegenerate={!streaming && message.role === "assistant" && message.id === lastAssistantId}
            onEdit={(text) => onEdit(message.id, text)}
            onRegenerate={() => onRegenerate(message.id)}
            onSwipe={(offset) => onSwipe(message.id, offset)}
          />
        );
      })}

      {streaming && streamingMessageId === null && (
        <MessageBubble
          message={{
            id: "__streaming__",
            chatId: "",
            role: "assistant",
            content: streamingText,
            swipes: [streamingText],
            activeSwipe: 0,
            createdAt: "",
          }}
          content={streamingText}
          isStreaming
          isUser={false}
          canEdit={false}
          canRegenerate={false}
          onEdit={() => {}}
          onRegenerate={() => {}}
          onSwipe={() => {}}
        />
      )}

      <div ref={bottomRef} />
    </div>
  );
}
