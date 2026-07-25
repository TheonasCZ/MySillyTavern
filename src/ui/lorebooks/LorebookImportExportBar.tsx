import { useTranslation } from "react-i18next";

export function LorebookImportExportBar({
  importing,
  exporting,
  onImport,
  onExport,
  onDelete,
}: {
  importing: boolean;
  exporting: boolean;
  onImport: () => void;
  onExport: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation(["lorebooks", "common"]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onImport}
        disabled={importing}
        className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm disabled:opacity-50"
        style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text)" }}
      >
        {importing ? t("editor.importing") : t("editor.importWorldInfo")}
      </button>
      <button
        type="button"
        onClick={onExport}
        disabled={exporting}
        className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm disabled:opacity-50"
        style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text)" }}
      >
        {exporting ? t("editor.exporting") : t("editor.exportWorldInfo")}
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm transition-colors"
        style={{
          backgroundColor: "var(--color-surface-2)",
          color: "var(--color-danger)",
        }}
      >
        {t("actions.delete", { ns: "common" })}
      </button>
    </div>
  );
}
