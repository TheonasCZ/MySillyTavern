import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { InventoryEntry } from "../../db/repositories/personasRepo";
import { avatarSrc } from "../characters/avatarSrc";

interface Props {
  /** The chat's live gameplay inventory (chat-scoped, not the persona's
   *  starting-gear template — see chatsRepo.Chat.inventory). */
  inventory: InventoryEntry[];
  /** Persona race, only used to pick the background silhouette. */
  race?: string;
  onClose: () => void;
  onGenerateImage?: (item: InventoryEntry, index: number) => void;
}

/** SVG silhouette paths keyed by persona race. Falls back to human. */
const RACE_SILHOUETTES: Record<string, string> = {
  člověk: "M12 2a2 2 0 012 2v1h4v2h-1l-1 5h2v2h2v6h-2v4H6v-4H4v-6h2v-2H5L4 5H3V3h4V4a2 2 0 012-2zm-1 14h2v-2h-2v2zm4 0h2v-2h-2v2z",
  elf: "M12 2l2 4-2 2v3l3 2v3l-3-2-3 2v-3l3-2V8l-2-2 2-4zm-2 14h4v2h-4z",
  trpaslík: "M12 2a3 3 0 00-3 3v1h6V5a3 3 0 00-3-3zm-4 6v2h1l1 6h4l1-6h1V8H8z",
  skřítek: "M12 3l-2 3v2h4V6l-2-3zm-3 7v4h2l1 3h4l1-3h2v-4H9z",
};

function getSilhouette(race?: string): string {
  if (!race) return RACE_SILHOUETTES["člověk"];
  const lower = race.toLowerCase();
  for (const [key, path] of Object.entries(RACE_SILHOUETTES)) {
    if (lower.includes(key)) return path;
  }
  return RACE_SILHOUETTES["člověk"];
}

const SLOT_COUNT = 8;

