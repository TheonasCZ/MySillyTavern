import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAndroidBack } from "../useAndroidBack";

export type PanelType =
  | "memory"
  | "inventory"
  | "quests"
  | "director"
  | "character"
  | "group"
  | "export"
  | "calendar";

/**
 * Manages the mutually-exclusive header panel state (memory, inventory,
 * quests, director, character, group, export). Opening one panel closes any
 * other that was open.
 *
 * Also wires the Android back button to close panels before navigating away.
 */
export function useChatPanels() {
  const navigate = useNavigate();
  const [activePanel, setActivePanel] = useState<PanelType | null>(null);

  const openPanel = useCallback((panel: PanelType) => setActivePanel(panel), []);
  const closePanel = useCallback(() => setActivePanel(null), []);
  const togglePanel = useCallback(
    (panel: PanelType) => setActivePanel((p) => (p === panel ? null : panel)),
    [],
  );

  // Convenience booleans
  const memoryOpen = activePanel === "memory";
  const inventoryOpen = activePanel === "inventory";
  const questsOpen = activePanel === "quests";
  const directorOpen = activePanel === "director";
  const characterOpen = activePanel === "character";
  const groupOpen = activePanel === "group";
  const exportOpen = activePanel === "export";
  const calendarOpen = activePanel === "calendar";
  const hasOpenPanel = activePanel !== null;

  // Per-panel setters that accept boolean | toggle callback (preserves the
  // original signature used in onClick / onClose callbacks).
  const setMemoryOpen = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) =>
      setActivePanel((p) => ((typeof v === "function" ? v(p === "memory") : v) ? "memory" : null)),
    [],
  );
  const setInventoryOpen = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) =>
      setActivePanel((p) => ((typeof v === "function" ? v(p === "inventory") : v) ? "inventory" : null)),
    [],
  );
  const setQuestsOpen = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) =>
      setActivePanel((p) => ((typeof v === "function" ? v(p === "quests") : v) ? "quests" : null)),
    [],
  );
  const setDirectorOpen = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) =>
      setActivePanel((p) => ((typeof v === "function" ? v(p === "director") : v) ? "director" : null)),
    [],
  );
  const setCharacterOpen = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) =>
      setActivePanel((p) => ((typeof v === "function" ? v(p === "character") : v) ? "character" : null)),
    [],
  );
  const setGroupOpen = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) =>
      setActivePanel((p) => ((typeof v === "function" ? v(p === "group") : v) ? "group" : null)),
    [],
  );
  const setExportOpen = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) =>
      setActivePanel((p) => ((typeof v === "function" ? v(p === "export") : v) ? "export" : null)),
    [],
  );
  const setCalendarOpen = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) =>
      setActivePanel((p) => ((typeof v === "function" ? v(p === "calendar") : v) ? "calendar" : null)),
    [],
  );

  // Android back button: close panels first, then navigate back
  useAndroidBack({ hasOpenPanel }, () => {
    if (exportOpen) setActivePanel(null);
    else if (memoryOpen) setActivePanel(null);
    else if (inventoryOpen) setActivePanel(null);
    else if (questsOpen) setActivePanel(null);
    else if (characterOpen) setActivePanel(null);
    else if (directorOpen) setActivePanel(null);
    else if (groupOpen) setActivePanel(null);
    else navigate(-1);
  });

  return {
    activePanel,
    openPanel,
    closePanel,
    togglePanel,
    // Convenience booleans
    memoryOpen,
    inventoryOpen,
    questsOpen,
    directorOpen,
    characterOpen,
    groupOpen,
    exportOpen,
    calendarOpen,
    hasOpenPanel,
    // Legacy per-panel setters for direct boolean/toggle control
    setMemoryOpen,
    setInventoryOpen,
    setQuestsOpen,
    setDirectorOpen,
    setCharacterOpen,
    setGroupOpen,
    setExportOpen,
    setCalendarOpen,
  };
}
