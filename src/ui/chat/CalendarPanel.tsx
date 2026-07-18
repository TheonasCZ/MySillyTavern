import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { CalendarDate } from "../../memory/calendar";
import {
  formatCalendarDate,
  timeIcon as timeIconFn,
  seasonIcon,
  weatherIcon,
  dayPeriod,
  MONTHS,
} from "../../memory/calendar";
import type { CalendarEvent } from "../../db/repositories/calendarEventsRepo";

export interface CalendarEventDraft {
  title: string;
  day: number;
  monthName: string;
  description: string;
}

interface Props {
  calendarDate: CalendarDate;
  weather: string;
  events: CalendarEvent[];
  onClose: () => void;
  onAddEvent: (draft: CalendarEventDraft) => void;
  onDeleteEvent: (id: string) => void;
}

/** Mini month calendar: 6×5 grid of 30 days. */
function MiniMonthGrid({
  currentDay,
  monthName,
}: {
  currentDay: number;
  monthName: string;
}) {
  const days = Array.from({ length: 30 }, (_, i) => i + 1);
  return (
    <div className="mt-2">
      <div className="mb-1 text-center text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
        {monthName}
      </div>
      <div className="grid grid-cols-6 gap-0.5">
        {days.map((d) => (
          <div
            key={d}
            className="flex h-6 w-6 items-center justify-center rounded text-[0.65rem]"
            style={{
              backgroundColor: d === currentDay ? "var(--color-accent)" : "transparent",
              color: d === currentDay ? "var(--color-accent-contrast)" : "var(--color-text-muted)",
              fontWeight: d === currentDay ? 700 : 400,
            }}
          >
            {d}
          </div>
        ))}
      </div>
    </div>
  );
}

