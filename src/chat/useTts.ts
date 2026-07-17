import { useCallback, useEffect, useRef, useState } from "react";

import { getSetting, setSetting } from "../db/repositories/settingsRepo";
import { prepareForTts } from "./ttsText";

const TTS_AUTO_KEY = "tts_auto";
const TTS_SPEED_KEY = "tts_speed";
const TTS_VOICE_KEY = "tts_voice";

const DEFAULT_SPEED = 1.0;

export interface TtsHook {
  /** Speak the given text after stripping markdown. */
  speak: (text: string, voiceUri?: string) => void;
  /** Stop current speech immediately. */
  stop: () => void;
  /** Whether speech is currently playing. */
  isSpeaking: boolean;
  /** Available SpeechSynthesisVoice objects (populated asynchronously). */
  voices: SpeechSynthesisVoice[];
  /** Enable/disable auto-read mode (persisted). */
  autoRead: boolean;
  setAutoRead: (v: boolean) => void;
  /** Speech speed multiplier (0.5–2.0, persisted). */
  speed: number;
  setSpeed: (v: number) => void;
  /** Currently selected global voice URI (persisted). */
  selectedVoiceUri: string;
  setSelectedVoiceUri: (v: string) => void;
}

export function useTts(): TtsHook {
  const synth = typeof window !== "undefined" ? window.speechSynthesis : null;
  const [autoRead, setAutoReadState] = useState(false);
  const [speed, setSpeedState] = useState(DEFAULT_SPEED);
  const [selectedVoiceUri, setSelectedVoiceUriState] = useState("");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Load persisted settings on mount
  useEffect(() => {
    void (async () => {
      const [auto, spd, voice] = await Promise.all([
        getSetting(TTS_AUTO_KEY),
        getSetting(TTS_SPEED_KEY),
        getSetting(TTS_VOICE_KEY),
      ]);
      if (auto) setAutoReadState(auto === "1");
      if (spd) setSpeedState(Number(spd) || DEFAULT_SPEED);
      if (voice) setSelectedVoiceUriState(voice);
    })();
  }, []);

  // Populate available voices
  useEffect(() => {
    if (!synth) return;

    const populate = () => {
      setVoices(synth.getVoices());
    };
    populate();

    // Chrome/WebView loads voices asynchronously
    synth.addEventListener("voiceschanged", populate);
    return () => synth.removeEventListener("voiceschanged", populate);
  }, [synth]);

  // Track speaking state via utterance events
  useEffect(() => {
    if (!synth) return;

    const check = () => {
      setIsSpeaking(synth.speaking);
    };

    // Poll periodically as a fallback (events are unreliable cross-browser)
    const timer = setInterval(check, 200);
    return () => clearInterval(timer);
  }, [synth]);

  const stop = useCallback(() => {
    if (synth) {
      synth.cancel();
      setIsSpeaking(false);
    }
  }, [synth]);

  const speak = useCallback(
    (text: string, voiceUri?: string) => {
      if (!synth) return;

      // Stop any current speech
      synth.cancel();

      const cleaned = prepareForTts(text);
      if (!cleaned) return;

      const utterance = new SpeechSynthesisUtterance(cleaned);
      utterance.rate = speed;

      // Select voice by URI
      const targetUri = voiceUri || selectedVoiceUri;
      if (targetUri) {
        const allVoices = synth.getVoices();
        const match = allVoices.find((v) => v.voiceURI === targetUri);
        if (match) utterance.voice = match;
      }

      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);

      utteranceRef.current = utterance;
      synth.speak(utterance);
    },
    [synth, speed, selectedVoiceUri],
  );

  const setAutoRead = useCallback((v: boolean) => {
    setAutoReadState(v);
    void setSetting(TTS_AUTO_KEY, v ? "1" : "0");
  }, []);

  const setSpeed = useCallback((v: number) => {
    const clamped = Math.max(0.5, Math.min(2.0, v));
    setSpeedState(clamped);
    void setSetting(TTS_SPEED_KEY, String(clamped));
  }, []);

  const setSelectedVoiceUri = useCallback((v: string) => {
    setSelectedVoiceUriState(v);
    void setSetting(TTS_VOICE_KEY, v);
  }, []);

  return {
    speak,
    stop,
    isSpeaking,
    voices,
    autoRead,
    setAutoRead,
    speed,
    setSpeed,
    selectedVoiceUri,
    setSelectedVoiceUri,
  };
}
