import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import type { Message } from "../../db/repositories/messagesRepo";
import { MessageBubble } from "./MessageBubble";

interface Props {
  messages: Message[];
  streaming: boolean;
  streamingMessageId: string | null;
  streamingText: string;
  interruptedMessageIds: Set<string>;
  characterAvatarUrl?: string;
  characterName?: string;
  personaAvatarUrl?: string;
  personaName?: string;
  onEdit: (messageId: string, content: string) => void;
  onRegenerate: (messageId: string) => void;
  onContinue: (messageId: string) => void;
  onSwipe: (messageId: string, offset: number) => void;
  onBranch?: (messageId: string) => void;
  onLoadOlder?: () => void;
  hasOlder?: boolean;
  loadingOlder?: boolean;
}

export function MessageList({
  messages,
  streaming,
  streamingMessageId,
  streamingText,
  interruptedMessageIds,
  characterAvatarUrl,
  characterName,
  personaAvatarUrl,
  personaName,
  onEdit,
  onRegenerate,
  onContinue,
  onSwipe,
  onBranch,
  onLoadOlder,
  hasOlder = false,
  loadingOlder = false,
}: Props) {
  const { t } = useTranslation("chat");
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const streamAnchorRef = useRef<HTMLDivElement>(null);
  const prevScrollHeightRef = useRef<number | null>(null);
  const didInitialScrollRef = useRef(false);
  const prevStreamingRef = useRef(false);

  useEffect(() => {
    // Scroll to the bottom once when the chat opens, and again whenever the
    // user sends a message. Streaming tokens deliberately do NOT stick the
    // view to the bottom — the reply is anchored at its start instead (below)
    // so a long generation can be read from the top without chasing it.
    if (prevScrollHeightRef.current !== null) return;
    const last = messages[messages.length - 1];
    const userJustSent = !streaming && last?.role === "user";
    if (!didInitialScrollRef.current || userJustSent) {
      bottomRef.current?.scrollIntoView({ block: "end" });
    }
    if (messages.length > 0) didInitialScrollRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, streaming]);

  useEffect(() => {
    // When a generation starts, pin the start of the reply to the top of the
    // viewport exactly once; tokens then grow downward off-screen.
    if (streaming && !prevStreamingRef.current) {
      streamAnchorRef.current?.scrollIntoView({ block: "start" });
    }
    prevStreamingRef.current = streaming;
  }, [streaming]);

  // Preserve scroll position when older messages are prepended: remember
  // the scrollHeight right before the fetch, then after the DOM updates
  // scroll forward by exactly the height that got added above the fold.
  useEffect(() => {
    if (prevScrollHeightRef.current === null) return;
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight - prevScrollHeightRef.current;
    }
    prevScrollHeightRef.current = null;
  }, [messages]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el || !onLoadOlder || !hasOlder || loadingOlder) return;
    if (el.scrollTop < 80) {
      prevScrollHeightRef.current = el.scrollHeight;
      onLoadOlder();
    }
  };

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
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4 sm:px-8"
    >
      {hasOlder && (
        <div className="flex justify-center pb-1">
          <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>
            {loadingOlder ? t("room.loadingOlder") : t("room.scrollForOlder")}
          </span>
        </div>
      )}
      {messages.map((message) => {
        const isRegeneratingThis = streaming && streamingMessageId === message.id;
        const content = isRegeneratingThis ? streamingText : message.content;
        const bubble = (
          <MessageBubble
            key={message.id}
            message={message}
            content={content}
            isStreaming={isRegeneratingThis}
            isUser={message.role === "user"}
            canEdit={!streaming}
            canRegenerate={!streaming && message.role === "assistant" && message.id === lastAssistantId}
            isInterrupted={interruptedMessageIds.has(message.id)}
            avatarUrl={message.role === "user" ? personaAvatarUrl : characterAvatarUrl}
            authorName={message.role === "user" ? personaName : characterName}
            onBranch={!streaming && onBranch ? () => onBranch(message.id) : undefined}
            onEdit={(text) => onEdit(message.id, text)}
            onRegenerate={() => onRegenerate(message.id)}
            onContinue={() => onContinue(message.id)}
            onSwipe={(offset) => onSwipe(message.id, offset)}
          />
        );
        return isRegeneratingThis ? (
          <div key={message.id} ref={streamAnchorRef}>
            {bubble}
          </div>
        ) : (
          bubble
        );
      })}

      {streaming && streamingMessageId === null && (
        <div ref={streamAnchorRef}>
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
          avatarUrl={characterAvatarUrl}
          authorName={characterName}
          canEdit={false}
          canRegenerate={false}
          onEdit={() => {}}
          onRegenerate={() => {}}
          onSwipe={() => {}}
        />
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
