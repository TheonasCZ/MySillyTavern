/** Structured, colorized entries for Message.changeSummary — built in
 *  inventoryProcessor.ts, serialized to JSON for storage (messagesRepo.ts
 *  treats it as an opaque string), parsed back for display in
 *  MessageBubble.tsx. Never sent to the model. */

export type ChangeSummaryKind = "add" | "remove" | "update" | "neutral";

export interface ChangeSummaryEntry {
  text: string;
  kind: ChangeSummaryKind;
}

export function serializeChangeSummary(entries: ChangeSummaryEntry[]): string | null {
  return entries.length > 0 ? JSON.stringify(entries) : null;
}

/** Parses a stored change summary back into entries. Falls back to a single
 *  neutral entry for anything that isn't valid JSON (e.g. a plain string
 *  stored by an older build, before entries were structured) so old
 *  messages still render instead of showing nothing. */
export function parseChangeSummary(raw: string | null): ChangeSummaryEntry[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (e): e is ChangeSummaryEntry =>
          typeof e === "object" && e !== null &&
          typeof (e as ChangeSummaryEntry).text === "string" &&
          typeof (e as ChangeSummaryEntry).kind === "string",
      );
    }
  } catch {
    // Legacy plain-text summary (pre-colorization) — show as-is, neutral.
  }
  return [{ text: raw, kind: "neutral" }];
}
