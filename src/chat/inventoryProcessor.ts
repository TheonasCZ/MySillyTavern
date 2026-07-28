import type { Persona } from "../db/repositories/personasRepo";
import {
  getChat,
  getChatConditions,
  getChatInventory,
  getChatModifications,
  getChatSkills,
  getChatXpLevel,
  setChatConditions,
  setChatInventory,
  setChatModifications,
  setChatSkills,
  setChatXpLevel,
} from "../db/repositories/chatsRepo";
import { nowIso } from "../db/database";
import { createFaction, listFactions, updateReputation } from "../db/repositories/factionsRepo";
import { addQuestNote, createQuest, getQuestByName, updateQuestStatus } from "../db/repositories/questsRepo";
import { advanceAndPersistCalendar } from "../memory/memoryEngine";
import { advanceAndPersistWeather } from "../memory/weather";
import { createRecipe, getRecipeByResult, updateRecipePerks, createChatRecipe, getChatRecipeByResult, updateChatRecipePerks } from "../db/repositories/craftingRepo";
import { parseGameTags, type ParsedTags, type InvMutation, type SkillMutation, type LevelMutation, type FactionMutation, type CraftMutation, type CraftedMutation, type ConditionMutation, type ModMutation, type QuestMutation, type TimeMutation, type ItemNoteMutation } from "./inventoryTags";
import { setGameOverState } from "./gameOver";
import { setPendingCheckSkill } from "./pendingCheck";
import { resolveDiceNotation } from "./diceCommand";
import { serializeChangeSummary, type ChangeSummaryEntry } from "./changeSummary";
import { namesMatch } from "./fuzzyMatch";
import { parseDurationMinutes } from "./duration";
import { advanceMinutes, formatCalendarDate, toAbsoluteMinutes, type CalendarDate } from "../memory/calendar";
import { invoke } from "@tauri-apps/api/core";
import type { ConnectionDto } from "../providers/dto";
import { appendLog } from "../logging";

/** Tag validation feedback — stored across turns so the next prompt can
 *  warn the AI about malformed tags from the previous response. */
let lastTagErrors: string[] = [];
export function getLastTagErrors(): string[] { return lastTagErrors; }
export function clearTagErrors(): void { lastTagErrors = []; }

export interface GameResponseResult {
  cleanText: string;
  /** Stylized local-only summary of what this reply's tags actually did —
   *  see Message.changeSummary. Null when there was nothing to summarize. */
  changeSummary: string | null;
}

/** Small, varied idle-drift fallback (in minutes) applied when a reply has
 *  no explicit [TIME:...] tag — represents roughly one conversational beat
 *  so the clock keeps creeping forward even if the model never tags time. */
function idleDriftMinutes(): number {
  return 2 + Math.floor(Math.random() * 7); // 2–8 minutes
}

/** What skills, items, and recipes are relevant to the current scene —
 *  extracted by the AI alongside game-mechanical changes. Used to filter
 *  what state context the storyteller receives in the next prompt. */
export interface RelevantContext {
  skills: string[];
  itemKeywords: string[];
  recipeKeywords: string[];
}

/** JSON shape returned by the Rust `extract_game_tags` command. */
interface AiExtractionResult {
  time_elapsed_minutes: number | null;
  inventory: Array<{ op: "add" | "remove"; item: string; qty: number }>;
  skills: Array<{ name: string; delta: number }>;
  levels: { xp_delta: number; level_delta: number } | null;
  conditions: Array<{ op: "add" | "remove"; name: string; description?: string | null; duration?: string | null }>;
  modifications: Array<{ op: "add" | "remove"; name: string }>;
  factions: Array<{ name: string; delta: number }>;
  crafting: Array<{ result_item: string; ingredients: string[] }>;
  crafted: Array<{ result_item: string; perks: string[] }>;
  quests: Array<{ op: "start" | "complete" | "fail" | "note"; name: string; note?: string | null }>;
  game_over: string | null;
  check_skill: string | null;
  relevant_context?: { skills?: string[]; item_keywords?: string[]; recipe_keywords?: string[] };
}

/** Module-level storage for the last AI-extracted relevant context.
 *  Read by the prompt builder to filter state context for the next turn. */
let lastRelevantContext: RelevantContext | null = null;
export function getLastRelevantContext(): RelevantContext | null { return lastRelevantContext; }
export function clearRelevantContext(): void { lastRelevantContext = null; }

/** Calls the tag-extraction model (Gemini Flash etc.) to extract structured
 *  game-state changes from the narrator's prose. Returns ParsedTags on
 *  success, or null on any failure — the caller should fall back to regex. */
export interface ExtractionContext {
  skills: Array<{ name: string; level: number }>;
  inventory: Array<{ item: string; qty: number }>;
  conditions: Array<{ name: string }>;
  modifications: Array<{ name: string }>;
  xp: number;
  level: number;
  progression: string;
  hardcoreMode: boolean;
  /** Current faction reputations (name → score). */
  factions?: Array<{ name: string; reputation: number }>;
  /** Known crafting recipes. */
  recipes?: Array<{ resultItem: string; ingredients: string[] }>;
  /** Active quests. */
  quests?: Array<{ name: string; status: string }>;
  /** Current in-game date/time description. */
  calendarDescription?: string;
  /** What the player just wrote (last user message). */
  playerMessage?: string;
}