export function InventoryPanel({ inventory, race, onClose, onGenerateImage }: Props) {
  const { t } = useTranslation("chat");
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; index: number } | null>(null);

  const items = inventory ?? [];
  const slots: (InventoryEntry | null)[] = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    slots.push(items[i] ?? null);
  }

  return (
    <>
    <aside
      className="flex h-full w-72 shrink-0 flex-col border-l"
      style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-surface)" }}

    >
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2" style={{ borderColor: "var(--color-border)" }}>
        <h3 className="font-[var(--font-display)] text-sm">{t("inventory.title", "Inventář")}</h3>
        <button onClick={onClose} className="text-xs" style={{ color: "var(--color-text-faint)" }}>
          ✕
        </button>
      </div>

      {/* Body with silhouette background */}
      <div className="relative flex-1 overflow-y-auto p-3">
        {/* Silhouette */}
        <svg
          viewBox="0 0 24 24"
          className="absolute inset-0 m-auto h-48 w-48 opacity-[0.06] pointer-events-none"
          fill="currentColor"
          style={{ color: "var(--color-text)" }}
        >
          <path d={getSilhouette(race)} />
        </svg>

        {/* Slots grid */}
        <div className="relative grid grid-cols-2 gap-3">
          {slots.map((item, i) => (
            <button
              key={i}
              type="button"
              onClick={() => item && setSelectedIndex(selectedIndex === i ? null : i)}
              onContextMenu={(e) => {
                e.preventDefault();
                if (item) setContextMenu({ x: e.clientX, y: e.clientY, index: i });
              }}
              disabled={!item}
              className={`flex aspect-square flex-col items-center justify-center gap-1 rounded-[var(--radius-md)] border-2 transition-colors ${
                selectedIndex === i ? "ring-2" : ""
              }`}
              style={{
                borderColor: item ? "var(--color-border-strong)" : "var(--color-border)",
                backgroundColor: item ? "var(--color-bg-elevated)" : "transparent",
                borderStyle: item ? "solid" : "dashed",
                opacity: item ? 1 : 0.3,
                ...(selectedIndex === i ? { borderColor: "var(--color-accent)", boxShadow: "0 0 8px var(--color-accent)" } : {}),
              }}
            >
              {item ? (
                <>
                  {/* Item image or placeholder */}
                  {item.image_path ? (
                    <img src={avatarSrc(item.image_path)} alt={item.item} className="h-12 w-12 rounded object-cover" />
                  ) : (
                    <span className="text-2xl" title={item.item}>
                      {item.item.length > 0 ? "📦" : ""}
                    </span>
                  )}
                  <span className="truncate text-[10px] leading-tight" style={{ color: "var(--color-text-muted)", maxWidth: "100%" }}>
                    {item.item}
                  </span>
                  {item.qty > 1 && (
                    <span
                      className="absolute right-1 top-1 rounded-full px-1.5 text-[10px] font-bold"
                      style={{ backgroundColor: "var(--color-accent)", color: "var(--color-accent-contrast)" }}
                    >
                      {item.qty}
                    </span>
                  )}
                </>
              ) : (
                <span className="text-lg" style={{ color: "var(--color-text-faint)" }}>+</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Item detail */}
      {selectedIndex !== null && slots[selectedIndex] && (
        <div
          className="flex flex-col gap-2 border-t px-3 py-3"
          style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-elevated)" }}
        >
          {(() => {
            const item = slots[selectedIndex]!;
            return (
              <>
                <div className="flex items-start gap-3">
                  {item.image_path ? (
                    <img src={avatarSrc(item.image_path)} alt={item.item} className="h-16 w-16 shrink-0 rounded-[var(--radius-md)] object-cover border" style={{ borderColor: "var(--color-border)" }} />
                  ) : (
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[var(--radius-md)] border" style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-surface-2)" }}>
                      <span className="text-3xl">📦</span>
                    </div>
                  )}
                  <div className="flex flex-col gap-1 min-w-0">
                    <span className="font-medium text-sm truncate">{item.item}</span>
                    {item.qty > 1 && (
                      <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>
                        {t("inventory.quantity", { count: item.qty, defaultValue: `Počet: ${item.qty}` })}
                      </span>
                    )}
                    {item.note && (
                      <p className="text-xs leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
                        {item.note}
                      </p>
                    )}
                  </div>
                </div>
                {onGenerateImage && (
                  <button
                    type="button"
                    onClick={() => onGenerateImage(item, selectedIndex)}
                    className="self-end rounded-[var(--radius-sm)] px-2 py-1 text-xs"
                    style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text-muted)" }}
                  >
                    ✨ {t("inventory.generateImage", "Generovat obrázek")}
                  </button>
                )}
              </>
            );
          })()}
        </div>
      )}
    </aside>
    {/* Context menu */}
    {contextMenu && (
      <>
        <div className="fixed inset-0 z-50" onClick={() => setContextMenu(null)} />
        <div
          className="fixed z-50 rounded-[var(--radius-sm)] border py-1 shadow-lg"
          style={{
            left: contextMenu.x,
            top: contextMenu.y,
            borderColor: "var(--color-border)",
            backgroundColor: "var(--color-bg-elevated)",
            minWidth: 160,
          }}
        >
          {(() => {
            const item = slots[contextMenu.index];
            const insertPrompt = () => {
              const fn = (window as unknown as Record<string, unknown>).__mstInsertPrompt as ((t: string) => void) | undefined;
              if (fn && item) {
                fn(item.note ? `${item.item} (${item.note})` : item.item);
              }
              setContextMenu(null);
            };
            return (
              <>
                <button
                  type="button"
                  onClick={insertPrompt}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:opacity-80"
                  style={{ backgroundColor: "transparent", color: "var(--color-text)" }}
                >
                  📝 {t("inventory.insertPrompt", "Vložit do promptu")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (item) {
                      setSelectedIndex(contextMenu.index);
                    }
                    setContextMenu(null);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:opacity-80"
                  style={{ backgroundColor: "transparent", color: "var(--color-text)" }}
                >
                  🔍 {t("inventory.inspect", "Zobrazit detail")}
                </button>
                {onGenerateImage && item && (
                  <button
                    type="button"
                    onClick={() => {
                      onGenerateImage(item, contextMenu.index);
                      setContextMenu(null);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:opacity-80"
                    style={{ backgroundColor: "transparent", color: "var(--color-text)" }}
                  >
                    ✨ {t("inventory.generateImage", "Generovat obrázek")}
                  </button>
                )}
              </>
            );
          })()}
        </div>
      </>
    )}
    </>
  );
}
