import { getSetting, setSetting } from "../db/repositories/settingsRepo";
import { storeVoiceEmbedding } from "../db/repositories/embeddingsRepo";
import { canEmbed, getEmbeddingSettings } from "../memory/embeddingsEngine";
import { encodeVector } from "../memory/vector";
import { embedTexts } from "../providers/embeddings";
import type { ConnectionConfig } from "../providers/types";

/** Fire-and-forget: embeds the assistant message text and stores it as a
 *  voice example for future style-consistency lookups. Skips when embeddings
 *  are disabled, the provider doesn't support them, or the voice-examples
 *  feature is toggled off. Stores only every 3rd assistant message (tracked
 *  via the `voice_example_counter_<chatId>` setting). */
export async function scheduleVoiceEmbedding(
  chatId: string,
  messageId: string,
  text: string,
  connection: ConnectionConfig | null,
): Promise<void> {
  if (!connection || !canEmbed(connection)) return;
  // Respect the feature toggle.
  try {
    const enabled = await getSetting("voice_examples_enabled");
    if (enabled === "0") return;
  } catch {
    return;
  }
  // Only embed every 3rd assistant message.
  const counterKey = `voice_example_counter_${chatId}`;
  try {
    const raw = await getSetting(counterKey);
    let counter = Number(raw) || 0;
    counter++;
    if (counter < 3) {
      await setSetting(counterKey, String(counter));
      return;
    }
    // Reset counter and proceed.
    await setSetting(counterKey, "0");
  } catch {
    return;
  }
  // Compute and store the embedding.
  try {
    const settings = await getEmbeddingSettings();
    const { model: usedModel, vectors } = await embedTexts(connection, [text], settings.model);
    const vec = Float32Array.from(vectors[0]);
    await storeVoiceEmbedding(chatId, messageId, text, usedModel, vec.length, encodeVector(vec));
  } catch {
    // Silently degrade — a failed voice embedding must never break the chat.
  }
}
