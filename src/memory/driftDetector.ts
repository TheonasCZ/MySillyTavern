/** Automatic drift detector (M25.2). Runs on the extraction cadence in the
 * background: compares the latest scenes against the locked canon facts via
 * a cheap temperature-0 LLM check, keeps a per-chat drift score (EMA), and
 * when a contradiction crosses the severity threshold it queues a *silent*
 * correction. The correction is only ever attached to the next prompt build
 * (with a TTL of a few sends) — nothing pops up in the UI; the only place a
 * user can see it is the Prompt inspector.
 *
 * Pure functions (parser, score update, correction building) are exported
 * for unit tests; `runDriftCheck` is the orchestration layer. Never throws
 * — a failed check just means no correction this round (plan §9). */

import { chatComplete } from "../providers/chatComplete";
import type { ChatMessage, ConnectionConfig } from "../providers/types";
import { getSetting, setSetting } from "../db/repositories/settingsRepo";
import { logUsage } from "../db/repositories/usageRepo";
import { estimateTokens } from "../prompt/tokenEstimate";
import type { TranscriptChatMessage } from "./extractor";
import { DRIFT_CHECK_SYSTEM_PROMPT } from "../prompt/promptTexts";

export interface DriftFinding {
  /** Subject of the canon fact that was contradicted. */
  subject: string;
  /** What in the scene contradicts it. */
  contradiction: string;
  /** 0–1, how badly the scene breaks the rule. */
  severity: number;
}

export interface DriftCorrection {
  text: string;
  /** Remaining sends this correction is injected into; decremented by
   * `consumeDriftCorrections` on every prompt build. */
  ttl: number;
}

export interface DriftState {
  /** EMA drift score 0–1 — a running "how much is the AI drifting" gauge. */
  score: number;
  corrections: DriftCorrection[];
  lastCheckedAt: string | null;
}

/** Findings below this severity are noise — logged into the score but not
 * turned into corrections. */
export const DRIFT_SEVERITY_THRESHOLD = 0.5;
/** EMA smoothing: score' = α·signal + (1−α)·score. α = 0.5 reacts within
 * two checks but one borderline finding doesn't max the gauge. */
export const DRIFT_EMA_ALPHA = 0.5;
/** How many sends a correction stays attached to prompts. */
export const DRIFT_CORRECTION_TTL = 3;
/** Cap on simultaneously active corrections (worst offenders win). */
export const DRIFT_MAX_CORRECTIONS = 4;

export function defaultDriftState(): DriftState {
  return { score: 0, corrections: [], lastCheckedAt: null };
}

function isDriftFinding(value: unknown): value is DriftFinding {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.subject === "string" &&
    v.subject.trim().length > 0 &&
    typeof v.contradiction === "string" &&
    v.contradiction.trim().length > 0 &&
    typeof v.severity === "number" &&
    Number.isFinite(v.severity)
  );
}

/** Tolerant parser (same contract as `parseExtractorOutput`): strips code
 * fences, grabs the first `[...]`, validates shapes, clamps severity to
 * 0–1. Returns `[]` on garbage, never throws. */
export function parseDriftOutput(raw: string): DriftFinding[] {
  if (!raw) return [];
  const withoutFences = raw.replace(/```[a-zA-Z]*\n?/g, "").replace(/```/g, "");
  const start = withoutFences.indexOf("[");
  const end = withoutFences.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(withoutFences.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isDriftFinding).map((f) => ({
    subject: f.subject.trim(),
    contradiction: f.contradiction.trim(),
    severity: Math.max(0, Math.min(1, f.severity)),
  }));
}

/** EMA update: the signal of a check is the *worst* finding (max severity),
 * 0 when the scene was clean — so a clean streak decays the score back
 * toward zero at the same rate it rose. */
export function updateDriftScore(prev: number, findings: DriftFinding[]): number {
  const signal = findings.reduce((max, f) => Math.max(max, f.severity), 0);
  const next = DRIFT_EMA_ALPHA * signal + (1 - DRIFT_EMA_ALPHA) * prev;
  return Math.max(0, Math.min(1, next));
}

/** Turns findings at/above the threshold into correction texts, worst
 * first, capped at `DRIFT_MAX_CORRECTIONS`. */
export function buildCorrections(findings: DriftFinding[]): string[] {
  return findings
    .filter((f) => f.severity >= DRIFT_SEVERITY_THRESHOLD)
    .sort((a, b) => b.severity - a.severity)
    .slice(0, DRIFT_MAX_CORRECTIONS)
    .map((f) => `${f.subject}: ${f.contradiction}`);
}

