import { useEffect, useRef, useState } from "react";

import { getCalendarSetting } from "../../db/repositories/settingsRepo";
import {
  calendarFromJSON,
  type CalendarDate,
} from "../../memory/calendar";
import type { CalendarEvent } from "../../db/repositories/calendarEventsRepo";
import {
  listCalendarEvents,
  createCalendarEvent,
  deleteCalendarEvent,
} from "../../db/repositories/calendarEventsRepo";

/** Calendar date/weather/events state for a chat, plus the two effects that
 * keep it in sync: initial load on chat change, and a re-sync once game-tag
 * processing has actually landed. `calendarVersion` (bumped by
 * `refreshChatState` in chatStore.ts) is used instead of `messages.length`
 * because the DB write from `advanceAndPersistCalendar` happens async,
 * after the AI-tag extractor round-trip — keying off message count alone
 * re-fetches too early and freezes the display on the stale pre-advance
 * time (see 2026-07-30 report: clock stuck at 06:00 despite the DB
 * already holding 09:15). */
export function useChatCalendar(id: string | undefined, calendarVersion: number) {
  const [calendarDate, setCalendarDate] = useState<CalendarDate | null>(null);
  const [weather, setWeather] = useState<string>("jasno");
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);

  // Load calendar date, weather, and events for this chat
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void (async () => {
      let loadedDate: CalendarDate | null = null;
      try {
        const raw = await getCalendarSetting(id);
        if (cancelled) return;
        loadedDate = raw ? calendarFromJSON(raw) : null;
        setCalendarDate(loadedDate);
      } catch {
        if (!cancelled) setCalendarDate(null);
      }
      // Load weather from localStorage, initialize if missing
      try {
        const storedWeather = localStorage.getItem(`weather_${id}`);
        if (!cancelled && storedWeather) {
          setWeather(storedWeather);
        } else if (!cancelled && loadedDate) {
          // Initialize weather based on season
          const seasonMap: Record<string, string> = {
            "Jaro": "polojasno", "Léto": "jasno", "Podzim": "zataženo", "Zima": "zataženo",
          };
          const initial = seasonMap[loadedDate.season] ?? "jasno";
          setWeather(initial);
          localStorage.setItem(`weather_${id}`, initial);
        }
      } catch { /* noop */ }
      // Load calendar events
      try {
        const evts = await listCalendarEvents(id);
        if (!cancelled) setCalendarEvents(evts);
      } catch { /* noop */ }
    })();
    return () => { cancelled = true; };
  }, [id]);

  // Keep the calendar date in sync once game-tag processing lands.
  const prevVersionRef = useRef(calendarVersion);
  useEffect(() => {
    if (!id || calendarVersion <= prevVersionRef.current) {
      prevVersionRef.current = calendarVersion;
      return;
    }
    prevVersionRef.current = calendarVersion;
    let cancelled = false;
    void (async () => {
      try {
        const raw = await getCalendarSetting(id);
        if (cancelled) return;
        const loadedDate = raw ? calendarFromJSON(raw) : null;
        if (loadedDate) setCalendarDate(loadedDate);
      } catch { /* noop */ }
      // Weather is stored in localStorage — re-read in case it was
      // re-rolled by the calendar advance (see weather.ts).
      try {
        const storedWeather = localStorage.getItem(`weather_${id}`);
        if (!cancelled && storedWeather) setWeather(storedWeather);
      } catch { /* noop */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, calendarVersion]);

  const addEvent = (draft: { day: number; monthName: string; title: string; description: string }) => {
    if (!id || !calendarDate) return;
    void (async () => {
      const ev = {
        id: crypto.randomUUID(),
        chatId: id,
        day: draft.day,
        monthName: draft.monthName,
        year: calendarDate.year,
        title: draft.title,
        description: draft.description,
        icon: "📅",
      };
      await createCalendarEvent(ev);
      const updated = await listCalendarEvents(id);
      setCalendarEvents(updated);
    })();
  };

  const deleteEvent = (eventId: string) => {
    void (async () => {
      await deleteCalendarEvent(eventId);
      setCalendarEvents((prev) => prev.filter((e) => e.id !== eventId));
    })();
  };

  return { calendarDate, weather, calendarEvents, addEvent, deleteEvent };
}
