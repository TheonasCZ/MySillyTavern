import { useTranslation } from "react-i18next";

import type { ConditionEntry, ModificationEntry, SkillEntry } from "../../db/repositories/personasRepo";

interface Props {
  /** Persona's static age (template value, never touched by gameplay). */
  age: number | null;
  /** Chat-scoped live level/xp (see chatsRepo.Chat.level/xp). */
  level: number;
  xp: number;
  /** Chat-scoped live conditions — doubles as buffs and wound-tracking
   *  (the game has no separate HP stat). */
  conditions: ConditionEntry[];
  /** Chat-scoped live body modifications. */
  modifications: ModificationEntry[];
  /** Chat-scoped live skills — the centerpiece of this panel. */
  skills: SkillEntry[];
  onClose: () => void;
}

/** "Postava" (character) overview panel — a sibling to InventoryPanel and
 *  QuestPanel showing the player's current in-campaign status at a glance:
 *  age, level/xp, conditions (buffs/wounds), body modifications, and skills. */
export function CharacterPanel({ age, level, xp, conditions, modifications, skills, onClose }: Props) {
  const { t } = useTranslation("chat");

  return (
    <aside
      className="flex h-full w-72 shrink-0 flex-col border-l"
      style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-surface)" }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between border-b px-3 py-2"
        style={{ borderColor: "var(--color-border)" }}
      >
        <h3 className="font-[var(--font-display)] text-sm">
          {t("character.title", "Postava")}
        </h3>
        <button onClick={onClose} className="text-xs" style={{ color: "var(--color-text-faint)" }}>
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {/* Age + Level/XP summary */}
        <div className="mb-4 flex gap-2">
          <div
            className="flex-1 rounded-[var(--radius-md)] border p-2 text-center"
            style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-elevated)" }}
          >
            <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>
              {t("character.age", "Věk")}
            </div>
            <div className="text-sm font-medium">
              {age != null ? age : t("character.ageUnknown", "?")}
            </div>
          </div>
          <div
            className="flex-1 rounded-[var(--radius-md)] border p-2 text-center"
            style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-elevated)" }}
          >
            <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>
              {t("character.level", "Úroveň")}
            </div>
            <div className="text-sm font-medium">{level}</div>
          </div>
          <div
            className="flex-1 rounded-[var(--radius-md)] border p-2 text-center"
            style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-elevated)" }}
          >
            <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>
              {t("character.xp", "Zkušenosti")}
            </div>
            <div className="text-sm font-medium">{xp}</div>
          </div>
        </div>

        {/* Skills — the centerpiece of this panel */}
        <div className="mb-4">
          <h4
            className="mb-2 text-[10px] font-bold uppercase tracking-wider"
            style={{ color: "var(--color-text-faint)" }}
          >
            {t("character.skills", "Dovednosti")}
          </h4>
          {skills.length === 0 ? (
            <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              {t("character.skillsEmpty", "Zatím žádné dovednosti.")}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {skills.map((s) => (
                <div
                  key={s.name}
                  className="flex items-center justify-between gap-2 rounded-[var(--radius-md)] border px-3 py-2"
                  style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-elevated)" }}
                >
                  <span className="text-sm font-medium truncate">{s.name}</span>
                  <span
                    className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold"
                    style={{ backgroundColor: "var(--color-accent)", color: "var(--color-accent-contrast)" }}
                  >
                    {s.level}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Conditions — buffs and wound-tracking (no separate HP stat) */}
        <div className="mb-4">
          <h4
            className="mb-2 text-[10px] font-bold uppercase tracking-wider"
            style={{ color: "var(--color-text-faint)" }}
          >
            {t("character.conditions", "Kondice a zranění")}
          </h4>
          {conditions.length === 0 ? (
            <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              {t("character.conditionsEmpty", "Žádné aktivní kondice.")}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {conditions.map((c) => (
                <div
                  key={c.name}
                  className="rounded-[var(--radius-md)] border p-2"
                  style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-elevated)" }}
                >
                  <span className="text-sm font-medium">{c.name}</span>
                  {c.description && (
                    <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
                      {c.description}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Body modifications */}
        <div>
          <h4
            className="mb-2 text-[10px] font-bold uppercase tracking-wider"
            style={{ color: "var(--color-text-faint)" }}
          >
            {t("character.modifications", "Tělesné modifikace")}
          </h4>
          {modifications.length === 0 ? (
            <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              {t("character.modificationsEmpty", "Žádné tělesné modifikace.")}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {modifications.map((m) => (
                <div
                  key={m.name}
                  className="rounded-[var(--radius-md)] border p-2"
                  style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-elevated)" }}
                >
                  <span className="text-sm font-medium">{m.name}</span>
                  {m.description && m.description !== m.name && (
                    <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
                      {m.description}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
