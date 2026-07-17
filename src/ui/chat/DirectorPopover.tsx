import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  defaultDirectorSettings,
  getDirectorSettings,
  saveDirectorSettings,
  type DirectorFocus,
  type DirectorPace,
  type DirectorSettings,
  type DirectorTone,
} from "../../chat/director";

const selectStyle = {
  backgroundColor: "var(--color-surface-2)",
  borderColor: "var(--color-border-strong)",
  color: "var(--color-text)",
} as const;

const PACES: DirectorPace[] = ["slow", "normal", "fast"];
const TONES: DirectorTone[] = ["light", "neutral", "dark", "epic"];
const FOCUSES: DirectorFocus[] = ["dialogue", "balanced", "action", "exploration"];

/** Director popover (M25.3): pace/tone/focus per chat. Saves on every
 * change — the next sent message picks the settings up automatically. */
export function DirectorPopover({ chatId, onClose }: { chatId: string; onClose: () => void }) {
  const { t } = useTranslation("chat");
  const [settings, setSettings] = useState<DirectorSettings>(defaultDirectorSettings());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void getDirectorSettings(chatId).then((s) => {
      setSettings(s);
      setLoaded(true);
    });
  }, [chatId]);

  const patch = (p: Partial<DirectorSettings>) => {
    const next = { ...settings, ...p };
    setSettings(next);
    void saveDirectorSettings(chatId, next);
  };

  if (!loaded) return null;

  return (
    <div
      className="absolute right-2 top-12 z-20 flex w-72 flex-col gap-3 rounded-[var(--radius-md)] border p-4 shadow-lg"
      style={{
        borderColor: "var(--color-border-strong)",
        backgroundColor: "var(--color-bg-elevated)",
        boxShadow: "var(--shadow-panel)",
      }}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">{t("director.title")}</h3>
        <button
          type="button"
          onClick={onClose}
          className="text-xs"
          style={{ color: "var(--color-text-faint)" }}
        >
          ✕
        </button>
      </div>
      <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>
        {t("director.hint")}
      </p>

      <label className="flex flex-col gap-1 text-xs">
        <span>{t("director.pace")}</span>
        <select
          className="rounded-[var(--radius-sm)] border px-2 py-1"
          style={selectStyle}
          value={settings.pace}
          onChange={(e) => patch({ pace: e.target.value as DirectorPace })}
        >
          {PACES.map((p) => (
            <option key={p} value={p}>
              {t(`director.paces.${p}`)}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs">
        <span>{t("director.tone")}</span>
        <select
          className="rounded-[var(--radius-sm)] border px-2 py-1"
          style={selectStyle}
          value={settings.tone}
          onChange={(e) => patch({ tone: e.target.value as DirectorTone })}
        >
          {TONES.map((tone) => (
            <option key={tone} value={tone}>
              {t(`director.tones.${tone}`)}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs">
        <span>{t("director.focus")}</span>
        <select
          className="rounded-[var(--radius-sm)] border px-2 py-1"
          style={selectStyle}
          value={settings.focus}
          onChange={(e) => patch({ focus: e.target.value as DirectorFocus })}
        >
          {FOCUSES.map((f) => (
            <option key={f} value={f}>
              {t(`director.focuses.${f}`)}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs">
        <span>{t("director.extra")}</span>
        <textarea
          className="min-h-16 rounded-[var(--radius-sm)] border px-2 py-1"
          style={selectStyle}
          value={settings.extra}
          onChange={(e) => patch({ extra: e.target.value })}
          placeholder={t("director.extraPlaceholder") ?? ""}
        />
      </label>
    </div>
  );
}
