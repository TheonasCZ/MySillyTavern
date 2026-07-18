/** Director settings (M25.3): per-chat pacing/tone/focus steering that the
 * player adjusts casually next to the chat. Stored as one JSON blob in the
 * settings table; rendered into a short `[REŽIE SCÉNY]` block near the end
 * of the prompt by `buildPrompt` (input `directorNote`). */

import { getSetting, setSetting } from "../db/repositories/settingsRepo";
import { DIRECTOR_PACE, DIRECTOR_TONE, DIRECTOR_FOCUS, DIRECTOR_HARDCORE_NOTE } from "../prompt/promptTexts";

export type DirectorPace = "slow" | "normal" | "fast";
export type DirectorTone = "light" | "neutral" | "dark" | "epic";
export type DirectorFocus = "dialogue" | "balanced" | "action" | "exploration";

export interface DirectorSettings {
  pace: DirectorPace;
  tone: DirectorTone;
  focus: DirectorFocus;
  /** Free-form extra instruction ("" = none). */
  extra: string;
}

export function defaultDirectorSettings(): DirectorSettings {
  return { pace: "normal", tone: "neutral", focus: "balanced", extra: "" };
}

const PACE_NOTES: Record<DirectorPace, string> = {
  slow: DIRECTOR_PACE.slow,
  normal: DIRECTOR_PACE.normal,
  fast: DIRECTOR_PACE.fast,
};

const TONE_NOTES: Record<DirectorTone, string> = {
  light: DIRECTOR_TONE.light,
  neutral: DIRECTOR_TONE.neutral,
  dark: DIRECTOR_TONE.dark,
  epic: DIRECTOR_TONE.epic,
};

const FOCUS_NOTES: Record<DirectorFocus, string> = {
  dialogue: DIRECTOR_FOCUS.dialogue,
  balanced: DIRECTOR_FOCUS.balanced,
  action: DIRECTOR_FOCUS.action,
  exploration: DIRECTOR_FOCUS.exploration,
};

/** Renders the settings into the prompt note; returns "" when everything is
 * at defaults so the section is skipped entirely. Hardcore mode is a
 * chat-level property (set at chat creation, see chatsRepo.ts), not a
 * Director setting, so it's passed in separately rather than living on
 * `settings`. */
export function buildDirectorNote(settings: DirectorSettings, hardcoreMode = false): string {
  const lines = [
    PACE_NOTES[settings.pace],
    TONE_NOTES[settings.tone],
    FOCUS_NOTES[settings.focus],
    hardcoreMode ? DIRECTOR_HARDCORE_NOTE : "",
    settings.extra.trim(),
  ].filter(Boolean);
  return lines.join("\n");
}

const directorKey = (chatId: string) => `director_${chatId}`;

const PACES: DirectorPace[] = ["slow", "normal", "fast"];
const TONES: DirectorTone[] = ["light", "neutral", "dark", "epic"];
const FOCUSES: DirectorFocus[] = ["dialogue", "balanced", "action", "exploration"];

export async function getDirectorSettings(chatId: string): Promise<DirectorSettings> {
  try {
    const raw = await getSetting(directorKey(chatId));
    if (!raw) return defaultDirectorSettings();
    const parsed = JSON.parse(raw) as Partial<DirectorSettings>;
    return {
      pace: PACES.includes(parsed.pace as DirectorPace) ? (parsed.pace as DirectorPace) : "normal",
      tone: TONES.includes(parsed.tone as DirectorTone) ? (parsed.tone as DirectorTone) : "neutral",
      focus: FOCUSES.includes(parsed.focus as DirectorFocus)
        ? (parsed.focus as DirectorFocus)
        : "balanced",
      extra: typeof parsed.extra === "string" ? parsed.extra : "",
    };
  } catch {
    return defaultDirectorSettings();
  }
}

export async function saveDirectorSettings(
  chatId: string,
  settings: DirectorSettings,
): Promise<void> {
  await setSetting(directorKey(chatId), JSON.stringify(settings));
}
