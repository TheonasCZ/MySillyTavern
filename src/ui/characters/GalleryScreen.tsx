import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { blankNormalizedCard } from "../../cards/cardTypes";
import { pickAndImportJsonCard, pickAndImportPngCard } from "../../cards/cardImport";
import { createCharacter } from "../../db/repositories/charactersRepo";
import { useCharactersStore } from "../../stores/charactersStore";
import { avatarSrc } from "./avatarSrc";

const inputStyle = {
  backgroundColor: "var(--color-surface-2)",
  borderColor: "var(--color-border-strong)",
  color: "var(--color-text)",
} as const;

export function GalleryScreen() {
  const { t } = useTranslation(["characters", "common"]);
  const navigate = useNavigate();
  const { characters, loaded, load, reload } = useCharactersStore();

  const [search, setSearch] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [importing, setImporting] = useState<"png" | "json" | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const c of characters) for (const tag of c.tags) set.add(tag);
    return Array.from(set).sort();
  }, [characters]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return characters.filter((c) => {
      if (activeTag && !c.tags.includes(activeTag)) return false;
      if (!needle) return true;
      const haystack = `${c.name} ${c.tags.join(" ")}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [characters, search, activeTag]);

  const handleImportPng = async () => {
    setImporting("png");
    setImportError(null);
    try {
      const character = await pickAndImportPngCard();
      if (character) {
        await reload();
        navigate(`/characters/${character.id}`);
      }
    } catch (err) {
      setImportError(String(err));
    } finally {
      setImporting(null);
    }
  };

  const handleImportJson = async () => {
    setImporting("json");
    setImportError(null);
    try {
      const character = await pickAndImportJsonCard();
      if (character) {
        await reload();
        navigate(`/characters/${character.id}`);
      }
    } catch (err) {
      setImportError(String(err));
    } finally {
      setImporting(null);
    }
  };

  const handleCreateBlank = async () => {
    const character = await createCharacter(
      blankNormalizedCard(t("gallery.newCharacterName")),
      null,
      null,
    );
    await reload();
    navigate(`/characters/${character.id}`);
  };

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-[var(--font-display)] text-2xl">{t("title")}</h1>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void handleImportPng()}
            disabled={importing !== null}
            className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            style={{ backgroundColor: "var(--color-accent)", color: "var(--color-accent-contrast)" }}
          >
            {importing === "png" ? t("gallery.importing") : t("gallery.importPng")}
          </button>
          <button
            type="button"
            onClick={() => void handleImportJson()}
            disabled={importing !== null}
            className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text)" }}
          >
            {importing === "json" ? t("gallery.importing") : t("gallery.importJson")}
          </button>
          <button
            type="button"
            onClick={() => void handleCreateBlank()}
            className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium transition-colors"
            style={{ backgroundColor: "var(--color-accent)", color: "var(--color-accent-contrast)" }}
          >
            {t("gallery.newCharacter")}
          </button>
        </div>
      </div>

      {importError && (
        <div
          className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border px-3 py-2 text-sm"
          style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}
        >
          <span>{t("gallery.importError", { message: importError })}</span>
          <button type="button" onClick={() => setImportError(null)} className="shrink-0 rounded-[var(--radius-sm)] px-2 py-1 text-xs transition-colors"
            style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text)" }}>
            {t("actions.close", { ns: "common" })}
          </button>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <input
          className="rounded-[var(--radius-sm)] border px-3 py-2 text-sm"
          style={inputStyle}
          value={search}
          placeholder={t("gallery.searchPlaceholder") ?? ""}
          onChange={(e) => setSearch(e.target.value)}
        />

        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setActiveTag(null)}
              className="rounded-full px-2.5 py-1 text-xs"
              style={{
                backgroundColor: activeTag === null ? "var(--color-accent)" : "var(--color-surface-2)",
                color: activeTag === null ? "var(--color-accent-contrast)" : "var(--color-text-muted)",
              }}
            >
              {t("gallery.allTags")}
            </button>
            {allTags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => setActiveTag(activeTag === tag ? null : tag)}
                className="rounded-full px-2.5 py-1 text-xs"
                style={{
                  backgroundColor: activeTag === tag ? "var(--color-accent)" : "var(--color-surface-2)",
                  color: activeTag === tag ? "var(--color-accent-contrast)" : "var(--color-text-muted)",
                }}
              >
                {tag}
              </button>
            ))}
          </div>
        )}
      </div>

      {filtered.length === 0 && (
        <p className="text-sm" style={{ color: "var(--color-text-faint)" }}>
          {characters.length === 0 ? t("empty") : t("gallery.noMatches")}
        </p>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {filtered.map((character) => (
          <button
            key={character.id}
            type="button"
            onClick={() => navigate(`/characters/${character.id}`)}
            className="group flex flex-col gap-2 rounded-[var(--radius-md)] border p-2 text-left transition-transform hover:-translate-y-0.5"
            style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-elevated)" }}
          >
            <div
              className="aspect-[3/4] w-full overflow-hidden rounded-[var(--radius-sm)]"
              style={{ backgroundColor: "var(--color-surface-2)" }}
            >
              {avatarSrc(character.avatarPath) ? (
                <img
                  src={avatarSrc(character.avatarPath)}
                  alt={character.name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <span className="font-[var(--font-display)] text-3xl" style={{ color: "var(--color-text-faint)" }}>
                    {character.name.slice(0, 1).toUpperCase()}
                  </span>
                </div>
              )}
            </div>
            <span className="truncate text-sm font-medium">{character.name}</span>
            {character.tags.length > 0 && (
              <span className="truncate text-xs" style={{ color: "var(--color-text-faint)" }}>
                {character.tags.slice(0, 3).join(", ")}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
