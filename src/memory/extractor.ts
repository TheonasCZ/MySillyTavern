/** Ledger extractor (plan §6.3). The parser and merge-decision logic are
 * pure functions (no DB/Tauri import) so they're unit-testable in
 * isolation; `runExtraction` is the thin orchestration layer that wires
 * them to `chat_complete` and `ledgerRepo`. */

import { chatComplete } from "../providers/chatComplete";
import type { ChatMessage, ConnectionConfig } from "../providers/types";
import {
  applyLedgerRemove,
  applyLedgerUpsert,
  listAllFacts,
  type LedgerCategory,
} from "../db/repositories/ledgerRepo";

export type ExtractAction = "upsert" | "remove";

export interface ExtractedFact {
  category: LedgerCategory;
  subject: string;
  fact: string;
  action: ExtractAction;
}

const VALID_CATEGORIES: LedgerCategory[] = ["player", "world", "npc", "event", "quest"];

function isExtractedFact(value: unknown): value is ExtractedFact {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.category === "string" &&
    VALID_CATEGORIES.includes(v.category as LedgerCategory) &&
    typeof v.subject === "string" &&
    v.subject.trim().length > 0 &&
    typeof v.fact === "string" &&
    (v.action === "upsert" || v.action === "remove")
  );
}

/** Tolerant parser for the extractor's LLM output: strips ```json fences
 * (or any code fence), finds the first `[...]` JSON array substring, and
 * validates each element's shape. Malformed/missing elements are dropped
 * rather than failing the whole batch — a partially-useful extraction is
 * better than none, and callers only merge what parses. Returns `[]`
 * (never throws) on completely unparseable input so a bad LLM response
 * never crashes the game per plan §9. */
export function parseExtractorOutput(raw: string): ExtractedFact[] {
  if (!raw) return [];
  const withoutFences = raw.replace(/```[a-zA-Z]*\n?/g, "").replace(/```/g, "");
  const start = withoutFences.indexOf("[");
  const end = withoutFences.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return [];
  const candidate = withoutFences.slice(start, end + 1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isExtractedFact).map((f) => ({
    category: f.category,
    subject: f.subject.trim(),
    fact: f.fact.trim(),
    action: f.action,
  }));
}

// ---- Merge decision (pure) --------------------------------------------

export interface LedgerSnapshotFact {
  id: string;
  category: LedgerCategory;
  subject: string;
  fact: string;
  status: "active" | "archived";
  locked: boolean;
}

export type MergeOpKind = "insert" | "update" | "archive" | "skip";

export interface MergeOp {
  kind: MergeOpKind;
  category: LedgerCategory;
  subject: string;
  fact: string;
  /** Present for update/archive/skip — the existing row it targets. */
  factId?: string;
  /** Why an op was skipped (locked, or remove of a nonexistent fact). */
  reason?: string;
}

/** Decides, for each extracted fact, what should happen to the ledger —
 * identity is (category, lower(subject)) per plan §6.3:
 *   - locked existing row → skip
 *   - existing row, action upsert → update its fact text
 *   - no existing row, action upsert → insert
 *   - existing row, action remove → archive
 *   - no existing row, action remove → skip (nothing to remove)
 * Pure and side-effect free — `runExtraction` below applies the resulting
 * ops through `ledgerRepo`. */
export function mergeExtractedFacts(
  existing: LedgerSnapshotFact[],
  extracted: ExtractedFact[],
): MergeOp[] {
  const findExisting = (category: LedgerCategory, subject: string) =>
    existing.find((f) => f.category === category && f.subject.toLowerCase() === subject.toLowerCase());

  return extracted.map((item): MergeOp => {
    const match = findExisting(item.category, item.subject);

    if (item.action === "remove") {
      if (!match) {
        return { kind: "skip", category: item.category, subject: item.subject, fact: item.fact, reason: "not-found" };
      }
      if (match.locked) {
        return { kind: "skip", category: item.category, subject: item.subject, fact: item.fact, factId: match.id, reason: "locked" };
      }
      return { kind: "archive", category: item.category, subject: item.subject, fact: item.fact, factId: match.id };
    }

    // action === 'upsert'
    if (!match) {
      return { kind: "insert", category: item.category, subject: item.subject, fact: item.fact };
    }
    if (match.locked) {
      return { kind: "skip", category: item.category, subject: item.subject, fact: item.fact, factId: match.id, reason: "locked" };
    }
    return { kind: "update", category: item.category, subject: item.subject, fact: item.fact, factId: match.id };
  });
}

// ---- Orchestration (DB + chat_complete) --------------------------------

