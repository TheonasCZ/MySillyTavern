// One-shot backfill: pushes all existing local data into the sync journal.
//
// Normal sync only journals *future* writes (see syncJournal.ts) — a device
// that enables sync after already having months of chats/characters/
// settings never automatically backfills that history, since nothing ever
// re-touches those old rows. This is the explicit "Export vše" action for
// that: walk everything once and journal it, so a fresh second device can
// pick it all up on its next sync.

import { nowIso } from "./database";
import { listAllChatMembers } from "./repositories/chatMembersRepo";
import { listCalendarEvents } from "./repositories/calendarEventsRepo";
import { listCharacters } from "./repositories/charactersRepo";
import { listChats } from "./repositories/chatsRepo";
import { listConnections } from "./repositories/connectionsRepo";
import { pushAllLocalSecretsToSync } from "./repositories/connectionSecretsRepo";
import { listAllFacts } from "./repositories/ledgerRepo";
import { listEntries, listLorebooks } from "./repositories/lorebooksRepo";
import { listMessageRowsForSyncExport } from "./repositories/messagesRepo";
import { listPersonas } from "./repositories/personasRepo";
import { listPresets } from "./repositories/presetsRepo";
import { listQuests } from "./repositories/questsRepo";
import { getAllSettings, SYNC_EXCLUDED_SETTINGS } from "./repositories/settingsRepo";
import { getSummary } from "./repositories/summariesRepo";
import { journalEntityWrite } from "./syncJournal";

/**
 * Journals every existing local entity, chat-scoped data included. Safe to
 * run repeatedly — everything downstream is either LWW-by-`updated_at`
 * (won't regress a newer edit made on another device in the meantime) or
 * idempotent upsert (chat members, calendar events, lore entries).
 *
 * Writes are awaited sequentially rather than fired concurrently — this can
 * loop over thousands of rows (every message in every chat), and
 * `syncJournal.ts` tracks the current journal file/size as shared module
 * state that isn't safe under a flood of concurrent unawaited appends.
 */
export async function exportAllToSync(): Promise<void> {
  const now = nowIso();

  for (const character of await listCharacters()) {
    await journalEntityWrite("character", character as unknown as Record<string, unknown>);
  }
  for (const persona of await listPersonas()) {
    await journalEntityWrite("persona", persona as unknown as Record<string, unknown>);
  }
  for (const preset of await listPresets()) {
    await journalEntityWrite("preset", preset as unknown as Record<string, unknown>);
  }
  for (const connection of await listConnections()) {
    await journalEntityWrite("connection", connection as unknown as Record<string, unknown>);
  }
  for (const lorebook of await listLorebooks()) {
    await journalEntityWrite("lorebook", lorebook as unknown as Record<string, unknown>);
    for (const lore of await listEntries(lorebook.id)) {
      await journalEntityWrite("lorebook", { ...lore, _entry_type: "lore_entry" } as unknown as Record<string, unknown>);
    }
  }

  for (const member of await listAllChatMembers()) {
    await journalEntityWrite("chatMember", member as unknown as Record<string, unknown>);
  }

  for (const chat of await listChats()) {
    await journalEntityWrite("chat", chat as unknown as Record<string, unknown>);

    for (const row of await listMessageRowsForSyncExport(chat.id)) {
      await journalEntityWrite("message", row);
    }
    for (const fact of await listAllFacts(chat.id)) {
      await journalEntityWrite("fact", fact as unknown as Record<string, unknown>);
    }
    const summary = await getSummary(chat.id);
    if (summary) {
      await journalEntityWrite("summary", summary as unknown as Record<string, unknown>);
    }
    for (const quest of await listQuests(chat.id)) {
      await journalEntityWrite("quest", quest as unknown as Record<string, unknown>);
    }
    for (const event of await listCalendarEvents(chat.id)) {
      await journalEntityWrite("calendarEvent", event as unknown as Record<string, unknown>);
    }
  }

  const settings = await getAllSettings();
  for (const [key, value] of Object.entries(settings)) {
    if (SYNC_EXCLUDED_SETTINGS.has(key)) continue;
    await journalEntityWrite("setting", { key, value, updated_at: now });
  }

  // API keys — separate flow since it needs a Rust round-trip per
  // connection to encrypt (no-ops per key if no sync passphrase is set).
  await pushAllLocalSecretsToSync();
}
