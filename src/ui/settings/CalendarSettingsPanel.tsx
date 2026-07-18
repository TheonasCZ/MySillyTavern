import { useTranslation } from "react-i18next";

import { useSettingsStore } from "../../stores/settingsStore";
import type { CalendarMode } from "../../memory/calendar";
import { FieldHelp } from "../common/FieldHelp";

/** Global toggle for how in-game dates are displayed: the campaign's fantasy
 * month names, or plain real-world months — a player-legibility preference,
 * not a per-chat setting, so it lives in the calendar/season/weather info
 * shown in the chat header, the calendar side panel, and the AI's date
 * prompt block all read from the same place. */
export function CalendarSettingsPanel() {
  const { t } = useTranslation("settings");
  const calendarMode = useSettingsStore((s) => s.calendarMode);
  const setCalendarMode = useSettingsStore((s) => s.setCalendarMode);

  const options: { value: CalendarMode; labelKey: string; helpKey: string }[] = [
    { value: "fantasy", labelKey: "calendar.fantasy", helpKey: "calendar.fantasyHelp" },
    { value: "real", labelKey: "calendar.real", helpKey: "calendar.realHelp" },
  ];

  return (
    <section
      className="rounded-[var(--radius-lg)] border p-5"
      style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-surface)" }}
    >
      <h2 className="mb-1 font-[var(--font-display)] text-lg">{t("calendar.title")}</h2>
      <p className="mb-4 text-xs" style={{ color: "var(--color-text-faint)" }}>
        {t("calendar.subtitle")}
      </p>

      <div className="flex flex-col gap-2 sm:flex-row sm:gap-6">
        {options.map(({ value, labelKey, helpKey }) => (
          <label key={value} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="calendar-mode"
              checked={calendarMode === value}
              onChange={() => void setCalendarMode(value)}
              className="rounded"
            />
            <span className="flex items-center gap-1">
              {t(labelKey)}
              <FieldHelp text={t(helpKey)} />
            </span>
          </label>
        ))}
      </div>
    </section>
  );
}
