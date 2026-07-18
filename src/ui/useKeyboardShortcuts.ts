import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useChatStore } from "../stores/chatStore";

/**
 * Component wrapper — renders nothing, just activates the hook inside Router context.
 * Place this inside your <HashRouter> tree.
 */
export function KeyboardShortcutListener() {
  useKeyboardShortcuts();
  return null;
}

/**
 * Global keyboard shortcuts:
 * - Ctrl+R / Cmd+R → regenerate last assistant message (only when chat is open)
 * - Ctrl+Enter → send message (handled by ChatInput natively)
 * - Escape → close any open panel (panels manage their own Escape handling)
 *
 * This hook is called once from App and listens at the document level.
 */
export function useKeyboardShortcuts() {
  const location = useLocation();

  useEffect(() => {
    const isChatOpen = location.pathname.startsWith("/chat/");

    function handleKeyDown(e: KeyboardEvent) {
      // Don't fire shortcuts when focus is in an input/textarea/select
      const mod = e.metaKey || e.ctrlKey;

      // Ctrl+R / Cmd+R — regenerate last assistant message
      if (mod && e.key === "r" && !e.shiftKey && isChatOpen) {
        e.preventDefault();
        const { regenerate, messages } = useChatStore.getState();
        const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
        if (lastAssistant) {
          void regenerate(lastAssistant.id);
        }
        return;
      }

      // Ctrl+B / Cmd+B — toggle sidebar
      if (mod && e.key === "b" && !e.shiftKey) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("toggle-sidebar"));
        return;
      }

      // Escape — only when not editing text; panels handle their own Escape
      // through local key handlers. This is a catch-all for unhandled Escapes.
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [location.pathname]);
}
