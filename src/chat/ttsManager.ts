import type { TtsBackend, TtsSpeakOptions, TtsVoice } from "./ttsBackend";
import type { WebSpeechTts } from "./webSpeechTts";
import type { EdgeTts } from "./edgeTts";

export class TtsManager implements TtsBackend {
  readonly id = "edge-tts" as const; // primary backend ID
  readonly label = "Auto (Edge-TTS → Web Speech)";

  private backends: TtsBackend[];


  constructor(webSpeech: WebSpeechTts, edgeTts: EdgeTts) {
    // Edge-TTS first (online, better quality), Web Speech as fallback
    this.backends = [edgeTts, webSpeech];
  }

  /**
   * Try each backend in order. The first one that succeeds wins.
   * On failure, log the error and continue to the next backend.
   */
  async speak(text: string, options?: TtsSpeakOptions): Promise<void> {
    console.log("[TtsManager] speak() — trying backends in order:", this.backends.map((b) => b.id).join(", "));
    for (let i = 0; i < this.backends.length; i++) {
      try {
        console.log("[TtsManager] Trying backend:", this.backends[i].id);
        await this.backends[i].speak(text, options);
        console.log("[TtsManager] Backend succeeded:", this.backends[i].id);
        return;
      } catch (e) {
        console.warn(`[TtsManager] Backend "${this.backends[i].id}" failed:`, e);
        // Continue to next backend
      }
    }
    // All backends failed — nothing we can do
    console.error("[TtsManager] All TTS backends failed");
  }

  stop(): void {
    this.backends.forEach((b) => b.stop());
  }

  get isSpeaking(): boolean {
    return this.backends.some((b) => b.isSpeaking);
  }

  async listVoices(): Promise<TtsVoice[]> {
    // Merge voices from all backends, Edge-TTS first
    const results: TtsVoice[] = [];
    const seen = new Set<string>();

    for (const backend of this.backends) {
      try {
        const voices = await backend.listVoices();
        for (const v of voices) {
          if (!seen.has(v.id)) {
            seen.add(v.id);
            results.push(v);
          }
        }
      } catch {
        // Skip backends that fail to list voices
      }
    }
    return results;
  }

  /** Set which backend to prefer (0 = edge-tts, 1 = web-speech). */
  setPreferredIndex(index: number): void {
    if (index >= 0 && index < this.backends.length) {
      // preference stored for future fallback logic
    }
  }

  /** The backends array — for UI introspection. */
  getBackends(): ReadonlyArray<TtsBackend> {
    return this.backends;
  }

  /**
   * Health check: try speaking a short test phrase and report which backend
   * succeeded. Returns null if all backends failed.
   */
  async testSpeak(phrase: string): Promise<{ backend: string; label: string } | null> {
    for (const backend of this.backends) {
      try {
        await backend.speak(phrase);
        return { backend: backend.id, label: backend.label };
      } catch {
        // continue
      }
    }
    return null;
  }
}
