import type { Message } from "../db/repositories/messagesRepo";
import type { Quest } from "../db/repositories/questsRepo";

const MAX_MESSAGES_PER_CHUNK = 80;

export interface Chunk {
  index: number;
  messages: Message[];
  /** Human-readable label, e.g. quest name or "Část 1" */
  label: string;
}

/**
 * Splits chat messages into prose-sized chunks suitable for the AI
 * chronicler. Strategy:
 * 1. Try to align chunks with quest boundaries first (natural chapters).
 * 2. Sub-split any remaining large blocks at ~80 messages.
 * 3. System messages are grouped with the next non-system message.
 */
export function chunkMessages(
  messages: Message[],
  quests: Quest[],
): Chunk[] {
  if (messages.length === 0) return [];

  const chunks: Chunk[] = [];
  let current: Message[] = [];
  let chunkIndex = 0;
  let label = "Kapitola 1";

  // Build a map: message.createdAt → quest name (earliest quest that
  // started by this point). Used as a heuristic to detect quest boundaries.
  const questBoundaries = new Map<string, string>();
  for (const q of quests) {
    questBoundaries.set(q.createdAt, q.name);
  }

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    // Check if we crossed a quest boundary
    const boundaryQuest = questBoundaries.get(msg.createdAt);
    if (boundaryQuest && current.length > 0) {
      // Finalize current chunk at quest boundary
      chunks.push({
        index: chunkIndex++,
        messages: [...current],
        label,
      });
      current = [];
      label = boundaryQuest;
    }

    current.push(msg);

    // Force split when chunk gets too large
    if (current.length >= MAX_MESSAGES_PER_CHUNK) {
      chunks.push({
        index: chunkIndex++,
        messages: [...current],
        label,
      });
      current = [];
      label = `Část ${chunks.length + 1}`;
    }
  }

  // Don't forget the last chunk
  if (current.length > 0) {
    chunks.push({
      index: chunkIndex,
      messages: [...current],
      label,
    });
  }

  return chunks;
}

/**
 * Converts a chunk's messages into the format expected by the Rust
 * `start_export` command: `{ index, messages: { role, content }[] }`.
 */
export function chunkToExportFormat(chunk: Chunk) {
  return {
    index: chunk.index,
    messages: chunk.messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
  };
}
