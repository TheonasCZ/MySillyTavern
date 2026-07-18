import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { getSetting, setSetting } from "../../db/repositories/settingsRepo";
import type { TtsVoice } from "../../chat/ttsBackend";
import { WebSpeechTts } from "../../chat/webSpeechTts";
import { EdgeTts } from "../../chat/edgeTts";
import { TtsManager } from "../../chat/ttsManager";

const inputStyle = {
  backgroundColor: "var(--color-surface-2)",
  borderColor: "var(--color-border-strong)",
  color: "var(--color-text)",
} as const;

// ---------------------------------------------------------------------------
// Singleton TTS manager — mirrors useTts.ts
// ---------------------------------------------------------------------------
let managerInstance: TtsManager | null = null;

function getManager(): TtsManager {
  if (!managerInstance) {
    managerInstance = new TtsManager(new WebSpeechTts(), new EdgeTts());
  }
  return managerInstance;
}

// ---------------------------------------------------------------------------
export function TtsPanel() {
  const { t } = useTranslation("settings");
  const manager = getManager();

  const [autoRead, setAutoRead] = useState(false);
  const [selectedVoiceUri, setSelectedVoiceUri] = useState("");
  const [speed, setSpeed] = useState("1.0");
  const [pitch, setPitch] = useState("0");
  const [backend, setBackend] = useState("0");
  const [voices, setVoices] = useState<TtsVoice[]>([]);
  const [saved, setSaved] = useState(false);
  const [testResult, setTestResult] = useState<"ok" | "fallback" | "fail" | null>(null);
  const [testRunning, setTestRunning] = useState(false);

  // Load persisted settings
  useEffect(() => {
    void (async () => {
      const [auto, voice, spd, ptch, bknd] = await Promise.all([
        getSetting("tts_auto"),
        getSetting("tts_voice"),
        getSetting("tts_speed"),
        getSetting("tts_pitch"),
        getSetting("tts_backend"),
      ]);
      if (auto) setAutoRead(auto === "1");
      if (voice) setSelectedVoiceUri(voice);
      if (spd) setSpeed(spd);
      if (ptch) setPitch(ptch);
      if (bknd) setBackend(bknd);
    })();
  }, []);

  // Populate voices from all backends
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

  // Sync backend to manager
  useEffect(() => {
    manager.setPreferredIndex(Number(backend) || 0);
  }, [backend, manager]);

  const handleTest = useCallback(async () => {
    setTestRunning(true);
    setTestResult(null);
    try {
      const result = await manager.testSpeak("Hello");
      if (!result) {
        setTestResult("fail");
      } else if (result.backend === "edge-tts") {
        setTestResult("ok");
      } else {
        setTestResult("fallback");
      }
    } catch {
      setTestResult("fail");
    } finally {
      setTestRunning(false);
    }
  }, [manager]);

  const handleSave = useCallback(async () => {
    const speedNum = Number(speed);
    const clampedSpeed = Math.max(0.5, Math.min(2.0, Number.isFinite(speedNum) ? speedNum : 1.0));
    setSpeed(String(clampedSpeed));

    const pitchNum = Number(pitch);
    const clampedPitch = Math.max(-20, Math.min(20, Number.isFinite(pitchNum) ? pitchNum : 0));
    setPitch(String(clampedPitch));

    const backendNum = Number(backend) || 0;
    setBackend(String(backendNum));

    await Promise.all([
      setSetting("tts_auto", autoRead ? "1" : "0"),
      setSetting("tts_voice", selectedVoiceUri),
      setSetting("tts_speed", String(clampedSpeed)),
      setSetting("tts_pitch", String(clampedPitch)),
      setSetting("tts_backend", String(backendNum)),
    ]);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [autoRead, selectedVoiceUri, speed, pitch, backend]);

  // Group voices by backend for the dropdown
  const webSpeechVoices = voices.filter((v) => v.backend === "web-speech");
  const edgeVoices = voices.filter((v) => v.backend === "edge-tts");

  return (
    <section
      className="rounded-[var(--radius-lg)] border p-5"
      style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-surface)" }}
    >
      <h2 className="mb-1 font-[var(--font-display)] text-lg">{t("tts.title")}</h2>
      <p className="mb-4 text-xs" style={{ color: "var(--color-text-faint)" }}>
        {t("tts.subtitle")}
      </p>

      <div className="flex flex-col gap-4">
        {/* Auto-read toggle */}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={autoRead}
            onChange={(e) => setAutoRead(e.target.checked)}
            className="rounded"
          />
          <span>{t("tts.autoRead")}</span>
          <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>
            {t("tts.autoReadHelp")}
          </span>
        </label>

        {/* Backend selector */}
        <label className="flex flex-col gap-1 text-sm">
          <span>{t("tts.backend")}</span>
          <select
            className="w-72 rounded-[var(--radius-sm)] border px-2 py-1.5"
            style={inputStyle}
            value={backend}
            onChange={(e) => setBackend(e.target.value)}
          >
            <option value="0">{t("tts.backendEdge")}</option>
            <option value="1">{t("tts.backendWebSpeech")}</option>
          </select>
          <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>
            {backend === "0"
              ? t("tts.backendEdgeHelp", "Online — higher quality, needs internet. Falls back to Web Speech on error.")
              : t("tts.backendWebSpeechHelp", "Offline — always works, uses system voices.")}
          </span>
        </label>

        {/* Voice selector */}
        <label className="flex flex-col gap-1 text-sm">
          <span>{t("tts.voice")}</span>
          {voices.length === 0 ? (
            <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>
              {t("tts.noVoices")}
            </span>
          ) : (
            <select
              className="w-72 rounded-[var(--radius-sm)] border px-2 py-1.5"
              style={inputStyle}
              value={selectedVoiceUri}
              onChange={(e) => setSelectedVoiceUri(e.target.value)}
            >
              <option value="">{t("tts.voiceDefault")}</option>
              {edgeVoices.length > 0 && (
                <optgroup label={t("tts.backendEdge")}>
                  {edgeVoices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} ({v.lang})
                    </option>
                  ))}
                </optgroup>
              )}
              {webSpeechVoices.length > 0 && (
                <optgroup label={t("tts.backendWebSpeech")}>
                  {webSpeechVoices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} ({v.lang})
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          )}
        </label>

        {/* Speed slider */}
        <label className="flex flex-col gap-1 text-sm">
          <span>{t("tts.speed")}: {speed}x</span>
          <input
            type="range"
            min="0.5"
            max="2.0"
            step="0.1"
            value={speed}
            onChange={(e) => setSpeed(e.target.value)}
            className="w-56"
          />
        </label>

        {/* Pitch slider */}
        <label className="flex flex-col gap-1 text-sm">
          <span>{t("tts.pitch")}: {pitch} Hz</span>
          <input
            type="range"
            min="-20"
            max="20"
            step="1"
            value={pitch}
            onChange={(e) => setPitch(e.target.value)}
            className="w-56"
          />
          <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>
            {t("tts.pitchHelp")}
          </span>
        </label>
      </div>

      <div className="mt-5 flex items-center gap-4">
        <button
          type="button"
          onClick={() => void handleSave()}
          className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium"
          style={{ backgroundColor: "var(--color-accent)", color: "var(--color-accent-contrast)" }}
        >
          {t("actions.save", { ns: "common" })}
        </button>
        {saved && (
          <span className="text-xs" style={{ color: "var(--color-success)" }}>
            {t("tts.saved")}
          </span>
        )}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => void handleTest()}
          disabled={testRunning}
          className="rounded-[var(--radius-sm)] border px-3 py-1.5 text-sm"
          style={{
            borderColor: "var(--color-border-strong)",
            color: "var(--color-text)",
            backgroundColor: "var(--color-surface-2)",
          }}
        >
          {testRunning ? "…" : t("tts.testButton")}
        </button>
        {testResult === "ok" && (
          <span className="text-xs" style={{ color: "var(--color-success)" }}>
            {t("tts.testOk")}
          </span>
        )}
        {testResult === "fallback" && (
          <span className="text-xs" style={{ color: "var(--color-warning)" }}>
            {t("tts.testFallback")}
          </span>
        )}
        {testResult === "fail" && (
          <span className="text-xs" style={{ color: "var(--color-danger)" }}>
            {t("tts.testFail")}
          </span>
        )}
      </div>
    </section>
  );
}