export async function extractTagsWithAI(
  connection: ConnectionDto,
  responseText: string,
  context: ExtractionContext | null,
): Promise<ParsedTags | null> {
  try {
    // Build state context so the extractor knows what the character
    // already has — without this it can't distinguish "used an existing
    // skill" from "learned a new skill", or "drew his own sword" from
    // "found a sword".
    let stateContext = "";
    if (context) {
      const parts: string[] = [];
      if (context.skills?.length) {
        parts.push(`Current skills: ${context.skills.map((s) => `${s.name} lv.${s.level}`).join(", ")}`);
      }
      if (context.inventory?.length) {
        parts.push(`Current inventory: ${context.inventory.map((i) => `${i.item}${i.qty > 1 ? ` x${i.qty}` : ""}`).join(", ")}`);
      }
      if (context.conditions?.length) {
        parts.push(`Active conditions: ${context.conditions.map((c) => c.name).join(", ")}`);
      }
      if (context.modifications?.length) {
        parts.push(`Body modifications: ${context.modifications.map((m) => m.name).join(", ")}`);
      }
      parts.push(`Progression mode: ${context.progression}`);
      if (context.progression === "level") {
        parts.push(`Current level: ${context.level}, XP: ${context.xp}`);
      }
      if (context.hardcoreMode) {
        parts.push("Hardcore mode: ON — character death is permanent.");
      }
      if (context.factions?.length) {
        parts.push(`Faction reputations: ${context.factions.map((f) => `${f.name} (${f.reputation > 0 ? "+" : ""}${f.reputation})`).join(", ")}`);
      }
      if (context.recipes?.length) {
        parts.push(`Known recipes: ${context.recipes.map((r) => r.resultItem).join(", ")}`);
      }
      if (context.quests?.length) {
        parts.push(`Active quests: ${context.quests.map((q) => `${q.name} [${q.status}]`).join(", ")}`);
      }
      if (context.calendarDescription) {
        parts.push(`Current in-game time: ${context.calendarDescription}`);
      }
      if (context.playerMessage) {
        parts.push(`Player's last message: "${context.playerMessage}"`);
      }
      stateContext = parts.join("\n");
    }

    const raw = await invoke<string>("extract_game_tags", {
      connection,
      responseText,
      stateContext: stateContext || null,
    });
    const ai: AiExtractionResult = JSON.parse(raw);

    // Log the extraction result to app.log for debugging — truncated to
    // avoid flooding the log with huge LLM responses.
    const summary = JSON.stringify({
      time: ai.time_elapsed_minutes,
      inv: ai.inventory?.length ?? 0,
      skills: ai.skills?.length ?? 0,
      cond: ai.conditions?.length ?? 0,
      ctx_skills: ai.relevant_context?.skills?.length ?? 0,
    });
    appendLog(`${new Date().toISOString()} [info] [extractor] ${summary}`);

    // Store the scene-relevance context for the next prompt build —
    // tells the frontend which skills/items/recipes to surface.
    const rc = ai.relevant_context;
    lastRelevantContext = rc
      ? {
          skills: rc.skills || [],
          itemKeywords: rc.item_keywords || [],
          recipeKeywords: rc.recipe_keywords || [],
        }
      : null;

    // Sanity-check extractor mutations against reasonable bounds.
    // The extractor may hallucinate absurd values (qty=9999, delta=500).
    const MAX_ITEM_QTY = 99;
    const MAX_SKILL_DELTA = 3;

    const invMutations: InvMutation[] = (ai.inventory || [])
      .filter((i) => i.item && i.op)
      .map((i) => ({
        op: i.op,
        item: String(i.item).trim(),
        qty: Math.max(1, Math.min(MAX_ITEM_QTY, i.qty || 1)),
      }));
    const invNotes: ItemNoteMutation[] = [];
    const skillChanges: SkillMutation[] = (ai.skills || [])
      .filter((s) => s.name)
      .map((s) => ({
        name: String(s.name).trim(),
        delta: Math.max(-MAX_SKILL_DELTA, Math.min(MAX_SKILL_DELTA, s.delta || 0)),
        absolute: null,
      }));
    const levelChanges: LevelMutation = ai.levels
      ? { xpDelta: ai.levels.xp_delta || 0, levelDelta: ai.levels.level_delta || 0 }
      : { xpDelta: 0, levelDelta: 0 };
    const factionMutations: FactionMutation[] = (ai.factions || []).map((f) => ({
      name: f.name,
      delta: f.delta,
      showOnly: false,
    }));
    const craftMutations: CraftMutation[] = (ai.crafting || []).map((c) => ({
      resultItem: c.result_item,
      ingredients: c.ingredients || [],
    }));
    const craftedMutations: CraftedMutation[] = (ai.crafted || []).map((c) => ({
      resultItem: c.result_item,
      perks: c.perks || [],
    }));
    const conditionMutations: ConditionMutation[] = (ai.conditions || []).map((c) => ({
      op: c.op,
      name: c.name,
      description: c.description ?? undefined,
      duration: c.duration ?? undefined,
    }));
    const modMutations: ModMutation[] = (ai.modifications || []).map((m) => ({
      op: m.op,
      name: m.name,
    }));
    const questMutations: QuestMutation[] = (ai.quests || []).map((q) => ({
      op: q.op,
      name: q.name,
      note: q.note ?? undefined,
    }));
    const timeMutations: TimeMutation[] =
      ai.time_elapsed_minutes != null && ai.time_elapsed_minutes > 0
        ? [{ minutes: ai.time_elapsed_minutes }]
        : [];
    const gameOverReason: string | null = ai.game_over || null;
    const checkSkill: string | null = ai.check_skill || null;

    return {
      // Strip any inline tags the model may have written anyway (habit),
      // but don't use them for mutations — the AI extraction result is the
      // source of truth. The cleaned text is what the player sees.
      cleanText: parseGameTags(responseText).cleanText,
      mutations: invMutations,
      skillChanges,
      levelChanges: [levelChanges],
      factionMutations,
      craftMutations,
      craftedMutations,
      conditionMutations,
      modMutations,
      questMutations,
      timeMutations,
      gameOverReason,
      checkSkill,
      itemNoteMutations: invNotes,
    };
  } catch (err) {
    appendLog(`${new Date().toISOString()} [warn] [extractor] failed: ${String(err).slice(0, 200)}`);
    return null;
  }
}

