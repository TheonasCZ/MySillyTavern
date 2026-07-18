import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { appDataDir, join } from "@tauri-apps/api/path";
import { openDialog, showConfirm } from "../../platform";

import type { Persona, PersonaDraft, PersonaUpdate, SkillEntry, InventoryEntry } from "../../db/repositories/personasRepo";
import type { FactionRep } from "../../db/repositories/factionsRepo";
import { listFactions } from "../../db/repositories/factionsRepo";
import { useConnectionsStore } from "../../stores/connectionsStore";
import { getSetting } from "../../db/repositories/settingsRepo";
import { avatarSrc } from "../characters/avatarSrc";
import { toConnectionDto } from "../../providers/dto";

const inputStyle = {
  backgroundColor: "var(--color-surface-2)",
  borderColor: "var(--color-border-strong)",
  color: "var(--color-text)",
} as const;

interface Props {
  initial: Persona | null;
  onSave: (draft: PersonaDraft | PersonaUpdate) => Promise<void>;
  onDelete?: () => Promise<void>;
  onSetDefault?: () => Promise<void>;
  onPickAvatar?: (path: string) => Promise<void>;
  onCancel: () => void;
}

export function PersonaForm({ initial, onSave, onDelete, onSetDefault, onPickAvatar, onCancel }: Props) {
  const { t } = useTranslation(["personas", "common"]);
  const [name, setName] = useState(initial?.name ?? "");
  const [gender, setGender] = useState(initial?.gender ?? "");
  const [age, setAge] = useState(initial?.age?.toString() ?? "");
  const [race, setRace] = useState(initial?.race ?? "");
  const [appearance, setAppearance] = useState(initial?.appearance ?? "");
  const [progression, setProgression] = useState<"skill" | "level" | "none">(initial?.progression ?? "skill");
  const [skills, setSkills] = useState<SkillEntry[]>(initial?.skills ?? []);
  const [inventory, setInventory] = useState<InventoryEntry[]>(initial?.inventory ?? []);
  const [saving, setSaving] = useState(false);
  const [factions, setFactions] = useState<FactionRep[]>([]);

  useEffect(() => {
    if (initial) {
      listFactions(initial.id).then(setFactions).catch(() => setFactions([]));
    } else {
      setFactions([]);
    }
  }, [initial?.id]);

  const buildDraft = (): PersonaDraft | PersonaUpdate => ({
    name,
    gender,
    age: age ? parseInt(age, 10) : null,
    race,
    appearance,
    progression,
    skills: skills.filter((s) => s.name.trim()),
    inventory: inventory.filter((inv) => inv.item.trim()),
  });

  const handleSave = async () => {
    setSaving(true);
    try {
      if (initial) {
        await onSave(buildDraft() as PersonaUpdate);
      } else {
        await onSave({ ...buildDraft(), avatarPath: null } as PersonaDraft);
      }
    } finally {
      setSaving(false);
    }
  };

  const handlePickAvatar = async () => {
    if (!onPickAvatar) return;
    const avatarsDir = await appDataDir().then((d) => join(d, "avatars")).catch(() => undefined);
    const path = await openDialog({
      multiple: false,
      defaultPath: avatarsDir,
      filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp"] }],
    });
    if (!path || Array.isArray(path)) return;
    await onPickAvatar(path);
  };

  /* --- Skills helpers --- */
  const addSkill = () => setSkills([...skills, { name: "", level: 1 }]);
  const updateSkill = (i: number, patch: Partial<SkillEntry>) => {
    const next = [...skills];
    next[i] = { ...next[i], ...patch };
    setSkills(next);
  };
  const removeSkill = (i: number) => setSkills(skills.filter((_, idx) => idx !== i));

  /* --- Inventory helpers --- */
  const addItem = () => setInventory([...inventory, { item: "", qty: 1 }]);
  const updateItem = (i: number, patch: Partial<InventoryEntry>) => {
    const next = [...inventory];
    next[i] = { ...next[i], ...patch };
    setInventory(next);
  };
  const removeItem = (i: number) => setInventory(inventory.filter((_, idx) => idx !== i));

  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  const handleGenerateAvatar = async () => {
    if (!onPickAvatar || !initial) return;
    setGenError(null);
    setGenerating(true);
    try {
      const enabled = await getSetting("image_gen_enabled");
      if (enabled === "0") throw new Error("Generování obrázků je vypnuto v nastavení.");

      const connId =
        (await getSetting("image_gen_connection_id")) ??
        useConnectionsStore.getState().connections.find((c) => c.purposes.includes("image"))?.id;
      if (!connId) throw new Error("Není dostupné žádné Gemini připojení. Vytvoř ho v Nastavení → Připojení.");
      const cfg = useConnectionsStore.getState().connections.find((c) => c.id === connId);
      if (!cfg) throw new Error("Ilustrační připojení nenalezeno.");

      const desc = [appearance, `${name} — ${gender || "?"}${age ? `, ${age} let` : ""}${race ? `, ${race}` : ""}`]
        .filter(Boolean)
        .join(". ");
      const prompt = `Fantasy portrait illustration of: ${desc}. Style: painted, atmospheric, RPG character art.`;

      const path = await invoke<string>("generate_illustration", {
        connection: toConnectionDto(cfg),
        prompt,
      });
      await onPickAvatar(path);
    } catch (e: unknown) {
      setGenError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div
      className="flex flex-col gap-4 rounded-[var(--radius-md)] border p-4"
      style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-elevated)" }}
    >
      {/* Header: avatar + name */}
      <div className="flex items-start gap-4">
        <div
          className="h-20 w-20 shrink-0 overflow-hidden rounded-[var(--radius-md)]"
          style={{ backgroundColor: "var(--color-surface-2)" }}
        >
          {initial && avatarSrc(initial.avatarPath) ? (
            <img src={avatarSrc(initial.avatarPath)} alt={name} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <span className="font-[var(--font-display)] text-2xl" style={{ color: "var(--color-text-faint)" }}>
                {name.slice(0, 1).toUpperCase() || "?"}
              </span>
            </div>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span>{t("form.fields.name")}</span>
            <input
              className="rounded-[var(--radius-sm)] border px-2 py-1.5"
              style={inputStyle}
              value={name}
              placeholder={t("form.fields.namePlaceholder") ?? ""}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          {initial && onPickAvatar && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handlePickAvatar()}
                  className="rounded-[var(--radius-sm)] px-2 py-1 text-xs"
                  style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text-muted)" }}
                >
                  {t("form.pickAvatar")}
                </button>
                <button
                  type="button"
                  onClick={() => void handleGenerateAvatar()}
                  disabled={generating}
                  className="rounded-[var(--radius-sm)] px-2 py-1 text-xs disabled:opacity-50"
                  style={{
                    backgroundColor: generating ? "var(--color-accent)" : "var(--color-surface-2)",
                    color: generating ? "var(--color-accent-contrast)" : "var(--color-text-muted)",
                  }}
                >
                  {generating ? "⏳ Generuji…" : `✨ ${t("form.generateAvatar")}`}
                </button>
              </div>
              {genError && (
                <span className="text-xs" style={{ color: "var(--color-danger)" }}>
                  {genError}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Identity row: gender / age / race */}
      <div className="grid grid-cols-3 gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span>{t("form.fields.gender")}</span>
          <input
            className="rounded-[var(--radius-sm)] border px-2 py-1.5"
            style={inputStyle}
            value={gender}
            placeholder={t("form.fields.genderPlaceholder") ?? ""}
            onChange={(e) => setGender(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>{t("form.fields.age")}</span>
          <input
            type="number"
            className="rounded-[var(--radius-sm)] border px-2 py-1.5"
            style={inputStyle}
            value={age}
            placeholder="0"
            min={1}
            max={9999}
            onChange={(e) => setAge(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>{t("form.fields.race")}</span>
          <input
            className="rounded-[var(--radius-sm)] border px-2 py-1.5"
            style={inputStyle}
            value={race}
            placeholder={t("form.fields.racePlaceholder") ?? ""}
            onChange={(e) => setRace(e.target.value)}
          />
        </label>
      </div>

      {/* Appearance */}
      <label className="flex flex-col gap-1 text-sm">
        <span>{t("form.fields.appearance")}</span>
        <textarea
          className="min-h-[4rem] rounded-[var(--radius-sm)] border px-2 py-1.5 text-sm"
          style={{ ...inputStyle, whiteSpace: "pre-wrap", wordBreak: "break-word", overflowWrap: "break-word" }}
          value={appearance}
          placeholder={t("form.fields.appearancePlaceholder") ?? ""}
          onChange={(e) => setAppearance(e.target.value)}
        />
      </label>

      {/* Progression */}
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{t("form.fields.progression")}</span>
        <div className="flex flex-wrap gap-3">
          {(["skill", "level", "none"] as const).map((v) => (
            <label key={v} className="flex items-center gap-1.5 text-sm cursor-pointer">
              <input
                type="radio"
                name="progression"
                value={v}
                checked={progression === v}
                onChange={() => setProgression(v)}
              />
              <span>{t(`form.fields.progression${v.charAt(0).toUpperCase() + v.slice(1)}` as any)}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Factions (read-only) */}
      {initial && factions.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">{t("form.fields.factions")}</span>
          <div className="flex flex-col gap-1.5">
            {factions.map((f) => {
              const pct = ((f.reputation + 100) / 200) * 100;
              let color = "var(--color-text-muted)";
              if (f.reputation <= -50) color = "var(--color-danger)";
              else if (f.reputation <= -20) color = "#d4a017";
              else if (f.reputation >= 50) color = "#c9a32e";
              else if (f.reputation >= 20) color = "var(--color-accent)";
              return (
                <div key={f.id} className="flex items-center gap-2 text-xs">
                  <span className="w-24 truncate" style={{ color: "var(--color-text)" }}>{f.factionName}</span>
                  <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ backgroundColor: "var(--color-surface-2)" }}>
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${pct}%`, backgroundColor: color }}
                    />
                  </div>
                  <span className="w-10 text-right tabular-nums" style={{ color: "var(--color-text-muted)" }}>{f.reputation}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Skills */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{t("form.fields.skills")}</span>
          <button
            type="button"
            onClick={addSkill}
            className="rounded-[var(--radius-sm)] px-2 py-0.5 text-xs"
            style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text-muted)" }}
          >
            + {t("form.addSkill")}
          </button>
        </div>
        {skills.map((skill, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              className="flex-1 rounded-[var(--radius-sm)] border px-2 py-1 text-xs"
              style={inputStyle}
              value={skill.name}
              placeholder={t("form.fields.skillName") ?? "Skill"}
              onChange={(e) => updateSkill(i, { name: e.target.value })}
            />
            <input
              type="number"
              className="w-16 rounded-[var(--radius-sm)] border px-2 py-1 text-xs"
              style={inputStyle}
              value={skill.level}
              min={1}
              max={100}
              onChange={(e) => updateSkill(i, { level: parseInt(e.target.value, 10) || 1 })}
            />
            <button
              type="button"
              onClick={() => removeSkill(i)}
              className="text-xs"
              style={{ color: "var(--color-danger)" }}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {/* Inventory */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{t("form.fields.inventory")}</span>
          <button
            type="button"
            onClick={addItem}
            className="rounded-[var(--radius-sm)] px-2 py-0.5 text-xs"
            style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text-muted)" }}
          >
            + {t("form.addItem")}
          </button>
        </div>
        {inventory.map((inv, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              className="flex-1 rounded-[var(--radius-sm)] border px-2 py-1 text-xs"
              style={inputStyle}
              value={inv.item}
              placeholder={t("form.fields.itemName") ?? "Item"}
              onChange={(e) => updateItem(i, { item: e.target.value })}
            />
            <input
              type="number"
              className="w-14 rounded-[var(--radius-sm)] border px-2 py-1 text-xs"
              style={inputStyle}
              value={inv.qty}
              min={1}
              onChange={(e) => updateItem(i, { qty: parseInt(e.target.value, 10) || 1 })}
            />
            <input
              className="w-32 rounded-[var(--radius-sm)] border px-2 py-1 text-xs"
              style={inputStyle}
              value={inv.note ?? ""}
              placeholder={t("form.fields.itemNote") ?? "note"}
              onChange={(e) => updateItem(i, { note: e.target.value || undefined })}
            />
            <button
              type="button"
              onClick={() => removeItem(i)}
              className="text-xs"
              style={{ color: "var(--color-danger)" }}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {/* Default badge */}
      {initial?.isDefault && (
        <span className="text-xs font-medium" style={{ color: "var(--color-accent)" }}>
          {t("form.isDefaultBadge")}
        </span>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2 border-t pt-3" style={{ borderColor: "var(--color-border)" }}>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || !name.trim()}
          className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          style={{ backgroundColor: "var(--color-accent)", color: "var(--color-accent-contrast)" }}
        >
          {t("actions.save", { ns: "common" })}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm"
          style={{ color: "var(--color-text-muted)" }}
        >
          {t("actions.cancel", { ns: "common" })}
        </button>
        {initial && onSetDefault && !initial.isDefault && (
          <button
            type="button"
            onClick={() => void onSetDefault()}
            className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm"
            style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text)" }}
          >
            {t("form.makeDefault")}
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            onClick={() => {
              void (async () => { if (await showConfirm(t("form.deleteConfirm") ?? "")) void onDelete(); })();
            }}
            className="ml-auto rounded-[var(--radius-sm)] px-3 py-1.5 text-sm"
            style={{ color: "var(--color-danger)" }}
          >
            {t("actions.delete", { ns: "common" })}
          </button>
        )}
      </div>
    </div>
  );
}