export function CalendarPanel({
  calendarDate,
  weather,
  events,
  onClose,
  onAddEvent,
  onDeleteEvent,
}: Props) {
  const { t } = useTranslation("chat");
  const [showAddForm, setShowAddForm] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDay, setDraftDay] = useState(calendarDate.day);
  const [draftMonth, setDraftMonth] = useState(calendarDate.month);
  const [draftDesc, setDraftDesc] = useState("");

  const period = dayPeriod(calendarDate.hourOfDay);
  const tIcon = timeIconFn(calendarDate.hourOfDay);
  const sIcon = seasonIcon(calendarDate.season);

  const handleAdd = () => {
    if (!draftTitle.trim()) return;
    onAddEvent({
      title: draftTitle.trim(),
      day: draftDay,
      monthName: draftMonth,
      description: draftDesc.trim(),
    });
    setDraftTitle("");
    setDraftDesc("");
    setShowAddForm(false);
  };

  // Filter events for current month + next month
  const currentMonthIdx = MONTHS.findIndex((m) => m.genitive === calendarDate.month);
  const nextMonthIdx = (currentMonthIdx + 1) % MONTHS.length;
  const upcomingEvents = events.filter((e) => {
    if (e.monthName === calendarDate.month && e.day >= calendarDate.day) return true;
    if (e.monthName === MONTHS[nextMonthIdx].genitive) return true;
    return false;
  }).sort((a, b) => {
    const aIdx = MONTHS.findIndex((m) => m.genitive === a.monthName);
    const bIdx = MONTHS.findIndex((m) => m.genitive === b.monthName);
    if (aIdx !== bIdx) return aIdx - bIdx;
    return a.day - b.day;
  });

  return (
    <aside
      className="flex h-full w-72 shrink-0 flex-col border-l"
      style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-surface)" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2" style={{ borderColor: "var(--color-border)" }}>
        <h3 className="font-[var(--font-display)] text-sm">
          {t("calendar.title", "Kalendář")}
        </h3>
        <button onClick={onClose} className="text-xs" style={{ color: "var(--color-text-faint)" }}>
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Current date/time */}
        <div className="rounded-[var(--radius-md)] border p-3" style={{ borderColor: "var(--color-border-strong)", backgroundColor: "var(--color-bg-elevated)" }}>
          <div className="text-center">
            <span className="text-3xl">{tIcon}</span>
            <div className="text-lg font-[var(--font-display)] mt-1">
              {calendarDate.hourOfDay}h — {period}
            </div>
            <div className="text-sm mt-0.5" style={{ color: "var(--color-text-muted)" }}>
              {formatCalendarDate(calendarDate)}
            </div>
            <div className="text-xs mt-1">
              {sIcon} {calendarDate.season}
            </div>
          </div>
        </div>

        {/* Weather */}
        <div className="rounded-[var(--radius-md)] border p-3" style={{ borderColor: "var(--color-border-strong)", backgroundColor: "var(--color-bg-elevated)" }}>
          <div className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
            {t("calendar.weather", "Počasí")}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-2xl">{weatherIcon(weather)}</span>
            <span className="text-sm">{weather}</span>
          </div>
        </div>

        {/* Mini month calendar */}
        <MiniMonthGrid currentDay={calendarDate.day} monthName={calendarDate.month} />

        {/* Upcoming events */}
        <div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
              {t("calendar.upcoming", "Nadcházející události")}
            </span>
            <button
              type="button"
              onClick={() => setShowAddForm((v) => !v)}
              className="rounded-[var(--radius-sm)] px-1.5 py-0.5 text-xs"
              style={{ backgroundColor: "var(--color-accent)", color: "var(--color-accent-contrast)" }}
            >
              + {t("calendar.addEvent", "Přidat")}
            </button>
          </div>

          {showAddForm && (
            <div className="mt-2 rounded-[var(--radius-sm)] border p-2 space-y-2" style={{ borderColor: "var(--color-border-strong)" }}>
              <input
                type="text"
                placeholder={t("calendar.eventTitle", "Název události")}
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                className="w-full rounded-[var(--radius-sm)] border px-2 py-1 text-xs"
                style={{ borderColor: "var(--color-border-strong)", backgroundColor: "var(--color-surface-2)", color: "var(--color-text)" }}
              />
              <div className="flex gap-2">
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={draftDay}
                  onChange={(e) => setDraftDay(Number(e.target.value))}
                  className="w-14 rounded-[var(--radius-sm)] border px-2 py-1 text-xs"
                  style={{ borderColor: "var(--color-border-strong)", backgroundColor: "var(--color-surface-2)", color: "var(--color-text)" }}
                  title={t("calendar.day", "Den")}
                />
                <select
                  value={draftMonth}
                  onChange={(e) => setDraftMonth(e.target.value)}
                  className="flex-1 rounded-[var(--radius-sm)] border px-2 py-1 text-xs"
                  style={{ borderColor: "var(--color-border-strong)", backgroundColor: "var(--color-surface-2)", color: "var(--color-text)" }}
                >
                  {MONTHS.map((m) => (
                    <option key={m.genitive} value={m.genitive}>{m.name}</option>
                  ))}
                </select>
              </div>
              <input
                type="text"
                placeholder={t("calendar.eventDesc", "Popis (volitelné)")}
                value={draftDesc}
                onChange={(e) => setDraftDesc(e.target.value)}
                className="w-full rounded-[var(--radius-sm)] border px-2 py-1 text-xs"
                style={{ borderColor: "var(--color-border-strong)", backgroundColor: "var(--color-surface-2)", color: "var(--color-text)" }}
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="rounded-[var(--radius-sm)] px-2 py-0.5 text-xs"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  {t("calendar.cancel", "Zrušit")}
                </button>
                <button
                  type="button"
                  onClick={handleAdd}
                  disabled={!draftTitle.trim()}
                  className="rounded-[var(--radius-sm)] px-2 py-0.5 text-xs"
                  style={{
                    backgroundColor: draftTitle.trim() ? "var(--color-accent)" : "var(--color-surface-2)",
                    color: draftTitle.trim() ? "var(--color-accent-contrast)" : "var(--color-text-faint)",
                  }}
                >
                  {t("calendar.save", "Uložit")}
                </button>
              </div>
            </div>
          )}

          {upcomingEvents.length === 0 ? (
            <p className="mt-2 text-xs" style={{ color: "var(--color-text-faint)" }}>
              {t("calendar.noEvents", "Žádné nadcházející události.")}
            </p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {upcomingEvents.map((ev) => (
                <li
                  key={ev.id}
                  className="flex items-start gap-2 rounded-[var(--radius-sm)] p-1.5 group"
                  style={{ backgroundColor: "var(--color-surface-2)" }}
                >
                  <span className="text-lg shrink-0">{ev.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-medium truncate">{ev.title}</span>
                      <button
                        type="button"
                        onClick={() => onDeleteEvent(ev.id)}
                        className="shrink-0 opacity-0 group-hover:opacity-100 text-xs transition-opacity"
                        style={{ color: "var(--color-text-faint)" }}
                        title={t("calendar.delete", "Smazat")}
                      >
                        ✕
                      </button>
                    </div>
                    <div className="text-[0.65rem]" style={{ color: "var(--color-text-faint)" }}>
                      {ev.day}. {ev.monthName}
                    </div>
                    {ev.description && (
                      <div className="text-[0.65rem] mt-0.5" style={{ color: "var(--color-text-muted)" }}>
                        {ev.description}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </aside>
  );
}
