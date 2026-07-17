import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { Message } from "../../db/repositories/messagesRepo";
import { buildRenderSegments, computeVisibleWindow, DEFAULT_ESTIMATED_HEIGHT } from "../../chat/virtualWindow";
import { MessageBubble } from "./MessageBubble";

// M11 §2 — history virtualization. Only chats bigger than this render a
// windowed history; small chats keep the exact old code path (no window
// math at all) to minimize regression risk. The most recent ACTIVE_ZONE
// messages are *always* fully rendered and go through the untouched
// pin/stream/anchor logic below — virtualization only ever touches older
// history above that zone, so 3830e33/e5c6520's anchoring can't regress.
const VIRTUALIZE_THRESHOLD = 60;
const ACTIVE_ZONE = 30;
const OVERSCAN = 10;
// The scroller is a flex column with `gap-3` (0.75rem = 12px) between every
// child. A collapsed spacer segment replaces N sibling bubbles with a
// single div, which loses the (N-1) gaps that used to sit *between* them —
// without compensating for that, the spacer undercounts real layout height
// by 12px per collapsed message, and that error grows with history size.
const GAP_PX = 12;

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

  const spacerRef = useRef<HTMLDivElement>(null);
  const anchoredUserMsgIdRef = useRef<string | null>(null);

  // --- M11 §2: history virtualization bookkeeping -------------------------
  // Measured heights (offsetHeight, px) keyed by message id — persists for
  // the component's lifetime so a message never needs remeasuring after it
  // scrolls out of the window once. Read directly (not React state) so a
  // measurement never itself forces a render; `scheduleWindowRecompute`
  // below is the only thing that does that, and it's throttled to rAF.
  const heightsRef = useRef<Map<string, number>>(new Map());
  const scrollTopRef = useRef(0);
  const rafPendingRef = useRef(false);
  const [, setWindowTick] = useState(0);

  const scheduleWindowRecompute = useCallback(() => {
    if (rafPendingRef.current) return;
    rafPendingRef.current = true;
    requestAnimationFrame(() => {
      rafPendingRef.current = false;
      setWindowTick((v) => v + 1);
    });
  }, []);

  // Attached to every fully-rendered *history* bubble wrapper (never the
  // active-zone ones — those keep using `data-msg-id` for the pin/anchor
  // logic above, and reusing that attribute here would make the e2e
  // harness's `[data-msg-id]` lookup match the wrong, off-screen node).
  // Mirrors `pinUserMessage`'s pattern of reading geometry synchronously
  // from the callback ref rather than an effect.
  const measureHistoryRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) return;
      const id = node.dataset.vid;
      if (!id) return;
      const h = node.getBoundingClientRect().height;
      const prev = heightsRef.current.get(id);
      if (prev === undefined || Math.abs(prev - h) > 0.5) {
        heightsRef.current.set(id, h);
        scheduleWindowRecompute();
      }
    },
    [scheduleWindowRecompute],
  );

  useEffect(() => {
    // Initial scroll-to-bottom when a chat opens; also resets the anchor
    // bookkeeping when the list empties (chat switch).
    if (prevScrollHeightRef.current !== null) return;
    if (messages.length === 0) {
      anchoredUserMsgIdRef.current = null;
      if (spacerRef.current) spacerRef.current.style.height = "0px";
      didInitialScrollRef.current = false;
      return;
    }
    if (!didInitialScrollRef.current) {
      bottomRef.current?.scrollIntoView({ block: "end" });
      didInitialScrollRef.current = true;
      if (scrollRef.current) scrollTopRef.current = scrollRef.current.scrollTop;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  // Anchoring strategy (ChatGPT-style): when the user sends a message, a
  // bottom spacer grows to viewport height and the view pins the END of the
  // user's message just below the top edge; the reply then streams into the
  // stable space beneath it with no further auto-scrolling. Implemented as a
  // callback ref so it runs in the commit that mounts the wrapper — an
  // effect could observe a not-yet-attached ref and silently skip the pin
  // for that message forever (the "view stuck on the previous reply" bug).
  const pinUserMessage = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const msgId = node.dataset.msgId ?? null;
    if (!msgId || anchoredUserMsgIdRef.current === msgId) return;
    // Don't pin while the chat is still opening (initial render also mounts
    // this wrapper when the newest message happens to be the user's).
    if (!didInitialScrollRef.current) {
      anchoredUserMsgIdRef.current = msgId;
      return;
    }
    const container = scrollRef.current;
    const spacer = spacerRef.current;
    if (!container || !spacer) return;
    anchoredUserMsgIdRef.current = msgId;
    // Full viewport height: the scroll target is 8px from the top, so the
    // spacer must guarantee at least clientHeight of room below the user
    // message — anything less clamps the scroll short.
    spacer.style.height = `${container.clientHeight}px`;
    // Pin the TOP of the user's message to the top edge: the whole sent
    // message stays readable and the reply fills the rest of the window.
    const containerRect = container.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    container.scrollTop += nodeRect.top - containerRect.top - 8;
  }, []);

  useEffect(() => {
    // Regenerate only: pin the start of the regenerated bubble to the top
    // once (there's no fresh user message to anchor on). New-message streams
    // are handled entirely by the user-message anchor above. If the bubble
    // isn't mounted yet when `streaming` flips (buildApiMessages awaits
    // lore/fact/embedding lookups before startStream), arm the flag so the
    // callback ref fires the scroll the instant the node exists.
    if (streaming && !prevStreamingRef.current && streamingMessageId !== null) {
      if (streamAnchorRef.current) {
        streamAnchorRef.current.scrollIntoView({ block: "start" });
      } else {
        pendingAnchorRef.current = true;
      }
    } else if (!streaming) {
      pendingAnchorRef.current = false;
    }
    prevStreamingRef.current = streaming;
  }, [streaming, streamingMessageId]);

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
      scrollTopRef.current = el.scrollTop;
    }
    prevScrollHeightRef.current = null;
  }, [messages]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (el) {
      scrollTopRef.current = el.scrollTop;
      if (messages.length > VIRTUALIZE_THRESHOLD) scheduleWindowRecompute();
    }
    if (!el || !onLoadOlder || !hasOlder || loadingOlder) return;
    if (el.scrollTop < 80) {
      prevScrollHeightRef.current = el.scrollHeight;
      onLoadOlder();
    }
  };

  const lastAssistantId = [...messages].reverse().find((m) => m.role === "assistant")?.id ?? null;

  // Plain bubble render, no pin/stream wrapper — used for every history
  // message (virtualized region) and for active-zone messages that aren't
  // the regenerate target or the just-sent user message.
  const renderMessage = (message: Message) => {
    const isRegeneratingThis = streaming && streamingMessageId === message.id;
    const content = isRegeneratingThis ? streamingText : message.content;
    const author = message.characterId ? membersById.get(message.characterId) : undefined;
    const resolvedAuthor = author ?? fallbackCharacter;
    return (
      <MessageBubble
        key={message.id}
        message={message}
        content={content}
        isStreaming={isRegeneratingThis}
        isUser={message.role === "user"}
        canEdit
        canRegenerate={message.role === "assistant" && message.id === lastAssistantId}
        actionsDisabled={streaming}
        isInterrupted={interruptedMessageIds.has(message.id)}
        avatarUrl={message.role === "user" ? personaAvatarUrl : resolvedAuthor.avatarUrl}
        authorName={message.role === "user" ? personaName : resolvedAuthor.name}
        showAuthorCaption={isGroup && message.role === "assistant"}
        onBranch={onBranch ? () => onBranch(message.id) : undefined}
        onEdit={(text) => onEdit(message.id, text)}
        onRegenerate={() => onRegenerate(message.id)}
        onContinue={() => onContinue(message.id)}
        onSwipe={(offset) => onSwipe(message.id, offset)}
      />
    );
  };

  // History virtualization: only above this size, and only the messages
  // older than the last ACTIVE_ZONE — those always render through the
  // untouched pin/stream logic below.
  const virtualizationActive = messages.length > VIRTUALIZE_THRESHOLD;
  const historyCount = virtualizationActive ? messages.length - ACTIVE_ZONE : 0;
  const history = virtualizationActive ? messages.slice(0, historyCount) : [];
  const activeZone = virtualizationActive ? messages.slice(historyCount) : messages;

  let historySegments: ReturnType<typeof buildRenderSegments> = [];
  if (virtualizationActive) {
    const heights = history.map((m) => heightsRef.current.get(m.id));
    const viewportHeight = scrollRef.current?.clientHeight || 800;
    const windowRange = computeVisibleWindow(
      heights,
      scrollTopRef.current,
      viewportHeight,
      OVERSCAN,
      DEFAULT_ESTIMATED_HEIGHT,
    );
    historySegments = buildRenderSegments(heights, windowRange);
  }

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
      data-total-messages={messages.length}
      className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4 sm:px-8"
    >
      {hasOlder && (
        <div className="flex justify-center pb-1">
          <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>
            {loadingOlder ? t("room.loadingOlder") : t("room.scrollForOlder")}
          </span>
        </div>
      )}
      {virtualizationActive &&
        historySegments.map((seg) => {
          if (seg.kind === "spacer") {
            const itemCount = seg.end - seg.start;
            const height = (seg.height ?? 0) + Math.max(0, itemCount - 1) * GAP_PX;
            return (
              <div key={`v-spacer-${seg.start}`} aria-hidden className="shrink-0" style={{ height }} />
            );
          }
          return history.slice(seg.start, seg.end).map((message) => (
            <div key={message.id} data-vid={message.id} ref={measureHistoryRef}>
              {renderMessage(message)}
            </div>
          ));
        })}
      {activeZone.map((message) => {
        const isRegeneratingThis = streaming && streamingMessageId === message.id;
        const isLastUserMessage =
          message.role === "user" && message.id === messages[messages.length - 1]?.id;
        const bubble = renderMessage(message);
        if (isRegeneratingThis) {
          return (
            <div key={message.id} ref={setStreamAnchor}>
              {bubble}
            </div>
          );
        }
        if (isLastUserMessage) {
          return (
            <div key={message.id} data-msg-id={message.id} ref={pinUserMessage}>
              {bubble}
            </div>
          );
        }
        return bubble;
      })}

      {streaming && streamingMessageId === null && (() => {
        const streamAuthor = streamingSpeakerId ? membersById.get(streamingSpeakerId) : undefined;
        const resolvedStreamAuthor = streamAuthor ?? fallbackCharacter;
        return (
          <div>
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

      {/* Bottom spacer sized by the anchor effect above — gives the view
       * room to pin the just-sent user message at the top even before the
       * reply has any height. Kept after the stream ends so nothing jumps. */}
      <div ref={spacerRef} aria-hidden className="shrink-0" />
      <div ref={bottomRef} />
    </div>
  );
}
