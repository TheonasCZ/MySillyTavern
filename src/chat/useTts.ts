import { useCallback, useEffect, useRef, useState } from "react";

import { getSetting, setSetting } from "../db/repositories/settingsRepo";
import { prepareForTts } from "./ttsText";
import type { TtsVoice } from "./ttsBackend";
import { TtsManager } from "./ttsManager";
import { WebSpeechTts } from "./webSpeechTts";
import { EdgeTts } from "./edgeTts";

const TTS_AUTO_KEY = "tts_auto";
const TTS_SPEED_KEY = "tts_speed";
const TTS_VOICE_KEY = "tts_voice";
const TTS_PITCH_KEY = "tts_pitch";
const TTS_BACKEND_KEY = "tts_backend";

const DEFAULT_SPEED = 1.0;
const DEFAULT_PITCH = 0; // Hz offset

// ---------------------------------------------------------------------------
// Singleton TTS manager — created once per app lifetime
// ---------------------------------------------------------------------------
let managerInstance: TtsManager | null = null;

function getManager(): TtsManager {
  if (!managerInstance) {
    managerInstance = new TtsManager(new WebSpeechTts(), new EdgeTts());
  }
  return managerInstance;
}

// ---------------------------------------------------------------------------
// Hook interface — extended with backend, pitch, and combined voice list
// ---------------------------------------------------------------------------
export interface TtsHook {
  /** Speak the given text after stripping markdown. */
  speak: (text: string, voiceUri?: string) => void;
  /** Stop current speech immediately. */
  stop: () => void;
  /** Whether speech is currently playing. */
  isSpeaking: boolean;
  /** Available voices from all backends (populated asynchronously). */
  voices: TtsVoice[];
  /** Enable/disable auto-read mode (persisted). */
  autoRead: boolean;
  setAutoRead: (v: boolean) => void;
  /** Speech rate multiplier (0.5–2.0, persisted). */
  speed: number;
  setSpeed: (v: number) => void;
  /** Currently selected global voice ID (persisted). */
  selectedVoiceUri: string;
  setSelectedVoiceUri: (v: string) => void;
  /** Active backend index (0 = edge-tts, 1 = web-speech, persisted). */
  backend: number;
  setBackend: (v: number) => void;
  /** Pitch offset in Hz (-20..+20, persisted). */
  pitch: number;
  setPitch: (v: number) => void;
}

// ---------------------------------------------------------------------------
export function useTts(): TtsHook {
  const manager = getManager();
  const [autoRead, setAutoReadState] = useState(false);
  const [speed, setSpeedState] = useState(DEFAULT_SPEED);
  const [pitch, setPitchState] = useState(DEFAULT_PITCH);
  const [selectedVoiceUri, setSelectedVoiceUriState] = useState("");
  const [backend, setBackendState] = useState(0);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voices, setVoices] = useState<TtsVoice[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load persisted settings on mount
  useEffect(() => {
    void (async () => {
      const [auto, spd, voice, ptch, bknd] = await Promise.all([
        getSetting(TTS_AUTO_KEY),
        getSetting(TTS_SPEED_KEY),
        getSetting(TTS_VOICE_KEY),
        getSetting(TTS_PITCH_KEY),
        getSetting(TTS_BACKEND_KEY),
      ]);
      if (auto) setAutoReadState(auto === "1");
      if (spd) setSpeedState(Number(spd) || DEFAULT_SPEED);
      if (voice) setSelectedVoiceUriState(voice);
      if (ptch) setPitchState(Number(ptch) || DEFAULT_PITCH);
      if (bknd) setBackendState(Number(bknd) || 0);
    })();
  }, []);

  // Sync backend preference to manager
  useEffect(() => {
    manager.setPreferredIndex(backend);
  }, [backend, manager]);

  // Populate available voices from all backends
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const list = await manager.listVoices();
      if (!cancelled) setVoices(list);
    })();
    return () => {
      cancelled = true;
    };
  }, [backend, manager]);

  // Poll isSpeaking (event-driven doesn't cover all backends)
  useEffect(() => {
    pollRef.current = setInterval(() => {
      setIsSpeaking(manager.isSpeaking);
    }, 200);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [manager]);

  const stop = useCallback(() => {
    manager.stop();
    setIsSpeaking(false);
  }, [manager]);

  const speak = useCallback(
    (text: string, voiceUri?: string) => {
      const cleaned = prepareForTts(text);
      if (!cleaned) return;

      manager.stop();

      const targetVoice = voiceUri || selectedVoiceUri;

      void manager.speak(cleaned, {
        voice: targetVoice || undefined,
        rate: speed,
        pitch,
      });
    },
    [manager, speed, pitch, selectedVoiceUri],
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

  const setPitch = useCallback((v: number) => {
    const clamped = Math.max(-20, Math.min(20, v));
    setPitchState(clamped);
    void setSetting(TTS_PITCH_KEY, String(clamped));
  }, []);

  const setSelectedVoiceUri = useCallback((v: string) => {
    setSelectedVoiceUriState(v);
    void setSetting(TTS_VOICE_KEY, v);
  }, []);

  const setBackend = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    setBackendState(clamped);
    void setSetting(TTS_BACKEND_KEY, String(clamped));
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
    backend,
    setBackend,
    pitch,
    setPitch,
  };
}
