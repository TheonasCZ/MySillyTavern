/** "Promote NPC to character" (plan M11-ish extra): pure prompt-building
 * and response-parsing helpers, unit-testable without the DB/store layer.
 * Orchestration (calling `chat_complete`, `createCharacter`, `addMember`)
 * lives in `GroupMembersPopover`. */

import type { ChatMessage } from "../providers/types";
import { NPC_PROMOTION_PROMPT } from "../prompt/promptTexts";

export interface NpcFact {
  subject: string;
  fact: string;
}

export interface TranscriptEntry {
  role: "system" | "user" | "assistant";
  content: string;
  speakerName?: string | null;
}

export interface PromotedCard {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  /** Always forced to "" — the promoted character enters an ongoing story,
   * so it should not have its own opening greeting. */
  firstMes: string;
}

/** How many of the most recent transcript messages to include as context. */
export const MAX_CONTEXT_MESSAGES = 40;

/** Per-message content truncation so a handful of very long messages don't
 * blow the context budget. */
const MAX_MESSAGE_CHARS = 500;



function truncateMessageContent(content: string): string {
  if (content.length <= MAX_MESSAGE_CHARS) return content;
  return `${content.slice(0, MAX_MESSAGE_CHARS)}…`;
}

/** Keeps only the last `max` transcript entries, oldest → newest (matching
 * how `listMessages` already orders them), truncating overly long ones. */
export function truncateTranscript(
  messages: TranscriptEntry[],
  max: number = MAX_CONTEXT_MESSAGES,
): TranscriptEntry[] {
  return messages.slice(Math.max(0, messages.length - max)).map((m) => ({
    ...m,
    content: truncateMessageContent(m.content),
  }));
}

function formatFacts(facts: NpcFact[]): string {
  if (facts.length === 0) return "(no recorded facts)";
  return facts.map((f) => `- ${f.fact}`).join("\n");
}

function formatTranscript(messages: TranscriptEntry[]): string {
  if (messages.length === 0) return "(no messages)";
  return messages
    .map((m) => `${m.speakerName ?? (m.role === "assistant" ? "AI" : "Player")}: ${m.content}`)
    .join("\n");
}

/** Builds the `chat_complete` prompt for generating a character card from
 * an NPC's ledger facts + recent transcript. Transcript is trimmed to the
 * last `MAX_CONTEXT_MESSAGES` entries before formatting. */
export function buildPromotionPrompt(
  npcName: string,
  facts: NpcFact[],
  messages: TranscriptEntry[],
  lang?: string,
): ChatMessage[] {
  const language = lang ?? "cs";
  const transcript = truncateTranscript(messages);
  return [
    { role: "system", content: NPC_PROMOTION_PROMPT(language) },
    {
      role: "user",
      content:
        `NPC: ${npcName}\n\nKnown facts:\n${formatFacts(facts)}\n\n` +
        `Latest chat messages:\n${formatTranscript(transcript)}`,
    },
  ];
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string";
}

/** Tolerant parser for the promotion LLM's output: strips code fences,
 * finds the first `{...}` JSON object substring, and validates required
 * string fields. `first_mes` is always forced to "" regardless of what the
 * model returned (per the prompt's instruction). Returns `null` (never
 * throws) on unparseable/invalid input so the UI can show an error. */
export function parsePromotedCard(raw: string): PromotedCard | null {
  if (!raw) return null;
  const withoutFences = raw.replace(/```[a-zA-Z]*\n?/g, "").replace(/```/g, "");
  const start = withoutFences.indexOf("{");
  const end = withoutFences.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  const candidate = withoutFences.slice(start, end + 1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const v = parsed as Record<string, unknown>;
  if (
    !isNonEmptyString(v.name) ||
    !isNonEmptyString(v.description) ||
    !isNonEmptyString(v.personality) ||
    !isNonEmptyString(v.scenario)
  ) {
    return null;
  }
  return {
    name: v.name.trim(),
    description: v.description.trim(),
    personality: v.personality.trim(),
    scenario: v.scenario.trim(),
    firstMes: "",
  };
}
