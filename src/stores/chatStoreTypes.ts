import type { Character } from "../db/repositories/charactersRepo";
import type { ChatMember } from "../db/repositories/chatMembersRepo";
import type { Chat } from "../db/repositories/chatsRepo";
import type { Message } from "../db/repositories/messagesRepo";
import type { ChatStreamHandle } from "../providers/chatStream";
import type { PromptReport } from "../prompt/promptBuilder";
import type { GameOverState } from "../chat/gameOver";

export interface ChatState {
  chatId: string | null;
  /** The chat row itself, loaded by `openChat` — components used to load
   * this on their own; the store now owns it so speaker resolution has
   * fresh-enough data without a round trip per action (plan §5). */
  chat: Chat | null;
  /** Roster (`chat_members`), ordered by position — the source of truth
   * for who's in the chat. */
  members: ChatMember[];
  /** Character cards for `members`, in the same order; entries whose card
   * failed to load are skipped. */
  memberCharacters: Character[];
  /** Manually-picked speaker for the next `sendMessage`/used by
   * `suggestReplies` — ignored while `autoReply` is on. */
  selectedSpeakerId: string | null;
  /** Automatic speaker selection (mirrors `chat.autoReply`, kept in sync by
   * `setAutoReplyMode`). */
  autoReply: boolean;
  /** Which member is currently streaming a reply — drives the streaming
   * bubble's avatar/name in group chats. Set at the start of every stream,
   * cleared once `finalize` has persisted the message. */
  streamingSpeakerId: string | null;
  messages: Message[];
  loading: boolean;
  streaming: boolean;
  /** Set while regenerating an existing assistant message; null while
   * streaming a brand new message. */
  streamingMessageId: string | null;
  streamingText: string;
  error: string | null;
  /** Whether `error` came from a retryable failure (429/5xx from the
   * provider, or the app being offline) — drives the "Try again" button in
   * the chat error banner (plan §9). */
  errorRetryable: boolean;
  /** Re-runs whatever request just failed, when `errorRetryable` is true. */
  retry: (() => void) | null;
  handle: ChatStreamHandle | null;
  pendingFinalize: ((content: string) => Promise<void>) | null;
  /** Ids of assistant messages whose stored content is a partial response
   * (stream was aborted or errored mid-way) — surfaces a "continue" action
   * in the UI instead of silently presenting a truncated reply as final
   * (plan §9). Cleared once the message is edited, regenerated, or
   * continued. Session-only (not persisted), since it only matters for the
   * chat currently open. */
  interruptedMessageIds: Set<string>;
  /** Report from the last PromptBuilder call for this chat — what exactly
   * went to the model, token counts, what got trimmed. Shown in the memory
   * panel's "Prompt" tab (plan §7 M5). Null until a message has been sent
   * (or if the character couldn't be loaded). */
  lastPromptReport: PromptReport | null;
  /** Whether there are older messages in the DB beyond what's currently
   * loaded — drives MessageList's "load older" affordance for long chats
   * (plan §9: paginate, load last 100, scroll-up fetches more). */
  hasOlderMessages: boolean;
  loadingOlderMessages: boolean;
  /** On-demand reply suggestions ("what could {{user}} do next") — filled by
   * `suggestReplies`, cleared when a message is sent or the chat changes.
   * Opt-in per press so it never burns tokens unasked (plan follow-up). */
  suggestions: string[] | null;
  suggesting: boolean;
  /** Hardcore-mode game over state for this chat — null unless the model
   *  emitted [GAMEOVER:reason] while chat.hardcoreMode was on. Loaded by
   *  `openChat` and refreshed after every stream; once set, `sendMessage`/
   *  `triggerSpeaker`/`regenerate`/`continueMessage` all refuse to run. */
  gameOver: GameOverState | null;

  openChat: (chatId: string) => Promise<void>;
  closeChat: () => Promise<void>;
  loadOlderMessages: () => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  /** Group chats: makes `speakerId` reply without a new player message —
   * "reply now" (plan §5/§7). */
  triggerSpeaker: (speakerId: string) => Promise<void>;
  regenerate: (messageId: string) => Promise<void>;
  continueMessage: (messageId: string) => Promise<void>;
  editMessage: (messageId: string, content: string) => Promise<void>;
  switchSwipe: (messageId: string, offset: number) => Promise<void>;
  stop: () => Promise<void>;
  dismissError: () => void;
  suggestReplies: () => Promise<void>;
  clearSuggestions: () => void;
  /** Adds a character to the roster (converts a solo chat into a group the
   * first time it's called) and reloads `members`/`memberCharacters`. */
  addMember: (characterId: string) => Promise<void>;
  /** Removes a member; refuses (returns `false`) to empty the roster. When
   * removing the current primary member, promotes the next member first so
   * the chat always has a valid `chats.character_id`. */
  removeMember: (characterId: string) => Promise<boolean>;
  setAutoReplyMode: (on: boolean) => Promise<void>;
  setHardcoreMode: (on: boolean) => Promise<void>;
  setSelectedSpeaker: (id: string) => void;
}

export type Setter = (
  partial:
    | Partial<ChatState>
    | ((state: ChatState) => Partial<ChatState>),
) => void;

export type Getter = () => ChatState;
