import { invoke } from "@tauri-apps/api/core";
import { saveDialog } from "../platform";

import { query } from "../db/database";
import type { Chat } from "../db/repositories/chatsRepo";
import { listAllFacts } from "../db/repositories/ledgerRepo";
import type { Lorebook, LoreEntry } from "../db/repositories/lorebooksRepo";
import { getLorebook, listEntries } from "../db/repositories/lorebooksRepo";
import { listMessages } from "../db/repositories/messagesRepo";
import { listQuests } from "../db/repositories/questsRepo";
import { getSummary } from "../db/repositories/summariesRepo";

interface CampaignExportInput {
  chat_title: string;
  chat_json: string;
  ledger_json: string;
  summary_json: string | null;
  quests_json: string;
  lorebooks_json: string;
  chronicle_html: string | null;
}

/** Returns lorebook IDs linked to a specific chat. */
async function getLinkedLorebookIds(chatId: string): Promise<string[]> {
  const rows = await query<{ lorebook_id: string }>(
    `SELECT lorebook_id FROM lorebook_links
     WHERE target_type = 'chat' AND target_id = $1`,
    [chatId],
  );
  return rows.map((r) => r.lorebook_id);
}

/** Gathers all data for a chat and passes it to Rust for ZIP creation. */
export async function exportCampaignToZip(
  chat: Chat,
  outPath: string,
): Promise<string> {
  // Gather data in parallel
  const [messages, facts, summary, quests, linkedLorebookIds] = await Promise.all([
    listMessages(chat.id),
    listAllFacts(chat.id),
    getSummary(chat.id),
    listQuests(chat.id),
    getLinkedLorebookIds(chat.id),
  ]);

  // Build lorebooks array with entries
  const lorebooks: Array<Lorebook & { entries: LoreEntry[] }> = [];
  for (const lbId of linkedLorebookIds) {
    const [lb, entries] = await Promise.all([
      getLorebook(lbId),
      listEntries(lbId),
    ]);
    if (lb) {
      lorebooks.push({ ...lb, entries });
    }
  }

  const input: CampaignExportInput = {
    chat_title: chat.title || "Nepojmenovaný chat",
    chat_json: JSON.stringify({ title: chat.title, messages }, null, 2),
    ledger_json: JSON.stringify({ facts }, null, 2),
    summary_json: summary ? JSON.stringify(summary, null, 2) : null,
    quests_json: JSON.stringify({ quests }, null, 2),
    lorebooks_json: JSON.stringify(lorebooks, null, 2),
    chronicle_html: null, // TODO: integrate with export_chronicle when available
  };

  return invoke<string>("export_campaign_zip", {
    outputPath: outPath,
    input,
  });
}

/** Opens a native save dialog and exports the campaign, or does nothing if
 * the user cancelled. */
export async function pickAndExportCampaign(chat: Chat): Promise<string | null> {
  const outPath = await saveDialog({
    defaultPath: `${(chat.title || "kampan").replace(/[/\\?%*:|"<>]/g, "_")}.zip`,
    filters: [{ name: "Kampaň (ZIP)", extensions: ["zip"] }],
  });
  if (!outPath) return null;
  await exportCampaignToZip(chat, outPath);
  return outPath;
}
