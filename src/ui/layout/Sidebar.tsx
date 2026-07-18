import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, useLocation } from "react-router-dom";
import { getVersion } from "@tauri-apps/api/app";

type NavItem = {
  to: string;
  key: string;
  labelKey: string;
  icon: string;
  subtitleKey?: string;
};

const navItems: NavItem[] = [
  { to: "/", key: "chats", labelKey: "nav.chats", icon: "💬" },
  { to: "/characters", key: "characters", labelKey: "nav.characters", icon: "🎭", subtitleKey: "nav.charactersSub" },
  { to: "/personas", key: "personas", labelKey: "nav.personas", icon: "👤", subtitleKey: "nav.personasSub" },
  { to: "/lorebooks", key: "lorebooks", labelKey: "nav.lorebooks", icon: "📚" },
];

export function Sidebar() {
  const { t } = useTranslation("common");
  const location = useLocation();
  const [version, setVersion] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(location.pathname.startsWith("/chat/"));
  const [mobileOpen, setMobileOpen] = useState(false);

  // Auto-collapse when entering a chat, expand when leaving
  useEffect(() => {
    setCollapsed(location.pathname.startsWith("/chat/"));
  }, [location.pathname]);

  useEffect(() => {
    void getVersion().then(setVersion).catch(() => {});
  }, []);

  // Ctrl+B keyboard shortcut to toggle sidebar
  useEffect(() => {
    const handler = () => setCollapsed((c) => !c);
    window.addEventListener("toggle-sidebar", handler);
    return () => window.removeEventListener("toggle-sidebar", handler);
  }, []);

  const linkClass = (isActive: boolean) =>
    [
      "flex items-center gap-2 rounded-[var(--radius-sm)] transition-colors",
      collapsed ? "justify-center px-1.5 py-2" : "px-3 py-2",
      "text-sm",
      isActive ? "font-medium" : "hover:opacity-90",
    ].join(" ");

  const linkStyle = (isActive: boolean): React.CSSProperties => ({
    backgroundColor: isActive ? "var(--color-surface-2)" : "var(--color-surface)",
    color: isActive ? "var(--color-text)" : "var(--color-text-muted)",
  });

  return (
    <>
      {/* ---- Mobile overlay backdrop ---- */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/30 sm:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* ---- Mobile burger button (top-left corner) ---- */}
      <button
        type="button"
        onClick={() => setMobileOpen((o) => !o)}
        className="fixed left-3 top-3 z-50 rounded-[var(--radius-sm)] p-2 sm:hidden"
        style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text)" }}
        aria-label="Menu"
      >
        {mobileOpen ? "✕" : "☰"}
      </button>

      {/* ---- Sidebar ---- */}
      <nav
        className={[
          "flex h-full shrink-0 flex-col border-r transition-all duration-200",
          collapsed ? "w-14 px-1.5" : "w-56 px-3",
          // Mobile: slide-in overlay
          "fixed left-0 top-0 z-50 sm:relative sm:z-auto",
          mobileOpen ? "translate-x-0" : "-translate-x-full sm:translate-x-0",
        ].join(" ")}
        style={{
          borderColor: "var(--color-border)",
          backgroundColor: "var(--color-bg-elevated)",
          paddingTop: "3rem", // room for mobile burger
          paddingBottom: "1rem",
        }}
        aria-label={t("appName")}
      >
        {/* ---- Header row ---- */}
        <div className={["mb-6 flex items-center gap-2", collapsed ? "justify-center" : "px-2"].join(" ")}>
          <span
            aria-hidden
            className={["inline-block h-2.5 w-2.5 rounded-full", collapsed ? "" : "shrink-0"].join(" ")}
            style={{ backgroundColor: "var(--color-accent)" }}
          />
          {!collapsed && (
            <span className="font-[var(--font-display)] text-lg tracking-tight">{t("appName")}</span>
          )}
        </div>

        {/* ---- All nav items in one flat list ---- */}
        <ul className="flex flex-[0_0_auto] flex-col gap-1">
          {navItems.map((item) => (
            <li key={item.key}>
              <NavLink
                to={item.to}
                end={item.to === "/"}
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) => linkClass(isActive)}
                style={({ isActive }) => linkStyle(isActive)}
              >
                <span className="shrink-0 text-base leading-none">{item.icon}</span>
                {!collapsed && (
                  <span className="flex flex-col">
                    <span>{t(item.labelKey)}</span>
                    {item.subtitleKey && (
                      <span className="text-[0.75em] leading-tight opacity-70">
                        {t(item.subtitleKey)}
                      </span>
                    )}
                  </span>
                )}
              </NavLink>
            </li>
          ))}
        </ul>

        {/* ---- Desktop collapse strip (right edge, full height, semi-transparent) ---- */}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="absolute right-0 top-0 bottom-0 hidden w-4 cursor-pointer items-center justify-center transition-colors hover:bg-white/5 sm:flex"
          title={collapsed ? "Rozbalit sidebar (Ctrl+B)" : "Sbalit sidebar (Ctrl+B)"}
        >
          <span
            className="select-none text-[10px] leading-none transition-opacity opacity-30 group-hover:opacity-60"
            style={{ color: "var(--color-text-muted)" }}
          >
            {collapsed ? "▸" : "◂"}
          </span>
        </button>

        {/* ---- Settings + version (pinned to bottom) ---- */}
        <div className="mt-auto pt-3">
          <NavLink
            to="/settings"
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) => linkClass(isActive)}
            style={({ isActive }) => linkStyle(isActive)}
          >
            <span className="shrink-0 text-base leading-none">⚙️</span>
            {!collapsed && <span>{t("nav.settings")}</span>}
          </NavLink>
          {!collapsed && (
            <p className="mt-2 px-3 text-[11px]" style={{ color: "var(--color-text-faint)" }}>
              {version ? `v${version}` : ""}
            </p>
          )}
        </div>
      </nav>

      {/* Spacer for fixed sidebar on mobile */}
      <div className="shrink-0 sm:hidden" style={{ width: "3rem" }} />
    </>
  );
}