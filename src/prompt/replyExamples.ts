/** Voice-consistency example finder: retrieves historically similar replies
 * from the same character to use as live style references instead of a
 * static `mes_example`. Uses the existing embedding infrastructure. */

import { listEmbeddings, type StoredEmbedding } from "../db/repositories/embeddingsRepo";
import { listMessages } from "../db/repositories/messagesRepo";
import { cosineSimilarity, decodeVector } from "../memory/vector";

const MAX_EXAMPLE_CHARS = 200;
const MAX_EXAMPLES = 3;

/** Finds historically relevant character replies whose stored embeddings are
 * semantically closest to `contextEmbedding`. Returns their texts trimmed to
 * `MAX_EXAMPLE_CHARS` chars each, most relevant first.
 *
 * Falls back gracefully: returns `[]` when there are no stored voice
 * embeddings yet (new chat), when the character has no assistant messages,
 * or when the embeddings API failed earlier. */
export async function findRelevantReplies(
  chatId: string,
  characterId: string,
  contextEmbedding: number[],
): Promise<string[]> {
  // 1. Load all messages for the chat and build a set of message IDs
  //    authored by this character.
  let messagesByChar: Set<string>;
  try {
    const all = await listMessages(chatId);
    messagesByChar = new Set(
      all
        .filter((m) => m.role === "assistant" && m.characterId === characterId)
        .map((m) => m.id),
    );
  } catch {
    return [];
  }
  if (messagesByChar.size === 0) return [];

  // 2. Load all message-kind embeddings for this chat and filter to voice
  //    embeddings whose source message belongs to this character.
  let voiceRows: StoredEmbedding[];
  try {
    const allEmb = await listEmbeddings(chatId, "message");
    voiceRows = allEmb.filter(
      (e) =>
        e.refId.startsWith("voice:") &&
        messagesByChar.has(e.refId.slice("voice:".length)),
    );
  } catch {
    return [];
  }
  if (voiceRows.length === 0) return [];

  // 3. Score each voice row by cosine similarity against the context.
  const queryVec = Float32Array.from(contextEmbedding);
  const scored = voiceRows
    .map((row) => {
      let vec: Float32Array;
      try {
        vec = decodeVector(row.vector);
      } catch {
        return { text: row.text, score: 0 };
      }
      return { text: row.text, score: cosineSimilarity(vec, queryVec) };
    })
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_EXAMPLES);

  // 4. Trim to MAX_EXAMPLE_CHARS (append ellipsis when cut).
  return scored.map((s) =>
    s.text.length > MAX_EXAMPLE_CHARS
      ? `${s.text.slice(0, MAX_EXAMPLE_CHARS)}…`
      : s.text,
  );
}
