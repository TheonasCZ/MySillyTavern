// Sync journal format — see PLAN.md §M14.
// Journal lines are immutable facts about what happened.
// Merger: messages append-only, everything else last-write-wins by timestamp.

export type JournalEntityType =
  | "message"
  | "chat"
  | "fact"
  | "summary"
  | "character"
  | "persona"
  | "preset"
  | "lorebook"
  | "quest";

export type JournalAction = "upsert" | "delete";

export interface JournalEntry {
  type: JournalEntityType;
  action: JournalAction;
  ts: string; // ISO 8601 UTC
  entity: Record<string, unknown>; // full row data
}

/** Parsed journal line + its byte offset within the source file (used for
 *  position tracking in syncReader). */
export interface JournalLine {
  entry: JournalEntry;
  byteOffset: number;
}
