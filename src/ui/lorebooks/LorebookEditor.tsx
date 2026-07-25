import { showConfirm } from "../../platform";
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
import { blankEntryFields, type LoreEntryFields } from "../../lorebooks/worldInfoImport";
import { pickWorldInfoJsonFile, saveWorldInfoJsonFile } from "../../lorebooks/worldInfoFile";
import { useCharactersStore } from "../../stores/charactersStore";
import { useChatListStore } from "../../stores/chatListStore";
import { useLorebooksStore } from "../../stores/lorebooksStore";
import { useUndoToast } from "../useUndoToast";
import { EntryRow } from "./EntryRow";
import { LorebookMetaForm } from "./LorebookMetaForm";
import { LorebookLinksSection } from "./LorebookLinksSection";
import { LorebookImportExportBar } from "./LorebookImportExportBar";

export function LorebookEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation(["lorebooks", "common"]);
  const { toastUndo } = useUndoToast();
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
    if (!await showConfirm(t("editor.deleteConfirm") ?? "")) return;
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
    const deleted = entries.find((e) => e.id === entryId);
    await deleteEntry(entryId);
    setEntries(entries.filter((e) => e.id !== entryId));
    if (deleted) {
      const entryLabel = deleted.keys?.[0] ?? deleted.comment ?? entryId.slice(0, 8);
      toastUndo(
        `${t("deleted", { ns: "common" })}: ${entryLabel}`,
        async () => {
          const restored = await createEntry(id, {
            keys: deleted.keys,
            secondaryKeys: deleted.secondaryKeys ?? [],
            content: deleted.content,
            comment: deleted.comment ?? "",
            selectiveKeys: deleted.selectiveKeys ?? [], recursiveActivation: deleted.recursiveActivation ?? false, activationDepth: deleted.activationDepth ?? 1, timed: deleted.timed ?? null, vectorThreshold: deleted.vectorThreshold ?? null, vectorBudget: deleted.vectorBudget ?? 2,
            priority: deleted.priority ?? 100,
            alwaysOn: deleted.alwaysOn ?? false,
            caseSensitive: deleted.caseSensitive ?? false,
            enabled: deleted.enabled ?? true,
          });
          setEntries([...entries, restored]);
        },
      );
    }
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
          className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm transition-colors"
          style={{
            backgroundColor: "var(--color-surface-2)",
            color: "var(--color-text)",
          }}
        >
          ← {t("editor.backToList")}
        </button>
        <LorebookImportExportBar
          importing={importing}
          exporting={exporting}
          onImport={() => void handleImport()}
          onExport={() => void handleExport()}
          onDelete={() => void handleDelete()}
        />
      </div>

      {importError && (
        <div
          className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border px-3 py-2 text-sm"
          style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}
        >
          <span>{t("editor.importError", { message: importError })}</span>
          <button type="button" onClick={() => setImportError(null)} className="shrink-0 rounded-[var(--radius-sm)] px-2 py-1 text-xs transition-colors"
            style={{ backgroundColor: "var(--color-surface-2)", color: "var(--color-text)" }}>
            {t("actions.close", { ns: "common" })}
          </button>
        </div>
      )}

      <LorebookMetaForm
        name={name}
        description={description}
        onNameChange={setName}
        onDescriptionChange={setDescription}
        onSave={() => void handleSaveMeta()}
      />

      <LorebookLinksSection
        links={links}
        linkLabel={linkLabel}
        newLinkType={newLinkType}
        newLinkTargetId={newLinkTargetId}
        characters={characters}
        chats={chats}
        onNewLinkTypeChange={setNewLinkType}
        onNewLinkTargetIdChange={setNewLinkTargetId}
        onAddLink={() => void handleAddLink()}
        onRemoveLink={(linkId) => void handleRemoveLink(linkId)}
      />

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
