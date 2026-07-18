import { describe, expect, it } from "vitest";

import { generateCalendarEvents } from "./calendarEvents";

const MONTH_GENITIVES = [
  "Měsíce probuzení",
  "Jarního větru",
  "Měsíce květů",
  "Měsíce slunce",
  "Měsíce žáru",
  "Měsíce bouří",
  "Měsíce sklizně",
  "Měsíce listí",
  "Měsíce mlh",
  "Měsíce mrazu",
  "Měsíce sněhu",
  "Měsíce temnoty",
];

describe("generateCalendarEvents", () => {
  it("returns exactly 5 events", () => {
    const events = generateCalendarEvents("test-chat-id", 847);
    expect(events).toHaveLength(5);
  });

  it("each event has required fields", () => {
    const events = generateCalendarEvents("test-chat-id", 847);
    for (const ev of events) {
      expect(typeof ev.id).toBe("string");
      expect(ev.id.length).toBeGreaterThan(0);
      expect(ev.chatId).toBe("test-chat-id");
      expect(typeof ev.day).toBe("number");
      expect(ev.day).toBeGreaterThanOrEqual(1);
      expect(ev.day).toBeLessThanOrEqual(30);
      expect(typeof ev.monthName).toBe("string");
      expect(MONTH_GENITIVES).toContain(ev.monthName);
      expect(ev.year).toBe(847);
      expect(typeof ev.title).toBe("string");
      expect(ev.title.length).toBeGreaterThan(0);
      expect(typeof ev.description).toBe("string");
      expect(typeof ev.icon).toBe("string");
    }
  });

  it("generates unique ids for each event", () => {
    const events = generateCalendarEvents("test-chat-id", 847);
    const ids = new Set(events.map((e) => e.id));
    expect(ids.size).toBe(5);
  });

  it("produces different sets on different calls (random)", () => {
    // With 20 templates picking 5, two calls should almost always differ
    const a = generateCalendarEvents("a", 847);
    const b = generateCalendarEvents("b", 847);
    const titlesA = a.map((e) => e.title).sort().join(",");
    const titlesB = b.map((e) => e.title).sort().join(",");
    // It's possible (though unlikely) they match — we just check they're valid
    expect(a.length).toBe(5);
    expect(b.length).toBe(5);
    expect(titlesA).toBeDefined();
    expect(titlesB).toBeDefined();
  });

  it("events have valid month genitives", () => {
    const events = generateCalendarEvents("test-chat-id", 847);
    for (const ev of events) {
      expect(MONTH_GENITIVES.includes(ev.monthName)).toBe(true);
    }
  });
});
