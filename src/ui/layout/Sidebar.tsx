import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";

const navItems = [
  { to: "/", key: "chats", labelKey: "nav.chats" },
  { to: "/characters", key: "characters", labelKey: "nav.characters" },
  { to: "/personas", key: "personas", labelKey: "nav.personas" },
  { to: "/lorebooks", key: "lorebooks", labelKey: "nav.lorebooks" },
] as const;

export function Sidebar() {
  const { t } = useTranslation("common");

  return (
    <nav
      className="flex h-full w-56 shrink-0 flex-col border-r px-3 py-4"
      style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-elevated)" }}
      aria-label={t("appName")}
    >
      <div className="mb-6 flex items-center gap-2 px-2">
        <span
          aria-hidden
          className="inline-block h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: "var(--color-accent)" }}
        />
        <span className="font-[var(--font-display)] text-lg tracking-tight">{t("appName")}</span>
      </div>

      <ul className="flex flex-1 flex-col gap-1">
        {navItems.map((item) => (
          <li key={item.key}>
            <NavLink
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                [
                  "block rounded-[var(--radius-sm)] px-3 py-2 text-sm transition-colors",
                  isActive ? "font-medium" : "hover:opacity-90",
                ].join(" ")
              }
              style={({ isActive }) => ({
                backgroundColor: isActive ? "var(--color-surface-2)" : "transparent",
                color: isActive ? "var(--color-text)" : "var(--color-text-muted)",
              })}
            >
              {t(item.labelKey)}
            </NavLink>
          </li>
        ))}
      </ul>

      <div
        className="mt-4 border-t pt-3"
        style={{ borderColor: "var(--color-border)" }}
      >
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            "block rounded-[var(--radius-sm)] px-3 py-2 text-sm transition-colors " +
            (isActive ? "font-medium" : "hover:opacity-90")
          }
          style={({ isActive }) => ({
            backgroundColor: isActive ? "var(--color-surface-2)" : "transparent",
            color: isActive ? "var(--color-text)" : "var(--color-text-muted)",
          })}
        >
          {t("nav.settings")}
        </NavLink>
      </div>
    </nav>
  );
}