/** Parses game tags (inventory + skill + level + faction) from the AI response,
 *  updates the persona in DB, and returns the cleaned text plus a display-only
 *  summary of what changed. When `aiTags` is provided (from a tag-extraction
 *  model), regex parsing is skipped entirely. */
export async function processGameResponse(
  persona: Persona | null,
  text: string,
  chatId?: string,
  aiTags: ParsedTags | null = null,
): Promise<GameResponseResult> {
  const parsed = aiTags ?? parseGameTags(text);
  const { cleanText, mutations, skillChanges, levelChanges, factionMutations, craftMutations, craftedMutations, conditionMutations, modMutations, questMutations, timeMutations, gameOverReason, checkSkill, itemNoteMutations } = parsed;

  // Advance the in-game clock on every reply, tag or not — runs even without
  // a persona (the clock is chat-scoped, not persona-scoped). An explicit
  // [TIME:+Nd/h/m] tag drives a real narrative jump (and re-rolls weather —
  // see weather.ts), but if the model doesn't write one we still nudge the
  // clock by a small idle-drift amount so a long scene without tags doesn't
  // leave the calendar frozen. This merges the old per-message clock design
  // into the tag-driven calendar rather than running two separate systems.
  // Pure local math against the DB-persisted calendar — costs no prompt tokens.
  let currentCal: CalendarDate | null = null;
  const expiredConditionNames: string[] = [];
  if (chatId) {
    const tagMinutes = timeMutations.reduce((sum, tm) => sum + tm.minutes, 0);
    const minutes = tagMinutes > 0 ? tagMinutes : idleDriftMinutes();
    try {
      const nextCal = await advanceAndPersistCalendar(chatId, minutes);
      currentCal = nextCal;
      // Only re-roll weather on an explicit jump, not idle drift, so it
      // can't flicker within one stationary scene (see advanceAndPersistWeather).
      let weather: string | null = null;
      if (tagMinutes > 0) {
        weather = await advanceAndPersistWeather(chatId, nextCal.season);
      }

      // Auto-expire timed conditions (e.g. "6 hodin" burns/exhaustion) once
      // enough game-time has actually passed — runs on every reply, tagged
      // or not, so a condition doesn't just sit forever because the model
      // never explicitly writes [COND:-name] to clear it (see M-time-audit,
      // 2026-07-19: burns/exhaustion never ticked down before this).
      const nowAbs = toAbsoluteMinutes(nextCal);
      const conds = (await getChatConditions(chatId)).map((c) => ({ ...c }));
      const stillActive = conds.filter((c) => {
        const expired = c.expiresAtMinutes != null && c.expiresAtMinutes <= nowAbs;
        if (expired) expiredConditionNames.push(c.name);
        return !expired;
      });
      if (expiredConditionNames.length > 0) {
        await setChatConditions(chatId, stillActive);
      }
      appendLog(`${new Date().toISOString()} [info] [time] chat=${chatId} +${minutes}min (${tagMinutes > 0 ? "tag" : "idle"}) -> ${formatCalendarDate(nextCal)} ${String(nextCal.hourOfDay).padStart(2, "0")}:${String(nextCal.minuteOfHour).padStart(2, "0")}, season=${nextCal.season}${weather ? `, weather=${weather}` : ""}${expiredConditionNames.length ? `, expired=[${expiredConditionNames.join(", ")}]` : ""}`);
    } catch (err) {
      appendLog(`${new Date().toISOString()} [warn] [time] chat=${chatId} calendar/weather advance failed: ${String(err).slice(0, 200)}`);
    }
  }

  if (mutations.length === 0 && skillChanges.length === 0 && levelChanges.length === 0 && factionMutations.length === 0 && craftMutations.length === 0 && craftedMutations.length === 0 && conditionMutations.length === 0 && modMutations.length === 0 && questMutations.length === 0 && timeMutations.length === 0 && gameOverReason === null && checkSkill === null && itemNoteMutations.length === 0 && expiredConditionNames.length === 0) {
    return { cleanText: text, changeSummary: null };
  }

  // [GAMEOVER:reason] only ever takes effect in hardcore mode — the model is
  // only told the tag exists via DIRECTOR_HARDCORE_NOTE when the chat's
  // hardcoreMode is on, but a stray/hallucinated tag from a non-hardcore
  // chat must not end the run, hence the explicit re-check here rather than
  // trusting the tag.
  if (gameOverReason !== null && chatId) {
    try {
      const chat = await getChat(chatId);
      if (chat?.hardcoreMode) {
        await setGameOverState(chatId, gameOverReason);
        appendLog(`${new Date().toISOString()} [info] [gameover] chat=${chatId} reason=${gameOverReason.slice(0, 200)}`);
      }
    } catch (err) {
      appendLog(`${new Date().toISOString()} [warn] [gameover] chat=${chatId} failed: ${String(err).slice(0, 200)}`);
    }
  }

  // [CHECK:skill name] — offered to the quick-roll button as a bonus
  // source; see pendingCheck.ts. The name doesn't need to match an actual
  // skill (see inventoryTags.ts) — matching happens where it's consumed.
  if (checkSkill !== null && chatId) {
    try {
      await setPendingCheckSkill(chatId, checkSkill);
    } catch (err) {
      appendLog(`${new Date().toISOString()} [warn] [check] chat=${chatId} skill=${checkSkill} failed: ${String(err).slice(0, 200)}`);
    }
  }

  // Diagnostic messages for mutations that targeted state that doesn't
  // actually exist (missing item, never-learned skill, nonexistent
  // condition/modification, quest completed without being started). These
  // are purely local DB-lookup checks — no extra API/LLM cost — appended to
  // lastTagErrors below so the AI gets course-correction feedback next turn.
  // The underlying mutations remain safe no-ops; only this diagnostic is new.
  const staleTargetErrors: string[] = [];

  // Stylized, LOCAL-ONLY summary of what actually changed — never sent back
  // to the model (see Message.changeSummary), just rendered as a small
  // footer under the reply. Built inline as each mutation is successfully
  // applied below, so it can never drift from what actually happened.
  const summaryParts: ChangeSummaryEntry[] = [];
  for (const name of expiredConditionNames) {
    summaryParts.push({ text: `✨ ${name} pominulo`, kind: "add" });
  }

  // Apply quest mutations: [QUEST:+name] / [QUEST:✓name] / [QUEST:-name] / [QUEST:name: note]
  if (chatId) {
    for (const qm of questMutations) {
      try {
        const existing = await getQuestByName(chatId, qm.name);
        if (qm.op === "start") {
          if (!existing) {
            await createQuest({ chatId, name: qm.name, description: qm.note });
            summaryParts.push({ text: `📜 Nový úkol: ${qm.name}`, kind: "neutral" });
          }
        } else if (qm.op === "complete" || qm.op === "fail") {
          if (!existing) {
            staleTargetErrors.push(`Tag [QUEST:${qm.op === "complete" ? "✓" : "-"}${qm.name}] se pokusil dokončit quest "${qm.name}", který nikdy nebyl založen tagem [QUEST:+${qm.name}]. Nejdřív quest založ, pak ho dokonči.`);
          }
          const quest = existing ?? (await createQuest({ chatId, name: qm.name }));
          await updateQuestStatus(quest.id, qm.op === "complete" ? "completed" : "failed");
          if (qm.note) await addQuestNote(quest.id, qm.note);
          summaryParts.push(qm.op === "complete"
            ? { text: `✅ Úkol splněn: ${qm.name}`, kind: "add" }
            : { text: `❌ Úkol selhal: ${qm.name}`, kind: "remove" });
        } else if (qm.op === "note") {
          const quest = existing ?? (await createQuest({ chatId, name: qm.name }));
          if (qm.note) await addQuestNote(quest.id, qm.note);
        }
      } catch (err) {
        appendLog(`${new Date().toISOString()} [warn] [quest] chat=${chatId} op=${qm.op} name=${qm.name} failed: ${String(err).slice(0, 200)}`);
      }
    }
  }

  // Apply condition mutations: [COND:+name] / [COND:+name:duration] / [COND:-name]
  // Chat-scoped, mirrors inventory — conditions live on the chat/campaign
  // now, not the persona. Without a chatId there's nowhere to apply them.
  const conditions = chatId ? (await getChatConditions(chatId)).map((c) => ({ ...c })) : [];
  if (chatId) {
    for (const cm of conditionMutations) {
      // Fuzzy match, not exact string equality — the model isn't consistent
      // about word form between turns (e.g. "vyčerpaný" vs "vyčerpání" for
      // the same exhaustion) and exact matching duplicated the condition
      // instead of refreshing it (see M-time-audit, 2026-07-19).
      const idx = conditions.findIndex((c) => namesMatch(c.name, cm.name));
      if (cm.op === "add") {
        if (idx === -1) {
          // The model may write unresolved dice notation into `duration`
          // (e.g. "1d4 dny") instead of picking a number itself — resolve it
          // locally via the actual dice engine rather than trusting an LLM
          // to do arithmetic/randomness, and so the player sees a concrete
          // number instead of a raw expression they can't act on.
          const duration = cm.duration ? await resolveDiceNotation(cm.duration) : cm.duration;
          // Turn the resolved duration into a real expiry against the game
          // calendar (not just decorative text) so it can actually be
          // auto-cleared later instead of sitting forever — see the
          // auto-expire pass above.
          let expiresAt: string | null = null;
          let expiresAtMinutes: number | undefined;
          const durationMinutes = duration ? parseDurationMinutes(duration) : null;
          if (durationMinutes != null && currentCal) {
            const expiryCal = advanceMinutes(currentCal, durationMinutes);
            expiresAtMinutes = toAbsoluteMinutes(expiryCal);
            expiresAt = `${formatCalendarDate(expiryCal)}, ${String(expiryCal.hourOfDay).padStart(2, "0")}:${String(expiryCal.minuteOfHour).padStart(2, "0")}`;
          }
          conditions.push({
            name: cm.name,
            description: [cm.description, duration].filter(Boolean).join(" — "),
            expiresAt,
            expiresAtMinutes,
            lastTouched: nowIso(),
          });
          summaryParts.push({ text: `🩹 ${cm.name}${duration ? ` (${duration})` : ""}`, kind: "remove" });
        } else if (cm.duration) {
          // Refresh an already-active condition's duration instead of
          // silently no-oping (the model may legitimately re-apply/extend
          // it, e.g. stepping into more fire).
          const duration = await resolveDiceNotation(cm.duration);
          const durationMinutes = parseDurationMinutes(duration);
          if (durationMinutes != null && currentCal) {
            const expiryCal = advanceMinutes(currentCal, durationMinutes);
            conditions[idx].expiresAtMinutes = toAbsoluteMinutes(expiryCal);
            conditions[idx].expiresAt = `${formatCalendarDate(expiryCal)}, ${String(expiryCal.hourOfDay).padStart(2, "0")}:${String(expiryCal.minuteOfHour).padStart(2, "0")}`;
            conditions[idx].lastTouched = nowIso();
          }
        }
      } else if (idx !== -1) {
        conditions.splice(idx, 1);
        summaryParts.push({ text: `✨ ${cm.name} pominulo`, kind: "add" });
      } else {
        staleTargetErrors.push(`Tag [COND:-${cm.name}] se pokusil odebrat stav "${cm.name}", který postava nemá. Odebírej jen stavy, které aktuálně existují.`);
      }
    }
  }

  // Apply body modification mutations: [MOD:+popis] / [MOD:-popis] —
  // chat-scoped, mirrors conditions above. Always campaign-specific — no
  // persona template equivalent, so without a chatId there's nowhere to
  // apply them.
  const modifications = chatId ? (await getChatModifications(chatId)).map((m) => ({ ...m })) : [];
  if (chatId) {
    for (const mm of modMutations) {
      const idx = modifications.findIndex((m) => namesMatch(m.name, mm.name));
      if (mm.op === "add") {
        if (idx === -1) {
          modifications.push({ name: mm.name, description: mm.name, lastTouched: nowIso() });
          summaryParts.push({ text: `🩸 ${mm.name}`, kind: "remove" });
        }
      } else if (idx !== -1) {
        modifications.splice(idx, 1);
        summaryParts.push({ text: `✨ ${mm.name} zhojeno`, kind: "add" });
      } else {
        staleTargetErrors.push(`Tag [MOD:-${mm.name}] se pokusil odebrat úpravu "${mm.name}", kterou postava nemá. Odebírej jen úpravy, které aktuálně existují.`);
      }
    }
  }

  // Apply inventory mutations — chat-scoped, mirrors quests (inventory
  // lives on the chat/campaign now, not the persona). Without a chatId
  // there's nowhere to apply them, so inventory/craft tags are simply
  // skipped (same as the previous no-op-without-persona behaviour).
  const inv = chatId ? (await getChatInventory(chatId)).map((i) => ({ ...i })) : [];
  const newlyAddedItems: string[] = [];
  if (chatId) {
    for (const m of mutations) {
      const existing = inv.find((i) => namesMatch(i.item, m.item));
      if (m.op === "add") {
        if (existing) {
          existing.qty += m.qty;
          existing.lastTouched = nowIso();
        } else {
          inv.push({ item: m.item, qty: m.qty, lastTouched: nowIso() });
          newlyAddedItems.push(m.item);
        }
        summaryParts.push({ text: `🎒 +${m.qty > 1 ? `${m.qty} ` : ""}${m.item}`, kind: "add" });
      } else {
        if (existing) {
          if (existing.qty < m.qty) {
            staleTargetErrors.push(`Tag [INV:-${m.qty}:${m.item}] se pokusil odebrat víc kusů "${m.item}" (${m.qty}), než hráč má (${existing.qty}). Odebírej jen tolik, kolik je skutečně v inventáři.`);
          }
          existing.qty -= m.qty;
          if (existing.qty <= 0) inv.splice(inv.indexOf(existing), 1);
          summaryParts.push({ text: `🎒 −${m.qty > 1 ? `${m.qty} ` : ""}${m.item}`, kind: "remove" });
        } else {
          staleTargetErrors.push(`Tag [INV:-${m.item}] se pokusil odebrat předmět "${m.item}", který hráč nemá v inventáři. Odebírej jen předměty, které tam skutečně jsou.`);
        }
      }
    }
    // [ITEM:name:note] — replaces an existing item's note (its condition,
    // e.g. wear/damage), never its quantity. This is the correct place for
    // "the knife is now slightly damaged" — not [MOD:...], which is
    // body-only (see TWO_ROLES_INSTRUCTIONS).
    for (const im of itemNoteMutations) {
      const existing = inv.find((i) => namesMatch(i.item, im.item));
      if (existing) {
        existing.note = im.note;
        existing.lastTouched = nowIso();
        summaryParts.push({ text: `🔧 ${im.item}`, kind: "update" });
      } else {
        staleTargetErrors.push(`Tag [ITEM:${im.item}:...] se pokusil upravit poznámku předmětu "${im.item}", který hráč nemá v inventáři. Uprav jen předměty, které tam skutečně jsou.`);
      }
    }
  }

  // Apply skill mutations — chat-scoped, mirrors inventory/conditions.
  const skills = chatId ? (await getChatSkills(chatId)).map((s) => ({ ...s })) : [];
  if (chatId) {
    for (const s of skillChanges) {
      const existing = skills.find((sk) => sk.name.toLowerCase() === s.name.toLowerCase());
      if (s.absolute !== null) {
        // Absolute set: [SKILL:+name:3]
        if (existing) {
          // Model sometimes re-issues the same absolute level (e.g. it
          // "re-teaches" a skill the player already has) — that's a no-op,
          // not progress, so don't log it as if the skill just leveled up.
          if (existing.level !== s.absolute) {
            existing.level = s.absolute;
            existing.lastTouched = nowIso();
            summaryParts.push({ text: `📈 ${s.name} → úroveň ${s.absolute}`, kind: "add" });
          }
        } else {
          skills.push({ name: s.name, level: s.absolute, lastTouched: nowIso() });
          summaryParts.push({ text: `📈 Naučeno: ${s.name}`, kind: "add" });
        }
      } else if (s.delta > 0) {
        // Relative increase: [SKILL:name+2] or [SKILL:+name]
        if (existing) {
          existing.level += s.delta;
          existing.lastTouched = nowIso();
          summaryParts.push({ text: `📈 ${s.name} +${s.delta}`, kind: "add" });
        } else {
          skills.push({ name: s.name, level: s.delta, lastTouched: nowIso() });
          summaryParts.push({ text: `📈 Naučeno: ${s.name}`, kind: "add" });
        }
      } else {
        // Decrease: [SKILL:name-1] — remove if <= 0
        if (existing) {
          existing.level = Math.max(0, existing.level + s.delta);
          if (existing.level <= 0) skills.splice(skills.indexOf(existing), 1);
          summaryParts.push({ text: `📉 ${s.name} ${s.delta}`, kind: "remove" });
        } else {
          staleTargetErrors.push(`Tag [SKILL:${s.name}${s.delta}] se pokusil snížit dovednost "${s.name}", kterou postava nikdy neměla. Snižuj jen dovednosti, které postava skutečně má.`);
        }
      }
    }
  }

  // Apply level mutations — chat-scoped, mirrors inventory/skills.
  const chatXpLevel = chatId ? await getChatXpLevel(chatId) : { xp: 0, level: 1 };
  let xp = chatXpLevel.xp;
  let level = chatXpLevel.level;
  let hasLevelChanges = false;
  let totalXpDelta = 0;
  let totalLevelDelta = 0;
  for (const lc of levelChanges) {
    if (lc.xpDelta > 0) { xp += lc.xpDelta; totalXpDelta += lc.xpDelta; hasLevelChanges = true; }
    if (lc.levelDelta > 0) { level += lc.levelDelta; totalLevelDelta += lc.levelDelta; hasLevelChanges = true; }
  }
  if (totalXpDelta > 0) summaryParts.push({ text: `⭐ +${totalXpDelta} XP`, kind: "add" });
  if (totalLevelDelta > 0) summaryParts.push({ text: `⭐ Úroveň +${totalLevelDelta}`, kind: "add" });

  // Apply faction mutations
  //
  // NOTE: Factions are persona-scoped (the `factions` table is keyed by
  // `persona_id`).  Unlike inventory, skills, conditions, and recipes —
  // which all have per-chat tables — there is no `chat_factions` table
  // yet.  If per-chat faction isolation is desired in the future, a
  // `chat_faction_reputations` table (chat_id, faction_name, reputation)
  // must be created and this block should prefer chatId when available.
  // For now, faction mutations always apply to the persona.
  //
  // (persona-scoped — requires persona)
  if (persona) {
    for (const fm of factionMutations) {
      if (fm.showOnly) continue; // show-only tags are no-ops at processing time
      try {
        const existing = await listFactions(persona.id);
      const match = existing.find(
        (f) => f.factionName.toLowerCase() === fm.name.toLowerCase(),
      );
      if (match) {
        await updateReputation(match.id, fm.delta);
      } else {
        await createFaction(persona.id, fm.name, fm.delta);
      }
      summaryParts.push({ text: `🤝 ${fm.name} ${fm.delta > 0 ? "+" : ""}${fm.delta}`, kind: fm.delta > 0 ? "add" : "remove" });
      } catch (err) {
        appendLog(`${new Date().toISOString()} [warn] [faction] persona=${persona.id} name=${fm.name} failed: ${String(err).slice(0, 200)}`);
      }
    }
  }

  // Apply craft mutations: [CRAFT:result:ingredient1+ingredient2]
  if (persona || chatId) {
  for (const cm of craftMutations) {
    try {
      // Create the recipe in DB (or skip if already known)
      const existing = chatId
        ? await getChatRecipeByResult(chatId, cm.resultItem)
        : persona
          ? await getRecipeByResult(persona.id, cm.resultItem)
          : null;
      if (!existing) {
        // Determine tier based on skill level (AI may set later, default 0)
        const relatedSkill = skills.find(
          (s) => cm.ingredients.some((ing) =>
            ing.toLowerCase().includes(s.name.toLowerCase().slice(0, 4)) ||
            s.name.toLowerCase().includes("alchymie")
          )
        );
        // Try to infer skill name from context (default "Alchymie" for potions, "Kovářství" for weapons)
        let inferredSkill = relatedSkill?.name ?? null;
        if (!inferredSkill && cm.resultItem.toLowerCase().includes("lektvar")) inferredSkill = "Alchymie";
        else if (!inferredSkill && cm.resultItem.toLowerCase().includes("jed")) inferredSkill = "Alchymie";
        else if (!inferredSkill) inferredSkill = "Kovářství";

        if (chatId) {
          await createChatRecipe({
            chatId,
            resultItem: cm.resultItem,
            ingredients: cm.ingredients,
            skillName: inferredSkill,
            tier: 0,
          });
        } else if (persona) {
          await createRecipe({
            personaId: persona.id,
            resultItem: cm.resultItem,
            ingredients: cm.ingredients,
            skillName: inferredSkill,
            tier: 0,
          });
        }
      }
      // Consume ingredients from inventory (always consumed, even on failure)
      for (const ing of cm.ingredients) {
        const entry = inv.find((i) => namesMatch(i.item, ing));
        if (entry) {
          entry.qty -= 1;
          if (entry.qty <= 0) inv.splice(inv.indexOf(entry), 1);
        }
      }
      appendLog(`${new Date().toISOString()} [info] [craft] chat=${chatId ?? "-"} result=${cm.resultItem} ingredients=[${cm.ingredients.join(", ")}]`);
    } catch (err) {
      appendLog(`${new Date().toISOString()} [warn] [craft] chat=${chatId ?? "-"} result=${cm.resultItem} failed: ${String(err).slice(0, 200)}`);
    }
  }
  } // if (persona) — craft mutations

  // Apply crafted mutations: [CRAFTED:result] or [CRAFTED:result:perk1+perk2]
  if (persona || chatId) {
  for (const cdm of craftedMutations) {
    try {
      // Add the crafted item to inventory
      const existingItem = inv.find((i) => namesMatch(i.item, cdm.resultItem));
      if (existingItem) {
        existingItem.qty += 1;
        existingItem.lastTouched = nowIso();
      } else {
        inv.push({ item: cdm.resultItem, qty: 1, lastTouched: nowIso() });
        newlyAddedItems.push(cdm.resultItem);
      }
      summaryParts.push({ text: `🔨 Vyrobeno: ${cdm.resultItem}`, kind: "add" });
      // Update the recipe's perks
      if (chatId) {
        const recipe = await getChatRecipeByResult(chatId, cdm.resultItem);
        if (recipe) {
          await updateChatRecipePerks(recipe.id, cdm.perks);
        }
      } else if (persona) {
        const recipe = await getRecipeByResult(persona.id, cdm.resultItem);
        if (recipe) {
          await updateRecipePerks(recipe.id, cdm.perks);
        }
      }
      appendLog(`${new Date().toISOString()} [info] [crafted] chat=${chatId ?? "-"} result=${cdm.resultItem}${cdm.perks.length ? ` perks=[${cdm.perks.join(", ")}]` : ""}`);
    } catch (err) {
      appendLog(`${new Date().toISOString()} [warn] [crafted] chat=${chatId ?? "-"} result=${cdm.resultItem} failed: ${String(err).slice(0, 200)}`);
    }
  }
  } // if (persona || chatId) — crafted mutations

  // Persona is a template — never update during gameplay. Live state lives on
  // the chat (inventory/skills/conditions/xp/level/mods all chat-scoped).
  if (chatId) {
    try {
      await setChatInventory(chatId, inv);
      await setChatSkills(chatId, skills);
      await setChatConditions(chatId, conditions);
      await setChatModifications(chatId, modifications);
      if (hasLevelChanges) {
        await setChatXpLevel(chatId, xp, level);
      }
    } catch (err) {
      // Not actually "non-critical" — a failure here silently drops every
      // inventory/skill/condition/mod/level change this turn produced.
      appendLog(`${new Date().toISOString()} [error] [persist] chat=${chatId} state write failed, turn's changes lost: ${String(err).slice(0, 300)}`);
    }
  }

  // Auto-illustration trigger: enqueue newly added inventory items that
  // don't have an image yet (queue itself checks image_gen_enabled/limit).
  if (chatId && newlyAddedItems.length > 0) {
    try {
      const { enqueueIllustration } = await import("../memory/imageGenQueue");
      for (const itemName of newlyAddedItems) {
        enqueueIllustration("inventory", chatId, `Fantasy game item icon: ${itemName}`, itemName);
      }
    } catch (err) {
      appendLog(`${new Date().toISOString()} [warn] [illustration] chat=${chatId} enqueue failed: ${String(err).slice(0, 200)}`);
    }
  }

  const isAiMode = aiTags !== null;

  // Per-category tag budgets — mirrors promptTexts.ts TWO_ROLES_INSTRUCTIONS.
  // [TIME:...] and [CHECK:...] are exempt (no budget limit).
  // In AI extraction mode, the storyteller doesn't write tags — only
  // diagnostic feedback (staleTargetErrors) is relevant. Budget warnings
  // would scold the storyteller for something it's not supposed to do.
  const condModCount = conditionMutations.length + modMutations.length;
  const invItemCount = mutations.length + itemNoteMutations.length;
  const skillLevelCount = skillChanges.length + levelChanges.length;
  const questFactionCount = questMutations.length + factionMutations.length;
  const craftCount = craftMutations.length + craftedMutations.length;

  lastTagErrors = [...staleTargetErrors];

  if (!isAiMode) {
    if (condModCount > 3) {
      lastTagErrors.push(`Příliš mnoho tagů stavů/úprav (${condModCount}). Maximum pro [COND:...] + [MOD:...] jsou 3 tagy.`);
    }
    if (invItemCount > 3) {
      lastTagErrors.push(`Příliš mnoho tagů inventáře (${invItemCount}). Maximum pro [INV:...] + [ITEM:...] jsou 3 tagy.`);
    }
    if (skillLevelCount > 2) {
      lastTagErrors.push(`Příliš mnoho tagů dovedností/úrovně (${skillLevelCount}). Maximum pro [SKILL:...] + [LEVEL:...] jsou 2 tagy.`);
    }
    if (questFactionCount > 2) {
      lastTagErrors.push(`Příliš mnoho tagů questů/frakcí (${questFactionCount}). Maximum pro [QUEST:...] + [FACTION:...] jsou 2 tagy.`);
    }
    if (craftCount > 2) {
      lastTagErrors.push(`Příliš mnoho tagů craftingu (${craftCount}). Maximum pro [CRAFT:...] + [CRAFTED:...] jsou 2 tagy.`);
    }
  }

  // Detect narrated time skip — the extractor may have missed it. In AI
  // mode, we log a gentle note (not a scolding) and the clock still
  // advances via idleDriftMinutes (2-8 min). For explicit time-skip
  // phrases (sleep, next day), we log a diagnostic so the user can see
  // the extractor missed a big jump.
  if (timeMutations.length === 0 && cleanText.length > 300) {
    const timeSkipPattern = /spal|spala|spíš|usnul|usnula|probouzí|probudil|probudila|ráno|další den|následující den|druhý den|o několik hodin|po několika hodinách|večer se|stmívá|svítá|slept|sleeps|falls asleep|fell asleep|wakes? up|woke up|next day|next morning|the following day|several hours|a few hours|hours later|night falls|dawn breaks/i;
    if (timeSkipPattern.test(cleanText)) {
      if (isAiMode) {
        lastTagErrors.push("Extraktor AI nezaznamenal plynutí času, přestože text popisuje spánek/posun času. Hodiny se posunou jen o pár minut.");
      } else {
        lastTagErrors.push("Tvá odpověď popisuje plynutí času (spánek, ráno, další den...), ale chybí tag [TIME:...]. Kdykoli v příběhu uplyne významný čas, MUSÍŠ použít odpovídající [TIME:...] tag. / Your response describes time passing (sleep, morning, next day...) but is missing a [TIME:...] tag. Whenever significant in-game time passes, you MUST emit a matching [TIME:...] tag.");
      }
    }
  }

  // "No tags in long response" — only relevant in regex mode.
  if (!isAiMode) {
    const anyTagCount = condModCount + invItemCount + skillLevelCount + questFactionCount + craftCount +
      timeMutations.length + (checkSkill ? 1 : 0);
    if (anyTagCount === 0 && cleanText.length > 2000) {
      lastTagErrors.push("Dlouhá odpověď bez tagů. Pokud došlo ke změně inventáře, dovedností, questů nebo frakcí, použij odpovídající tagy.");
    }
  }

  const changeSummary = serializeChangeSummary(summaryParts);
  appendLog(
    `${new Date().toISOString()} [info] [turn] chat=${chatId ?? "-"} mode=${isAiMode ? "ai" : "regex"} ` +
      JSON.stringify({
        inv: mutations.length,
        itemNotes: itemNoteMutations.length,
        skills: skillChanges.length,
        xpDelta: totalXpDelta,
        levelDelta: totalLevelDelta,
        factions: factionMutations.length,
        craft: craftMutations.length,
        crafted: craftedMutations.length,
        cond: conditionMutations.length,
        mod: modMutations.length,
        quest: questMutations.length,
        expiredCond: expiredConditionNames.length,
        staleErrors: staleTargetErrors.length,
      }) +
      (changeSummary ? ` summary="${changeSummary.slice(0, 300)}"` : ""),
  );

  return { cleanText, changeSummary };
}
