import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";

import {
  addLink,
  createEntry,
  deleteEntry,
  exportWorldInfoLorebook,
  getLorebook,
  importWorldInfoEntriesInto,
  listEntries,
  listLinksForLorebook,
  removeLink,
  updateEntry,
  type Lorebook,
  type LoreEntry,
  type LorebookLink,
  type LorebookLinkTargetType,
} from "../../db/repositories/lorebooksRepo";
import type { LoreEntryFields } from "../../lorebooks/worldInfoImport";
import { pickWorldInfoJsonFile, saveWorldInfoJsonFile } from "../../lorebooks/worldInfoFile";
import { useCharactersStore } from "../../stores/charactersStore";
import { useChatListStore } from "../../stores/chatListStore";
import { useLorebooksStore } from "../../stores/lorebooksStore";

const inputStyle = {
  backgroundColor: "var(--color-surface-2)",
  borderColor: "var(--color-border-strong)",
  color: "var(--color-text)",
} as const;

function blankEntryFields(): LoreEntryFields {
  return {
    keys: [],
    secondaryKeys: [],
    content: "",
    comment: "",
    priority: 100,
    alwaysOn: false,
    caseSensitive: false,
    enabled: true,
  };
}

function csvToKeys(text: string): string[] {
  return text
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

function EntryRow({
  entry,
  onSave,
  onDelete,
}: {
  entry: LoreEntry;
  onSave: (fields: LoreEntryFields) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const { t } = useTranslation(["lorebooks", "common"]);
  const [fields, setFields] = useState<LoreEntryFields>(entry);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const patch = (partial: Partial<LoreEntryFields>) => setFields({ ...fields, ...partial });

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(fields);
      setSavedAt(Date.now());
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="flex flex-col gap-3 rounded-[var(--radius-md)] border p-4"
      style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-elevated)" }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          {t("editor.entryFields.keys")}
          <input
            className="rounded-[var(--radius-sm)] border px-2 py-1.5"
            style={inputStyle}
            value={fields.keys.join(", ")}
            placeholder={t("editor.entryFields.keysPlaceholder") ?? ""}
            onChange={(e) => patch({ keys: csvToKeys(e.target.value) })}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t("editor.entryFields.secondaryKeys")}
          <input
            className="rounded-[var(--radius-sm)] border px-2 py-1.5"
            style={inputStyle}
            value={fields.secondaryKeys.join(", ")}
            placeholder={t("editor.entryFields.keysPlaceholder") ?? ""}
            onChange={(e) => patch({ secondaryKeys: csvToKeys(e.target.value) })}
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        {t("editor.entryFields.content")}
        <textarea
          className="min-h-[5rem] rounded-[var(--radius-sm)] border px-2 py-1.5 text-sm"
          style={inputStyle}
          value={fields.content}
          onChange={(e) => patch({ content: e.target.value })}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t("editor.entryFields.comment")}
        <input
          className="rounded-[var(--radius-sm)] border px-2 py-1.5"
          style={inputStyle}
          value={fields.comment}
          onChange={(e) => patch({ comment: e.target.value })}
        />
      </label>

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          {t("editor.entryFields.priority")}
          <input
            type="number"
            className="w-20 rounded-[var(--radius-sm)] border px-2 py-1"
            style={inputStyle}
            value={fields.priority}
            onChange={(e) => patch({ priority: Number(e.target.value) })}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={fields.alwaysOn}
            onChange={(e) => patch({ alwaysOn: e.target.checked })}
          />
          {t("editor.entryFields.alwaysOn")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={fields.caseSensitive}
            onChange={(e) => patch({ caseSensitive: e.target.checked })}
          />
          {t("editor.entryFields.caseSensitive")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={fields.enabled}
            onChange={(e) => patch({ enabled: e.target.checked })}
          />
          {t("editor.entryFields.enabled")}
        </label>
      </div>

      <div className="flex items-center gap-2 border-t pt-3" style={{ borderColor: "var(--color-border)" }}>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          style={{ backgroundColor: "var(--color-accent)", color: "var(--color-accent-contrast)" }}
        >
          {t("actions.save", { ns: "common" })}
        </button>
        <button
          type="button"
          onClick={() => void onDelete()}
          className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm"
          style={{ color: "var(--color-danger)" }}
        >
          {t("actions.delete", { ns: "common" })}
        </button>
        {savedAt && (
          <span className="text-xs" style={{ color: "var(--color-success)" }}>
            {t("editor.saved")}
          </span>
        )}
      </div>
    </div>
  );
}

