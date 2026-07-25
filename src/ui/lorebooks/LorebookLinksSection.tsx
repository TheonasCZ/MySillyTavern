import { useTranslation } from "react-i18next";

import type { LorebookLink, LorebookLinkTargetType } from "../../db/repositories/lorebooksRepo";
import { inputStyle } from "./constants";

export function LorebookLinksSection({
  links,
  linkLabel,
  newLinkType,
  newLinkTargetId,
  characters,
  chats,
  onNewLinkTypeChange,
  onNewLinkTargetIdChange,
  onAddLink,
  onRemoveLink,
}: {
  links: LorebookLink[];
  linkLabel: (link: LorebookLink) => string;
  newLinkType: LorebookLinkTargetType;
  newLinkTargetId: string;
  characters: { id: string; name: string }[];
  chats: { id: string; title: string }[];
  onNewLinkTypeChange: (type: LorebookLinkTargetType) => void;
  onNewLinkTargetIdChange: (id: string) => void;
  onAddLink: () => void;
  onRemoveLink: (linkId: string) => void;
}) {
  const { t } = useTranslation(["lorebooks", "common"]);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-[var(--font-display)] text-lg">{t("editor.linksTitle")}</h2>
      <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>
        {t("editor.linksHint")}
      </p>

      <ul className="flex flex-col gap-1">
        {links.map((link) => (
          <li
            key={link.id}
            className="flex items-center justify-between gap-2 rounded-[var(--radius-sm)] border px-3 py-1.5 text-sm"
            style={{ borderColor: "var(--color-border)" }}
          >
            <span>{linkLabel(link)}</span>
            <button
              type="button"
              onClick={() => onRemoveLink(link.id)}
              className="rounded-[var(--radius-sm)] px-2 py-1 text-xs transition-colors"
              style={{
                backgroundColor: "var(--color-surface-2)",
                color: "var(--color-danger)",
              }}
            >
              {t("actions.delete", { ns: "common" })}
            </button>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        <select
          className="rounded-[var(--radius-sm)] border px-2 py-1.5 text-sm"
          style={inputStyle}
          value={newLinkType}
          onChange={(e) => {
            onNewLinkTypeChange(e.target.value as LorebookLinkTargetType);
            onNewLinkTargetIdChange("");
          }}
        >
          <option value="global">{t("editor.links.global")}</option>
          <option value="character">{t("editor.links.character")}</option>
          <option value="chat">{t("editor.links.chat")}</option>
        </select>

        {newLinkType === "character" && (
          <select
            className="rounded-[var(--radius-sm)] border px-2 py-1.5 text-sm"
            style={inputStyle}
            value={newLinkTargetId}
            onChange={(e) => onNewLinkTargetIdChange(e.target.value)}
          >
            <option value="">{t("editor.links.pickTarget")}</option>
            {characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}

        {newLinkType === "chat" && (
          <select
            className="rounded-[var(--radius-sm)] border px-2 py-1.5 text-sm"
            style={inputStyle}
            value={newLinkTargetId}
            onChange={(e) => onNewLinkTargetIdChange(e.target.value)}
          >
            <option value="">{t("editor.links.pickTarget")}</option>
            {chats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        )}

        <button
          type="button"
          onClick={onAddLink}
          className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm"
          style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text)" }}
        >
          {t("editor.links.add")}
        </button>
      </div>
    </section>
  );
}
