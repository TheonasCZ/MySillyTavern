import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { getSetting, setSetting } from "../../db/repositories/settingsRepo";

const inputStyle = {
  backgroundColor: "var(--color-surface-2)",
  borderColor: "var(--color-border-strong)",
  color: "var(--color-text)",
} as const;

export function TtsPanel() {
  const { t } = useTranslation("settings");
  const [autoRead, setAutoRead] = useState(false);
  const [selectedVoiceUri, setSelectedVoiceUri] = useState("");
  const [speed, setSpeed] = useState("1.0");
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void (async () => {
      const [auto, voice, spd] = await Promise.all([
        getSetting("tts_auto"),
        getSetting("tts_voice"),
        getSetting("tts_speed"),
      ]);
      if (auto) setAutoRead(auto === "1");
      if (voice) setSelectedVoiceUri(voice);
      if (spd) setSpeed(spd);
    })();
  }, []);

  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const populate = () => setVoices(synth.getVoices());
    populate();
    synth.addEventListener("voiceschanged", populate);
    return () => synth.removeEventListener("voiceschanged", populate);
  }, []);

  const handleSave = async () => {
    const speedNum = Number(speed);
    const clamped = Math.max(0.5, Math.min(2.0, Number.isFinite(speedNum) ? speedNum : 1.0));
    setSpeed(String(clamped));
    await Promise.all([
      setSetting("tts_auto", autoRead ? "1" : "0"),
      setSetting("tts_voice", selectedVoiceUri),
      setSetting("tts_speed", String(clamped)),
    ]);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

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
              {voices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name} ({v.lang})
                </option>
              ))}
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
    </section>
  );
}