export function LorebookEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation(["lorebooks", "common"]);
  const { remove: removeLorebook, update: updateLorebook } = useLorebooksStore();
  const { characters, loaded: charactersLoaded, load: loadCharacters } = useCharactersStore();
  const { chats, loaded: chatsLoaded, load: loadChats } = useChatListStore();

  const [lorebook, setLorebook] = useState<Lorebook | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [entries, setEntries] = useState<LoreEntry[]>([]);
  const [links, setLinks] = useState<LorebookLink[]>([]);
  const [newLinkType, setNewLinkType] = useState<LorebookLinkTargetType>("global");
  const [newLinkTargetId, setNewLinkTargetId] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!charactersLoaded) void loadCharacters();
  }, [charactersLoaded, loadCharacters]);

  useEffect(() => {
    if (!chatsLoaded) void loadChats();
  }, [chatsLoaded, loadChats]);

  const reload = async () => {
    if (!id) return;
    const [book, entryList, linkList] = await Promise.all([
      getLorebook(id),
      listEntries(id),
      listLinksForLorebook(id),
    ]);
    setLorebook(book);
    if (book) {
      setName(book.name);
      setDescription(book.description);
    }
    setEntries(entryList);
    setLinks(linkList);
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!id) return null;
  if (!lorebook) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="text-sm" style={{ color: "var(--color-text-faint)" }}>
          {t("state.loading", { ns: "common" })}
        </span>
      </div>
    );
  }

  const handleSaveMeta = async () => {
    await updateLorebook(id, { name, description });
    setLorebook({ ...lorebook, name, description });
  };

  const handleDelete = async () => {
    if (!confirm(t("editor.deleteConfirm") ?? "")) return;
    await removeLorebook(id);
    navigate("/lorebooks");
  };

  const handleAddEntry = async () => {
    const entry = await createEntry(id, blankEntryFields());
    setEntries([...entries, entry]);
  };

  const handleSaveEntry = async (entryId: string, fields: LoreEntryFields) => {
    await updateEntry(entryId, fields);
    setEntries(entries.map((e) => (e.id === entryId ? { ...e, ...fields } : e)));
  };

  const handleDeleteEntry = async (entryId: string) => {
    await deleteEntry(entryId);
    setEntries(entries.filter((e) => e.id !== entryId));
  };

  const handleAddLink = async () => {
    const targetId = newLinkType === "global" ? null : newLinkTargetId || null;
    if (newLinkType !== "global" && !targetId) return;
    const link = await addLink(id, newLinkType, targetId);
    setLinks([...links, link]);
  };

  const handleRemoveLink = async (linkId: string) => {
    await removeLink(linkId);
    setLinks(links.filter((l) => l.id !== linkId));
  };

  const linkLabel = (link: LorebookLink) => {
    if (link.targetType === "global") return t("editor.links.global");
    if (link.targetType === "character") {
      const character = characters.find((c) => c.id === link.targetId);
      return `${t("editor.links.character")}: ${character?.name ?? link.targetId}`;
    }
    const chat = chats.find((c) => c.id === link.targetId);
    return `${t("editor.links.chat")}: ${chat?.title ?? link.targetId}`;
  };

  const handleImport = async () => {
    setImportError(null);
    setImporting(true);
    try {
      const text = await pickWorldInfoJsonFile();
      if (text) {
        await importWorldInfoEntriesInto(id, text);
        await reload();
      }
    } catch (err) {
      setImportError(String(err));
    } finally {
      setImporting(false);
    }
  };

  const handleExport = async () => {
    setImportError(null);
    setExporting(true);
    try {
      const json = await exportWorldInfoLorebook(id);
      await saveWorldInfoJsonFile(`${lorebook.name || "lorebook"}.json`, json);
    } catch (err) {
      setImportError(String(err));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-8">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => navigate("/lorebooks")}
          className="text-sm"
          style={{ color: "var(--color-text-muted)" }}
        >
          ← {t("editor.backToList")}
        </button>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void handleImport()}
            disabled={importing}
            className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm disabled:opacity-50"
            style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text)" }}
          >
            {importing ? t("editor.importing") : t("editor.importWorldInfo")}
          </button>
          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={exporting}
            className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm disabled:opacity-50"
            style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text)" }}
          >
            {exporting ? t("editor.exporting") : t("editor.exportWorldInfo")}
          </button>
          <button
            type="button"
            onClick={() => void handleDelete()}
            className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm"
            style={{ color: "var(--color-danger)" }}
          >
            {t("actions.delete", { ns: "common" })}
          </button>
        </div>
      </div>

      {importError && (
        <div
          className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border px-3 py-2 text-sm"
          style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}
        >
          <span>{t("editor.importError", { message: importError })}</span>
          <button type="button" onClick={() => setImportError(null)} className="shrink-0 opacity-80 hover:opacity-100">
            {t("actions.close", { ns: "common" })}
          </button>
        </div>
      )}

      <div
        className="flex flex-col gap-3 rounded-[var(--radius-md)] border p-4"
        style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-elevated)" }}
      >
        <label className="flex flex-col gap-1 text-sm">
          {t("editor.fields.name")}
          <input
            className="rounded-[var(--radius-sm)] border px-2 py-1.5"
            style={inputStyle}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t("editor.fields.description")}
          <textarea
            className="min-h-[3rem] rounded-[var(--radius-sm)] border px-2 py-1.5 text-sm"
            style={inputStyle}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <button
          type="button"
          onClick={() => void handleSaveMeta()}
          className="self-start rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium"
          style={{ backgroundColor: "var(--color-accent)", color: "var(--color-accent-contrast)" }}
        >
          {t("actions.save", { ns: "common" })}
        </button>
      </div>

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
                onClick={() => void handleRemoveLink(link.id)}
                className="text-xs"
                style={{ color: "var(--color-danger)" }}
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
              setNewLinkType(e.target.value as LorebookLinkTargetType);
              setNewLinkTargetId("");
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
              onChange={(e) => setNewLinkTargetId(e.target.value)}
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
              onChange={(e) => setNewLinkTargetId(e.target.value)}
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
            onClick={() => void handleAddLink()}
            className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm"
            style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text)" }}
          >
            {t("editor.links.add")}
          </button>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-[var(--font-display)] text-lg">{t("editor.entriesTitle")}</h2>
          <button
            type="button"
            onClick={() => void handleAddEntry()}
            className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm"
            style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text)" }}
          >
            {t("editor.addEntry")}
          </button>
        </div>

        {entries.length === 0 && (
          <p className="text-sm" style={{ color: "var(--color-text-faint)" }}>
            {t("editor.noEntries")}
          </p>
        )}

        <div className="flex flex-col gap-3">
          {entries.map((entry) => (
            <EntryRow
              key={entry.id}
              entry={entry}
              onSave={(fields) => handleSaveEntry(entry.id, fields)}
              onDelete={() => handleDeleteEntry(entry.id)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
