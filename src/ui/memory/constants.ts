import type { LedgerCategory } from "../../db/repositories/ledgerRepo";

export { inputStyle } from "../common/inputStyle";

export const CATEGORIES: LedgerCategory[] = ["world", "player", "npc", "quest", "event"];

export type Tab = "facts" | "summary" | "search" | "prompt" | "chronicle";