const EXTRACTION_SYSTEM_PROMPT =
  "Jsi analytický nástroj, který extrahuje herní fakta z RP konverzace do strukturovaného " +
  "ledgeru. Dostaneš aktuální snapshot ledgeru (co už je zaznamenáno) a nové zprávy z hry. " +
  "Vrať POUZE JSON pole objektů ve tvaru " +
  '{"category": "player"|"world"|"npc"|"event"|"quest", "subject": string, "fact": string, "action": "upsert"|"remove"}. ' +
  "Zaznamenávej jen fakta trvalé povahy (kdo je kdo, co se stalo, kde jsme, cíle úkolů) — " +
  "ne přechodné popisy nálady nebo dialogu. Použij 'remove' pro fakta, která už neplatí.\n\n" +
  "Zvláštní pozornost věnuj faktům, které brání driftu žánru a tónu hry — tato hra se hraje " +
  "klidně stovky zpráv a bez explicitně zaznamenaných hranic se svět i schopnosti hráče " +
  "postupně a nepozorovaně rozjedou jiným směrem, než jak hra začala:\n" +
  "- kategorie 'world': pokud konverzace zavádí nebo potvrzuje žánr/tón světa (např. \"klasická " +
  "fantasy, žádná vyspělá technologie\", \"magie je vzácná a nebezpečná\") nebo původ/pozadí " +
  "důležité postavy či společníka hráče (odkud pochází, jak byl nalezen/potkán), zaznamenej to " +
  "jako samostatný fakt subjektu 'Žánr a tón světa' resp. jménem té postavy — a pokud takový " +
  "fakt v ledgeru už existuje, aktualizuj ho (upsert), místo aby zůstal nezaznamenaný.\n" +
  "- kategorie 'player': kromě toho, čeho hráč dosáhl nebo co získal, zaznamenávej i JAKÉ MÁ " +
  "LIMITY a čeho NENÍ schopen — např. \"hráč neumí přímo sesílat magii, jen řemeslně vyrábět " +
  "artefakty\", \"vylepšení vyžadují dny práce a materiál, nejdou improvizovat okamžitě\". Fakt " +
  "o limitu zapiš i tehdy, když ho konverzace jen nepřímo potvrzuje tím, že se hráč musí snažit " +
  "nebo mu něco nejde napoprvé — je to obrana proti tomu, aby hráč postupně a nenápadně získal " +
  "neomezenou moc.\n" +
  "V případě rozporu mezi tím, co se v poslední zprávě odehrálo, a dřívějším zamčeným " +
  "([ZAMČENO]) faktem, dřívější zamčený fakt nikdy nepřepisuj (nepoužívej na něj upsert ani " +
  "remove) — konverzace se s ním musí srovnat, ne naopak.\n\n" +
  "Pokud není nic nového k zaznamenání, vrať prázdné pole []. Žádný text mimo JSON pole.";

function formatSnapshot(facts: LedgerSnapshotFact[]): string {
  if (facts.length === 0) return "(ledger je zatím prázdný)";
  return facts
    .filter((f) => f.status === "active")
    .map((f) => `- (${f.category}/${f.subject}) ${f.fact}${f.locked ? " [ZAMČENO]" : ""}`)
    .join("\n");
}

/** Transcript message with an optional group-chat speaker name (plan §M10)
 * — additive over `ChatMessage` so existing callers still typecheck. */
export type TranscriptChatMessage = ChatMessage & { speakerName?: string | null };

function formatNewMessages(messages: TranscriptChatMessage[]): string {
  return messages
    .map((m) => `${m.speakerName ?? (m.role === "assistant" ? "AI" : "Hráč")}: ${m.content}`)
    .join("\n");
}

/** Runs one extraction pass for a chat: builds the prompt from the current
 * ledger snapshot + the given new messages, calls `chat_complete` on the
 * extraction connection (temperature 0), parses the result, and merges it
 * into the ledger. Never throws — failures are logged and swallowed so a
 * bad extraction never interrupts the game (plan §6.3/§9); the caller
 * (memoryEngine) retries on the next interval. */
export async function runExtraction(
  chatId: string,
  connection: ConnectionConfig,
  newMessages: TranscriptChatMessage[],
): Promise<void> {
  try {
    const existingRows = await listAllFacts(chatId);
    const snapshot: LedgerSnapshotFact[] = existingRows.map((f) => ({
      id: f.id,
      category: f.category,
      subject: f.subject,
      fact: f.fact,
      status: f.status,
      locked: f.locked,
    }));

    const prompt: ChatMessage[] = [
      { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Snapshot ledgeru:\n${formatSnapshot(snapshot)}\n\nNové zprávy:\n${formatNewMessages(newMessages)}`,
      },
    ];

    const zeroTempConnection: ConnectionConfig = { ...connection, temperature: 0 };
    const raw = await chatComplete(zeroTempConnection, prompt);
    const extracted = parseExtractorOutput(raw);
    if (extracted.length === 0) return;

    const ops = mergeExtractedFacts(snapshot, extracted);
    for (const op of ops) {
      if (op.kind === "insert" || op.kind === "update") {
        await applyLedgerUpsert(chatId, op.category, op.subject, op.fact);
      } else if (op.kind === "archive") {
        await applyLedgerRemove(chatId, op.category, op.subject);
      }
      // "skip" ops are no-ops by definition (locked, or nothing to remove).
    }
  } catch (err) {
    console.warn("ledger extraction failed", err);
  }
}
