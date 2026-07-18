import type { TtsBackend, TtsSpeakOptions, TtsVoice } from "./ttsBackend";
import { prepareForTts } from "./ttsText";

export class WebSpeechTts implements TtsBackend {
  readonly id = "web-speech" as const;
  readonly label = "Web Speech";

  private synth: SpeechSynthesis | null;
  private _isSpeaking = false;

  constructor() {
    this.synth = typeof window !== "undefined" ? window.speechSynthesis : null;
  }

  get isSpeaking(): boolean {
    if (this.synth) {
      return this.synth.speaking;
    }
    return this._isSpeaking;
  }

  async speak(text: string, options?: TtsSpeakOptions): Promise<void> {
    const synth = this.synth;
    if (!synth) {
      console.warn("[WebSpeechTts] window.speechSynthesis not available — TTS cannot work");
      throw new Error("Web Speech API not available (window.speechSynthesis is null)");
    }

    // Stop any current speech
    synth.cancel();

    const cleaned = prepareForTts(text);
    if (!cleaned) {
      console.warn("[WebSpeechTts] Text empty after cleaning, nothing to speak");
      throw new Error("Text empty after TTS preparation");
    }

    console.log("[WebSpeechTts] Speaking:", cleaned.slice(0, 60) + (cleaned.length > 60 ? "…" : ""));

    const utterance = new SpeechSynthesisUtterance(cleaned);

    // Apply rate
    if (options?.rate !== undefined) {
      utterance.rate = Math.max(0.5, Math.min(2.0, options.rate));
    }

    // Apply pitch
    if (options?.pitch !== undefined) {
      // Web Speech pitch is 0..2, default 1.0
      // Map Hz offset (-20..+20) to pitch range (0.5..1.5)
      const normalized = Math.max(-20, Math.min(20, options.pitch));
      utterance.pitch = 1.0 + (normalized / 20) * 0.5;
    }

    // Select voice by URI/name
    if (options?.voice) {
      const allVoices = synth.getVoices();
      const match =
        allVoices.find((v) => v.voiceURI === options.voice) ||
        allVoices.find((v) => v.name === options.voice) ||
        allVoices.find((v) => v.lang.startsWith(options.voice!));
      if (match) utterance.voice = match;
    }

    const SAFETY_TIMEOUT_MS = 30_000;

    return new Promise<void>((resolve, reject) => {
      let settled = false;

      const safetyTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          this._isSpeaking = false;
          synth.cancel();
          console.warn("[WebSpeechTts] Timed out after " + SAFETY_TIMEOUT_MS + " ms — no onend/onerror fired");
          reject(new Error("Web Speech timed out"));
        }
      }, SAFETY_TIMEOUT_MS);

      utterance.onstart = () => {
        this._isSpeaking = true;
        console.log("[WebSpeechTts] Utterance started");
      };
      utterance.onend = () => {
        if (settled) return;
        settled = true;
        clearTimeout(safetyTimer);
        this._isSpeaking = false;
        console.log("[WebSpeechTts] Utterance ended");
        resolve();
      };
      utterance.onerror = (event) => {
        if (settled) return;
        settled = true;
        clearTimeout(safetyTimer);
        this._isSpeaking = false;
        console.warn("[WebSpeechTts] Utterance error:", event.error);
        reject(new Error("Web Speech error: " + (event.error || "unknown")));
      };

      synth.speak(utterance);
    });
  }

  stop(): void {
    if (this.synth) {
      this.synth.cancel();
    }
    this._isSpeaking = false;
  }

  async listVoices(): Promise<TtsVoice[]> {
    const synth = this.synth;
    if (!synth) return [];

    // Chrome/WebView loads voices asynchronously
    const getVoices = (): SpeechSynthesisVoice[] => {
      const voices = synth.getVoices();
      if (voices.length > 0) return voices;
      return [];
    };

    // Try immediate, then wait for voiceschanged
    const immediate = getVoices();
    if (immediate.length > 0) {
      return immediate.map((v) => ({
        id: v.voiceURI,
        name: v.name,
        lang: v.lang,
        backend: "web-speech" as const,
      }));
    }

    // Wait for voices to load
    return new Promise<TtsVoice[]>((resolve) => {
      const timeout = setTimeout(() => {
        synth.removeEventListener("voiceschanged", handler);
        resolve([]);
      }, 2000);

      const handler = () => {
        clearTimeout(timeout);
        synth.removeEventListener("voiceschanged", handler);
        resolve(
          getVoices().map((v) => ({
            id: v.voiceURI,
            name: v.name,
            lang: v.lang,
            backend: "web-speech" as const,
          })),
        );
      };

      synth.addEventListener("voiceschanged", handler);
    });
  }
}
