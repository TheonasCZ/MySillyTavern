import { useEffect } from "react";

/**
 * Android back button handler for Tauri 2 mobile.
 *
 * On Android, the system back button (or gesture) should:
 *  1. Close any open panel (Memory, Inventory, Quests, Director, Group, Export)
 *  2. If no panel is open, navigate back in browser history (to chat list)
 *
 * Desktop builds are a no-op — there is no back button to intercept.
 */

export interface BackButtonState {
  /** Whether any side panel is currently open. */
  hasOpenPanel: boolean;
}

/**
 * Register a handler for the Android back button.
 *
 * @param state  — current panel open state
 * @param onBack — called when the back button should close panels or navigate back
 */
export function useAndroidBack(
  state: BackButtonState,
  onBack: () => void,
) {
  useEffect(() => {
    // Only active on Android WebView
    if (typeof window === "undefined") return;

    // Tauri 2 mobile fires a custom event when the back button is pressed.
    // The exact event name depends on the Tauri version; we listen for both
    // the Tauri 2 convention and the Capacitor fallback.
    const handler = (e: Event) => {
      e.preventDefault();
      onBack();
    };

    // Tauri 2 mobile back button event (v2 convention)
    window.addEventListener("tauri://back", handler);
    // Some Tauri 2 builds use this variant
    window.addEventListener("android-back", handler);

    // Also intercept the hardware back button via the History API —
    // when a panel is open, pushing a dummy state lets us catch
    // the back navigation before it leaves the app.
    if (state.hasOpenPanel) {
      window.history.pushState({ panel: true }, "");
    }

    const popstateHandler = () => {
      if (state.hasOpenPanel) {
        // Push another state to keep us on this page
        window.history.pushState({ panel: true }, "");
        onBack();
      }
    };
    window.addEventListener("popstate", popstateHandler);

    return () => {
      window.removeEventListener("tauri://back", handler);
      window.removeEventListener("android-back", handler);
      window.removeEventListener("popstate", popstateHandler);
    };
  }, [state.hasOpenPanel, onBack]);
}
