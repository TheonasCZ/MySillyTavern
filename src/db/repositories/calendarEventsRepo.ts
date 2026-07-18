import { execute, nowIso, query } from "../database";

export interface CalendarEvent {
  id: string;
  chatId: string;
  day: number;
  monthName: string;
  year: number;
  title: string;
  description: string;
  icon: string;
  createdAt: string;
}

interface CalendarEventRow {
  id: string;
  chat_id: string;
  day: number;
  month_name: string;
  year: number;
  title: string;
  description: string;
  icon: string;
  created_at: string;
}

function toEvent(row: CalendarEventRow): CalendarEvent {
  return {
    id: row.id,
    chatId: row.chat_id,
    day: row.day,
    monthName: row.month_name,
    year: row.year,
    title: row.title,
    description: row.description,
    icon: row.icon,
    createdAt: row.created_at,
  };
}

export interface CreateCalendarEventInput {
  id: string;
  chatId: string;
  day: number;
  monthName: string;
  year: number;
  title: string;
  description: string;
  icon: string;
}

/** Insert a calendar event. */
export async function createCalendarEvent(input: CreateCalendarEventInput): Promise<void> {
  await execute(
    `INSERT INTO calendar_events (id, chat_id, day, month_name, year, title, description, icon, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      input.id,
      input.chatId,
      input.day,
      input.monthName,
      input.year,
      input.title,
      input.description,
      input.icon,
      nowIso(),
    ],
  );
}

/** List all calendar events for a chat, ordered by month and day. */
export async function listCalendarEvents(chatId: string): Promise<CalendarEvent[]> {
  const rows = await query<CalendarEventRow>(
    `SELECT * FROM calendar_events WHERE chat_id = $1
     ORDER BY year ASC, month_name ASC, day ASC`,
    [chatId],
  );
  return rows.map(toEvent);
}

/** Delete a calendar event by id. */
export async function deleteCalendarEvent(id: string): Promise<void> {
  await execute("DELETE FROM calendar_events WHERE id = $1", [id]);
}