/** Merges new corrections into existing ones: a duplicate (same text)
 * refreshes its TTL instead of stacking; the combined list is re-capped. */
export function mergeCorrections(
  existing: DriftCorrection[],
  incoming: string[],
): DriftCorrection[] {
  const merged = [...existing];
  for (const text of incoming) {
    const dup = merged.find((c) => c.text === text);
    if (dup) {
      dup.ttl = DRIFT_CORRECTION_TTL;
    } else {
      merged.push({ text, ttl: DRIFT_CORRECTION_TTL });
    }
  }
  return merged.slice(-DRIFT_MAX_CORRECTIONS);
}

// ---- Persistence (settings table, one JSON blob per chat) ---------------

const driftKey = (chatId: string) => `drift_state_${chatId}`;

export async function getDriftState(chatId: string): Promise<DriftState> {
  try {
    const raw = await getSetting(driftKey(chatId));
    if (!raw) return defaultDriftState();
    const parsed = JSON.parse(raw) as Partial<DriftState>;
    return {
      score: typeof parsed.score === "number" ? parsed.score : 0,
      corrections: Array.isArray(parsed.corrections)
        ? parsed.corrections.filter(
            (c): c is DriftCorrection =>
              !!c && typeof c.text === "string" && typeof c.ttl === "number",
          )
        : [],
      lastCheckedAt: typeof parsed.lastCheckedAt === "string" ? parsed.lastCheckedAt : null,
    };
  } catch {
    return defaultDriftState();
  }
}

async function saveDriftState(chatId: string, state: DriftState): Promise<void> {
  await setSetting(driftKey(chatId), JSON.stringify(state));
}

/** Called once per prompt build (send/regenerate): returns the texts of the
 * currently active corrections and decrements their TTLs, dropping expired
 * ones. The decrement-and-persist happens here so a correction rides along
 * exactly `DRIFT_CORRECTION_TTL` sends and then silently disappears. */
export async function consumeDriftCorrections(chatId: string): Promise<string[]> {
  try {
    const state = await getDriftState(chatId);
    if (state.corrections.length === 0) return [];
    const texts = state.corrections.map((c) => c.text);
    const remaining = state.corrections
      .map((c) => ({ ...c, ttl: c.ttl - 1 }))
      .filter((c) => c.ttl > 0);
    await saveDriftState(chatId, { ...state, corrections: remaining });
    return texts;
  } catch {
    return [];
  }
}

// ---- LLM check ----------------------------------------------------------



export interface CanonFactLike {
  subject: string;
  fact: string;
}

function formatCanon(facts: CanonFactLike[]): string {
  return facts.map((f) => `- (${f.subject}) ${f.fact}`).join("\n");
}

function formatTranscript(messages: TranscriptChatMessage[]): string {
  return messages
    .map((m) => `${m.speakerName ?? (m.role === "assistant" ? "AI" : "Hráč")}: ${m.content}`)
    .join("\n");
}

/** One background drift check. Only runs when there are canon (locked)
 * facts; updates the EMA score every time and queues silent corrections for
 * findings above the threshold. Runs on the extraction connection at
 * temperature 0. Never throws. */
export async function runDriftCheck(
  chatId: string,
  connection: ConnectionConfig,
  canonFacts: CanonFactLike[],
  messages: TranscriptChatMessage[],
  lang?: string,
): Promise<void> {
  try {
    if (canonFacts.length === 0 || messages.length === 0) return;

    const language = lang ?? "cs";

    const prompt: ChatMessage[] = [
      { role: "system", content: DRIFT_CHECK_SYSTEM_PROMPT(language) },
      {
        role: "user",
        content: `CANON:\n${formatCanon(canonFacts)}\n\nLATEST SCENES:\n${formatTranscript(messages)}`,
      },
    ];

    const zeroTemp: ConnectionConfig = { ...connection, temperature: 0 };
    const raw = await chatComplete(zeroTemp, prompt);
    const inputTokens = prompt.reduce((sum, m) => sum + estimateTokens(m.content), 0);
    void logUsage("memory", connection.id, inputTokens, estimateTokens(raw)).catch(() => {});

    const findings = parseDriftOutput(raw);
    const state = await getDriftState(chatId);
    const next: DriftState = {
      score: updateDriftScore(state.score, findings),
      corrections: mergeCorrections(state.corrections, buildCorrections(findings)),
      lastCheckedAt: new Date().toISOString(),
    };
    await saveDriftState(chatId, next);
  } catch (err) {
    console.warn("driftDetector: drift check failed for chat", chatId, err);
  }
}
