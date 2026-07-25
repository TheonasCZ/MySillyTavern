import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { SkillEntry } from "../../db/repositories/personasRepo";

interface CraftingRecipe {
  resultItem: string;
  ingredients: string[];
  skillName?: string | null;
  perks: string[];
  craftedAt?: string | null;
}

interface Props {
  skills: SkillEntry[];
  inventory: { item: string; qty: number }[];
  recipes: CraftingRecipe[];
  /** Called when the user clicks a skill/recipe reference — the caller
   *  should pass this text to ChatInput's `insertRef` prop or the
   *  `__mstInsertPrompt` global. */
  onInsert: (text: string) => void;
}

type Tab = "skills" | "recipes";

export function ReferencePanel({ skills, inventory, recipes, onInsert }: Props) {
  const { t } = useTranslation("chat");
  const [tab, setTab] = useState<Tab>("skills");
  const [search, setSearch] = useState("");

  const filteredSkills = useMemo(() => {
    if (!search) return skills;
    const q = search.toLowerCase();
    return skills.filter((s) => s.name.toLowerCase().includes(q));
  }, [skills, search]);

  const filteredRecipes = useMemo(() => {
    const inventoryNames = new Set(inventory.map((i) => i.item.toLowerCase()));
    // Score recipes: those with available ingredients first, then by name
    const scored = recipes.map((r) => {
      const hasAll = r.ingredients.every((ing) => inventoryNames.has(ing.toLowerCase()));
      const hasSome = r.ingredients.some((ing) => inventoryNames.has(ing.toLowerCase()));
      return { ...r, hasAll, hasSome };
    });
    if (!search) {
      scored.sort((a, b) => {
        if (a.hasAll !== b.hasAll) return a.hasAll ? -1 : 1;
        if (a.hasSome !== b.hasSome) return a.hasSome ? -1 : 1;
        return a.resultItem.localeCompare(b.resultItem);
      });
      return scored;
    }
    const q = search.toLowerCase();
    return scored
      .filter((r) => r.resultItem.toLowerCase().includes(q)
        || r.ingredients.some((ing) => ing.toLowerCase().includes(q)))
      .sort((a, b) => {
        if (a.hasAll !== b.hasAll) return a.hasAll ? -1 : 1;
        if (a.hasSome !== b.hasSome) return a.hasSome ? -1 : 1;
        return a.resultItem.localeCompare(b.resultItem);
      });
  }, [recipes, inventory, search]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b p-2" style={{ borderColor: "var(--color-border)" }}>
        {(["skills", "recipes"] as Tab[]).map((tabName) => (
          <button
            key={tabName}
            type="button"
            onClick={() => setTab(tabName)}
            className="rounded-[var(--radius-sm)] px-3 py-1 text-xs font-medium transition-colors"
            style={{
              backgroundColor: tab === tabName ? "var(--color-accent)" : "transparent",
              color: tab === tabName ? "var(--color-accent-contrast, #fff)" : "var(--color-text-muted)",
            }}
          >
            {tabName === "skills" ? t("room.skillsTitle", "Skills") : t("room.recipesTitle", "Recipes")}
          </button>
        ))}
        <div className="flex-1" />
        <input
          type="text"
          placeholder={tab === "skills" ? "🔍 skill…" : "🔍 recept…"}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-[var(--radius-sm)] border px-2 py-1 text-xs"
          style={{
            borderColor: "var(--color-border)",
            backgroundColor: "var(--color-surface-2)",
            color: "var(--color-text)",
            width: "120px",
          }}
        />
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {tab === "skills" && (
          filteredSkills.length === 0 ? (
            <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              {t("room.skillsEmpty", "No skills yet.")}
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              {filteredSkills.map((s) => (
                <button
                  key={s.name}
                  type="button"
                  onClick={() => onInsert(`@${s.name}`)}
                  className="flex items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-xs transition-colors hover:opacity-80"
                  style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text)" }}
                >
                  <span className="font-medium">{s.name}</span>
                  <span style={{ color: "var(--color-accent)" }}>{s.level}</span>
                </button>
              ))}
            </div>
          )
        )}

        {tab === "recipes" && (
          filteredRecipes.length === 0 ? (
            <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              {t("room.recipesEmpty", "No recipes yet.")}
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              {filteredRecipes.map((r) => (
                <button
                  key={r.resultItem}
                  type="button"
                  onClick={() => onInsert(`@craft ${r.resultItem}`)}
                  className="flex flex-col gap-0.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-xs transition-colors hover:opacity-80"
                  style={{
                    backgroundColor: r.hasAll ? "var(--color-success-subtle, rgba(34,197,94,0.12))"
                      : r.hasSome ? "var(--color-surface-2)"
                      : "var(--color-surface-2)",
                    color: "var(--color-text)",
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span>{r.craftedAt ? "✓" : "✗"}</span>
                    <span className="font-medium">{r.resultItem}</span>
                  </div>
                  <div className="flex flex-wrap gap-1" style={{ color: "var(--color-text-muted)" }}>
                    {r.ingredients.map((ing) => {
                      const has = inventory.some((i) => i.item.toLowerCase() === ing.toLowerCase());
                      return (
                        <span
                          key={ing}
                          style={{ color: has ? "var(--color-success)" : "var(--color-text-faint)" }}
                        >
                          {ing}
                        </span>
                      );
                    })}
                  </div>
                  {r.skillName && (
                    <span style={{ color: "var(--color-text-faint)" }}>skill: {r.skillName}</span>
                  )}
                </button>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}
