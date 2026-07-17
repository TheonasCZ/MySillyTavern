/** Director settings (M25.3): per-chat pacing/tone/focus steering that the
 * player adjusts casually next to the chat. Stored as one JSON blob in the
 * settings table; rendered into a short `[REŽIE SCÉNY]` block near the end
 * of the prompt by `buildPrompt` (input `directorNote`). */

import { getSetting, setSetting } from "../db/repositories/settingsRepo";

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
  slow: "Zpomal tempo — rozehrávej scény do detailu, dej prostor atmosféře a rozhovorům, neposouvej děj o víc než jeden krok najednou.",
  normal: "",
  fast: "Drž svižné tempo — kratší popisy, rychlejší střihy mezi událostmi, děj se hýbe každou odpovědí.",
};

const TONE_NOTES: Record<DirectorTone, string> = {
  light: "Tón drž odlehčený a hravý; humor je vítaný, ponurost jen výjimečně.",
  neutral: "",
  dark: "Tón drž temný a vážný; svět je nebezpečný, činy mají následky, humor jen střídmě.",
  epic: "Tón drž epický a vznešený; velká gesta, vysoké sázky, patos je na místě.",
};

const FOCUS_NOTES: Record<DirectorFocus, string> = {
  dialogue: "Těžiště scén polož do rozhovorů a vztahů mezi postavami.",
  balanced: "",
  action: "Těžiště scén polož do akce — souboje, honičky, fyzické překážky.",
  exploration: "Těžiště scén polož do objevování — prostředí, záhady, nálezy.",
};

/** Renders the settings into the prompt note; returns "" when everything is
 * at defaults so the section is skipped entirely. */
export function buildDirectorNote(settings: DirectorSettings): string {
  const lines = [
    PACE_NOTES[settings.pace],
    TONE_NOTES[settings.tone],
    FOCUS_NOTES[settings.focus],
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
