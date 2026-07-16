import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import type { Message } from "../../db/repositories/messagesRepo";
import { MessageBubble } from "./MessageBubble";

/** Minimal member info needed to render an avatar/name — keyed by
 * `characterId` so a message's author can be looked up without a live
 * `Character` object (plan §7). */
export interface MemberInfo {
  name: string;
  avatarUrl?: string;
}

interface Props {
  messages: Message[];
  streaming: boolean;
  streamingMessageId: string | null;
  streamingText: string;
  interruptedMessageIds: Set<string>;
  /** Character info for assistant messages, keyed by `message.characterId`. */
  membersById: Map<string, MemberInfo>;
  /** Used when a message's `characterId` isn't in `membersById` (legacy solo
   * chat rows, or a deleted character card). */
  fallbackCharacter: MemberInfo;
  personaAvatarUrl?: string;
  personaName?: string;
  /** Author of the in-progress streaming bubble (new message, not a
   * regenerate) — drives its avatar/name in group chats. */
  streamingSpeakerId?: string | null;
  /** Whether the chat has more than one member — shows a name caption above
   * each assistant bubble's content. */
  isGroup?: boolean;
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
  membersById,
  fallbackCharacter,
  personaAvatarUrl,
  personaName,
  streamingSpeakerId = null,
  isGroup = false,
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
  const streamAnchorRef = useRef<HTMLDivElement | null>(null);
  const prevScrollHeightRef = useRef<number | null>(null);
  const didInitialScrollRef = useRef(false);
  const prevStreamingRef = useRef(false);
  // Armed by the effect below the instant a generation starts; a stream's
  // anchor div (regenerate bubble or new-message placeholder) doesn't
  // always exist in the DOM in the same commit as `streaming` flipping true
  // — `buildApiMessages` awaits lore/fact/embedding lookups *before*
  // `startStream` runs, so the state update that flips `streaming` can land
  // in a different commit than expected. Rather than relying on effect vs.
  // ref-commit ordering, the callback ref below performs the scroll itself,
  // exactly once, the moment the anchor node actually mounts.
  const pendingAnchorRef = useRef(false);

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
    // viewport exactly once; tokens then grow downward off-screen. If the
    // anchor div is already mounted (the common case), scroll immediately;
    // otherwise arm `pendingAnchorRef` so the ref callback below fires the
    // scroll the instant the placeholder/regenerate bubble actually mounts,
    // instead of risking a stale/missing node.
    if (streaming && !prevStreamingRef.current) {
      if (streamAnchorRef.current) {
        streamAnchorRef.current.scrollIntoView({ block: "start" });
      } else {
        pendingAnchorRef.current = true;
      }
    } else if (!streaming) {
      // A stream that ended (finished/aborted/errored) before its anchor
      // div ever mounted shouldn't leave a stale "pending" flag armed for
      // whatever unrelated anchor mounts next.
      pendingAnchorRef.current = false;
    }
    prevStreamingRef.current = streaming;
  }, [streaming]);

  // Attached to whichever div hosts the in-progress streaming bubble
  // (regenerate target or new-message placeholder). Runs during commit, so
  // it always observes the node the instant it exists — the correct place
  // to fire a scroll that must not race the passive effect above.
  const setStreamAnchor = useCallback((node: HTMLDivElement | null) => {
    streamAnchorRef.current = node;
    if (node && pendingAnchorRef.current) {
      pendingAnchorRef.current = false;
      node.scrollIntoView({ block: "start" });
    }
  }, []);

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
        const author = message.characterId ? membersById.get(message.characterId) : undefined;
        const resolvedAuthor = author ?? fallbackCharacter;
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
            avatarUrl={message.role === "user" ? personaAvatarUrl : resolvedAuthor.avatarUrl}
            authorName={message.role === "user" ? personaName : resolvedAuthor.name}
            showAuthorCaption={isGroup && message.role === "assistant"}
            onBranch={!streaming && onBranch ? () => onBranch(message.id) : undefined}
            onEdit={(text) => onEdit(message.id, text)}
            onRegenerate={() => onRegenerate(message.id)}
            onContinue={() => onContinue(message.id)}
            onSwipe={(offset) => onSwipe(message.id, offset)}
          />
        );
        return isRegeneratingThis ? (
          <div key={message.id} ref={setStreamAnchor}>
            {bubble}
          </div>
        ) : (
          bubble
        );
      })}

      {streaming && streamingMessageId === null && (() => {
        const streamAuthor = streamingSpeakerId ? membersById.get(streamingSpeakerId) : undefined;
        const resolvedStreamAuthor = streamAuthor ?? fallbackCharacter;
        return (
          <div ref={setStreamAnchor}>
            <MessageBubble
              message={{
                id: "__streaming__",
                chatId: "",
                role: "assistant",
                content: streamingText,
                swipes: [streamingText],
                activeSwipe: 0,
                createdAt: "",
                characterId: streamingSpeakerId ?? null,
              }}
              content={streamingText}
              isStreaming
              isUser={false}
              avatarUrl={resolvedStreamAuthor.avatarUrl}
              authorName={resolvedStreamAuthor.name}
              showAuthorCaption={isGroup}
              canEdit={false}
              canRegenerate={false}
              onEdit={() => {}}
              onRegenerate={() => {}}
              onSwipe={() => {}}
            />
          </div>
        );
      })()}

      <div ref={bottomRef} />
    </div>
  );
}
