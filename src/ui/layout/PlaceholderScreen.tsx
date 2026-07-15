import { useTranslation } from "react-i18next";

export function PlaceholderScreen({ titleKey, ns }: { titleKey: string; ns: string }) {
  const { t } = useTranslation([ns, "common"]);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="font-[var(--font-display)] text-2xl" style={{ color: "var(--color-text)" }}>
        {t(titleKey, { ns })}
      </h1>
      <p className="max-w-sm text-sm" style={{ color: "var(--color-text-muted)" }}>
        {t("comingSoon", { ns: "common" })}
      </p>
    </div>
  );
}
