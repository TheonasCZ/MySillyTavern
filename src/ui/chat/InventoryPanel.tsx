import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";

import type { InventoryEntry } from "../../db/repositories/personasRepo";
import { avatarSrc } from "../characters/avatarSrc";

interface Props {
  inventory: InventoryEntry[];
  race?: string;
  onClose: () => void;
  onGenerateImage?: (item: InventoryEntry, index: number) => void;
}

const SLOT_COUNT = 8;
const VIEW_STORAGE_KEY = "inventory_view";

type ViewMode = "grid" | "list";

/** SVG silhouette paths keyed by persona race. */
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

/** Guess item type icon from name + note. */
function itemIcon(item: InventoryEntry): string {
  const text = (item.item + " " + (item.note ?? "")).toLowerCase();
  if (/meč|meče|luk|dýka|dýky|sekera|sekery|kopí|hůl|hole|kuše|šipka|oštěp|palcát|cep|rapír|šavle|kord/.test(text)) return "⚔️";
  if (/brnění|štít|helma|helmice|plášť|rukavice|boty|náramek|pancíř|kyrys|náholenice/.test(text)) return "🛡️";
  if (/lektvar|lahvička|elixír|jed|flakón|ampule|olej|extrakt|tinktura/.test(text)) return "🧪";
  if (/svitek|kniha|mapa|dopis|pergamen|deník|zápisník|manuál/.test(text)) return "📜";
  if (/prsten|drahokam|amulet|náhrdelník|náušnice|diadém|koruna|brož|spona/.test(text)) return "💎";
  if (/jídlo|chleba|sýr|maso|víno|pivo|med|voda|dávka|suchar|polévka|ryba/.test(text)) return "🍖";
  if (/klíč|klíče|lano|pochodeň|svíčka|lampa|lucerna|baterka|dalekohled|kompas|lupa/.test(text)) return "🔧";
  return "📦";
}

function readViewMode(): ViewMode {
  try {
    const stored = localStorage.getItem(VIEW_STORAGE_KEY);
    if (stored === "list") return "list";
  } catch { /* noop */ }
  return "grid";
}

function saveViewMode(view: ViewMode) {
  try { localStorage.setItem(VIEW_STORAGE_KEY, view); } catch { /* noop */ }
}

export function InventoryPanel({ inventory, race, onClose, onGenerateImage }: Props) {
  const { t } = useTranslation("chat");
  const [viewMode, setViewMode] = useState<ViewMode>(readViewMode);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; index: number } | null>(null);

  useEffect(() => { saveViewMode(viewMode); }, [viewMode]);

  const items = inventory ?? [];
  const slots: (InventoryEntry | null)[] = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    slots.push(items[i] ?? null);
  }

  const toggleView = () => setViewMode((v) => (v === "grid" ? "list" : "grid"));

  const openDetail = (i: number) => setSelectedIndex(selectedIndex === i ? null : i);

  return (
    <>
    <aside
      className="flex h-full w-72 shrink-0 flex-col border-l"
      style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-surface)" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2" style={{ borderColor: "var(--color-border)" }}>
        <h3 className="font-[var(--font-display)] text-sm">{t("inventory.title", "Inventář")}</h3>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={toggleView}
            className="rounded-[var(--radius-sm)] px-1.5 py-0.5 text-xs"
            style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text-muted)" }}
            title={viewMode === "grid" ? "Seznam" : "Mřížka"}
          >
            {viewMode === "grid" ? "☰" : "⊞"}
          </button>
          <button onClick={onClose} className="text-xs" style={{ color: "var(--color-text-faint)" }}>
            ✕
          </button>
        </div>
      </div>

      {/* ---- Grid view ---- */}
      {viewMode === "grid" && (
        <div className="relative flex-1 overflow-y-auto p-3">
          <svg
            viewBox="0 0 24 24"
            className="absolute inset-0 m-auto h-48 w-48 opacity-[0.06] pointer-events-none"
            fill="currentColor"
            style={{ color: "var(--color-text)" }}
          >
            <path d={getSilhouette(race)} />
          </svg>
          <div className="relative grid grid-cols-2 gap-3">
            {slots.map((item, i) => (
              <button
                key={i}
                type="button"
                onClick={() => item && openDetail(i)}
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
                    {item.image_path ? (
                      <img src={avatarSrc(item.image_path)} alt={item.item} className="h-12 w-12 rounded object-cover" />
                    ) : (
                      <span className="text-2xl">{itemIcon(item)}</span>
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
      )}

      {/* ---- List view ---- */}
      {viewMode === "list" && (
        <div className="flex-1 overflow-y-auto p-2">
          {items.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs" style={{ color: "var(--color-text-faint)" }}>
              {t("inventory.empty", "Inventář je prázdný.")}
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {items.map((item, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => openDetail(i)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenu({ x: e.clientX, y: e.clientY, index: i });
                    }}
                    className={`flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-sm transition-colors ${
                      selectedIndex === i ? "ring-1" : ""
                    }`}
                    style={{
                      backgroundColor: selectedIndex === i ? "var(--color-surface-2)" : "transparent",
                    }}
                  >
                    <span className="shrink-0 text-lg leading-none">{itemIcon(item)}</span>
                    <span className="flex-1 truncate">{item.item}</span>
                    {item.qty > 1 && (
                      <span className="shrink-0 rounded-full px-1.5 text-[10px] font-bold"
                        style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text-muted)" }}>
                        ×{item.qty}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Item detail */}
      {selectedIndex !== null && items[selectedIndex] && (
        <div
          className="flex flex-col gap-2 border-t px-3 py-3"
          style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-elevated)" }}
        >
          {(() => {
            const item = items[selectedIndex]!;
            return (
              <>
                <div className="flex items-start gap-3">
                  {item.image_path ? (
                    <img src={avatarSrc(item.image_path)} alt={item.item} className="h-16 w-16 shrink-0 rounded-[var(--radius-md)] object-cover border" style={{ borderColor: "var(--color-border)" }} />
                  ) : (
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[var(--radius-md)] border" style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-surface-2)" }}>
                      <span className="text-3xl">{itemIcon(item)}</span>
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
                {viewMode === "grid" && onGenerateImage && (
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
    {contextMenu && items[contextMenu.index] && (
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
            const item = items[contextMenu.index]!;
            const insertPrompt = () => {
              const fn = (window as unknown as Record<string, unknown>).__mstInsertPrompt as ((t: string) => void) | undefined;
              if (fn) fn(item.note ? `${item.item} (${item.note})` : item.item);
              setContextMenu(null);
            };
            return (
              <>
                <button
                  type="button"
                  onClick={insertPrompt}
                  className="w-full px-3 py-1.5 text-left text-sm hover:opacity-80"
                  style={{ color: "var(--color-text)" }}
                >
                  {t("inventory.insertPrompt", "Vložit do promptu")}
                </button>
                {onGenerateImage && (
                  <button
                    type="button"
                    onClick={() => { onGenerateImage(item, contextMenu.index); setContextMenu(null); }}
                    className="w-full px-3 py-1.5 text-left text-sm hover:opacity-80"
                    style={{ color: "var(--color-text-muted)" }}
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