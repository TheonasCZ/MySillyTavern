/** EXPERIMENTAL — function-calling proof of concept (see ROADMAP for the
 * R&D writeup). Implements the single `get_item_detail` tool the Gemini
 * provider can offer (see `src-tauri/src/providers/gemini.rs`): the model
 * calls this mid-stream when the player references an inventory item,
 * skill, condition, or body modification whose full detail was folded away
 * by `promptBuilder.ts::formatCappedList` (only its name is still visible
 * in `[GAME TAGS]`). This runs ALONGSIDE the existing cap/fold behavior,
 * not instead of it — the fold still bounds every-turn prompt size; this
 * tool is an on-demand escape hatch for the rare turn that actually needs
 * an old entry's detail.
 *
 * Pure lookup logic (`lookupItemDetail`) is separated from the DB-reading
 * wrapper (`lookupItemDetailForChat`) so it's unit-testable without a live
 * database — mirrors the rest of this codebase's convention (e.g.
 * `promptBuilder.ts` itself). */

import {
  getChatConditions,
  getChatInventory,
  getChatModifications,
  getChatSkills,
} from "../db/repositories/chatsRepo";
import type {
  ConditionEntry,
  InventoryEntry,
  ModificationEntry,
  SkillEntry,
} from "../db/repositories/personasRepo";

/** Must match `GET_ITEM_DETAIL_TOOL_NAME` in `src-tauri/src/providers/gemini.rs`. */
export const GET_ITEM_DETAIL_TOOL_NAME = "get_item_detail";

export interface ChatStateLists {
  inventory: InventoryEntry[];
  skills: SkillEntry[];
  conditions: ConditionEntry[];
  modifications: ModificationEntry[];
}

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

/** Finds the best match for `name` in `list` by `getName`: exact
 * case-insensitive match first, then a substring match either direction
 * (handles the model passing a slightly paraphrased name). */
function findBestMatch<T>(list: T[], getName: (item: T) => string, name: string): T | undefined {
  const q = normalize(name);
  if (!q) return undefined;
  const exact = list.find((item) => normalize(getName(item)) === q);
  if (exact) return exact;
  return list.find((item) => {
    const n = normalize(getName(item));
    return n.includes(q) || q.includes(n);
  });
}

/** Pure lookup — no DB access. Searches inventory, then skills, then
 * conditions, then modifications, in that order, and returns a short
 * human-readable (Czech) description of whatever's found, or an explicit
 * "not found" result. Never throws. */
export function lookupItemDetail(state: ChatStateLists, name: string): string {
  const item = findBestMatch(state.inventory, (i) => i.item, name);
  if (item) {
    const parts = [`Předmět „${item.item}“`, `množství ${item.qty}`];
    if (item.note && item.note.trim()) parts.push(`poznámka: ${item.note.trim()}`);
    return `${parts.join(", ")}.`;
  }

  const skill = findBestMatch(state.skills, (s) => s.name, name);
  if (skill) {
    return `Dovednost „${skill.name}“: úroveň ${skill.level}.`;
  }

  const condition = findBestMatch(state.conditions, (c) => c.name, name);
  if (condition) {
    const parts = [`Kondice „${condition.name}“`];
    if (condition.description && condition.description.trim()) {
      parts.push(condition.description.trim());
    }
    parts.push(condition.expiresAt ? `trvá do: ${condition.expiresAt}` : "trvání: trvalá/neurčitá");
    if (condition.modifiers?.length) {
      const mods = condition.modifiers.map((m) => `${m.stat} ${m.value >= 0 ? "+" : ""}${m.value}`).join(", ");
      parts.push(`modifikátory: ${mods}`);
    }
    return `${parts.join(" — ")}.`;
  }

  const modification = findBestMatch(state.modifications, (m) => m.name, name);
  if (modification) {
    const desc = modification.description?.trim();
    return `Tělesná úprava „${modification.name}“${desc ? `: ${desc}` : " (bez dalšího popisu)."}`;
  }

  return `Nenalezeno: v inventáři, dovednostech, kondicích ani úpravách není nic se jménem „${name}“.`;
}

/** DB-reading wrapper — fetches the chat's current live state and applies
 * `lookupItemDetail`. This is what the tool-calling orchestration in
 * `chatStore.ts` actually calls when it receives a `FunctionCall` event. */
export async function lookupItemDetailForChat(chatId: string, name: string): Promise<string> {
  const [inventory, skills, conditions, modifications] = await Promise.all([
    getChatInventory(chatId),
    getChatSkills(chatId),
    getChatConditions(chatId),
    getChatModifications(chatId),
  ]);
  return lookupItemDetail({ inventory, skills, conditions, modifications }, name);
}
