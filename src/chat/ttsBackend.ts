export interface TtsVoice {
  id: string;       // e.g. "cs-CZ-AntoninNeural" or SpeechSynthesisVoice.voiceURI
  name: string;     // e.g. "Antonin" or "Google čeština"
  lang: string;     // e.g. "cs-CZ"
  backend: "web-speech" | "edge-tts";
}

export interface TtsSpeakOptions {
  voice?: string;
  pitch?: number;   // Hz offset, e.g. -15
  rate?: number;    // multiplier, e.g. 0.9
}

export interface TtsBackend {
  readonly id: "web-speech" | "edge-tts";
  readonly label: string;
  speak(text: string, options?: TtsSpeakOptions): Promise<void>;
  stop(): void;
  readonly isSpeaking: boolean;
  listVoices(): Promise<TtsVoice[]>;
}
