import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { blankNormalizedCard } from "../../cards/cardTypes";
import { buildPromotionPrompt, parsePromotedCard, type TranscriptEntry } from "../../chat/npcPromotion";
import { createCharacter, type Character } from "../../db/repositories/charactersRepo";
import type { ChatMember } from "../../db/repositories/chatMembersRepo";
import { listActiveFacts } from "../../db/repositories/ledgerRepo";
import { listMessages } from "../../db/repositories/messagesRepo";
import { chatComplete } from "../../providers/chatComplete";
import type { ConnectionConfig } from "../../providers/types";
import { useCharactersStore } from "../../stores/charactersStore";
import { avatarSrc } from "../characters/avatarSrc";
import { FieldHelp } from "../common/FieldHelp";

interface PromotionDraft {
  name: string;
  description: string;
  personality: string;
  scenario: string;
}

const selectStyle = {
  backgroundColor: "var(--color-surface-2)",
  borderColor: "var(--color-border-strong)",
  color: "var(--color-text)",
} as const;

function MemberAvatar({ name, avatarUrl }: { name: string; avatarUrl?: string }) {
  const initial = (name || "?").trim().charAt(0).toUpperCase() || "?";
  return avatarUrl ? (
    <img
      src={avatarUrl}
      alt={name}
      className="h-8 w-8 shrink-0 rounded-full border object-cover"
      style={{ borderColor: "var(--color-border-strong)" }}
    />
  ) : (
    <span
      aria-hidden
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-medium"
      style={{
        borderColor: "var(--color-border-strong)",
        backgroundColor: "var(--color-surface-2)",
        color: "var(--color-text-muted)",
      }}
    >
      {initial}
    </span>
  );
}

interface Props {
  chatId: string;
  chatCharacterId: string;
  members: ChatMember[];
  memberCharacters: Character[];
  allCharacters: Character[];
  autoReply: boolean;
  /** Connection used for the "promote NPC" LLM call — the chat's extraction
   * connection if set, else its main connection. Null disables generation. */
  promotionConnection: ConnectionConfig | null;
  onAddMember: (characterId: string) => Promise<void>;
  onRemoveMember: (characterId: string) => Promise<boolean>;
  onSetAutoReply: (on: boolean) => Promise<void>;
  onClose: () => void;
}

/** Popover for managing a chat's roster (plan §7): list of members with
 * "primary" badge and remove action, a select to add another character, and
 * the Auto-reply toggle. Rendered by `ChatScreen` next to the group button.
 * Also hosts the "promote NPC to character" flow (deliberately the *only*
 * entry point into that feature — no shortcuts elsewhere in the UI). */
export function GroupMembersPopover({
  chatId,
  chatCharacterId,
  members,
  memberCharacters,
  allCharacters,
  autoReply,
  promotionConnection,
  onAddMember,
  onRemoveMember,
  onSetAutoReply,
  onClose,
}: Props) {
  const { t } = useTranslation(["chat", "characters"]);
  const [addId, setAddId] = useState("");
  const [removeError, setRemoveError] = useState(false);

  const [view, setView] = useState<"members" | "promote">("members");
  const [npcSubjects, setNpcSubjects] = useState<string[]>([]);
  const [selectedNpc, setSelectedNpc] = useState("");
  const [customName, setCustomName] = useState("");
  const [generating, setGenerating] = useState(false);
  const [promoteError, setPromoteError] = useState(false);
  const [draft, setDraft] = useState<PromotionDraft | null>(null);
  const [creating, setCreating] = useState(false);

  const membersById = useMemo(() => new Map(memberCharacters.map((c) => [c.id, c])), [memberCharacters]);
  const allCharactersById = useMemo(() => new Map(allCharacters.map((c) => [c.id, c])), [allCharacters]);
  const availableToAdd = useMemo(
    () => allCharacters.filter((c) => !members.some((m) => m.characterId === c.id)),
    [allCharacters, members],
  );

  const handleAdd = async () => {
    if (!addId) return;
    await onAddMember(addId);
    setAddId("");
  };

  const handleRemove = async (characterId: string) => {
    const ok = await onRemoveMember(characterId);
    setRemoveError(!ok);
  };

  const handleOpenPromote = async () => {
    setView("promote");
    setPromoteError(false);
    setDraft(null);
    const facts = await listActiveFacts(chatId);
    const subjects = Array.from(new Set(facts.filter((f) => f.category === "npc").map((f) => f.subject)));
    setNpcSubjects(subjects);
  };

  const handleCancelPromote = () => {
    setView("members");
    setSelectedNpc("");
    setCustomName("");
    setDraft(null);
    setPromoteError(false);
  };

  const handleGenerate = async () => {
    const npcName = (selectedNpc || customName).trim();
    if (!npcName || !promotionConnection) {
      setPromoteError(true);
      return;
    }
    setGenerating(true);
    setPromoteError(false);
    try {
      const allFacts = await listActiveFacts(chatId);
      const facts = allFacts
        .filter((f) => f.category === "npc" && f.subject.toLowerCase() === npcName.toLowerCase())
        .map((f) => ({ subject: f.subject, fact: f.fact }));
      const messages = await listMessages(chatId);
      const transcript: TranscriptEntry[] = messages.map((m) => ({
        role: m.role,
        content: m.content,
        speakerName: m.characterId ? (allCharactersById.get(m.characterId)?.name ?? null) : null,
      }));
      // TODO(M28): pass chat.gameLanguage when available
      const prompt = buildPromotionPrompt(npcName, facts, transcript);
      const raw = await chatComplete(promotionConnection, prompt);
      const card = parsePromotedCard(raw);
      if (!card) {
        setPromoteError(true);
        return;
      }
      setDraft({
        name: card.name || npcName,
        description: card.description,
        personality: card.personality,
        scenario: card.scenario,
      });
    } catch {
      setPromoteError(true);
    } finally {
      setGenerating(false);
    }
  };

  const handleCreate = async () => {
    if (!draft) return;
    setCreating(true);
    setPromoteError(false);
    try {
      const card = {
        ...blankNormalizedCard(draft.name.trim() || t("group.title")),
        description: draft.description,
        personality: draft.personality,
        scenario: draft.scenario,
      };
      const character = await createCharacter(card, null, null);
      await useCharactersStore.getState().reload();
      await onAddMember(character.id);
      handleCancelPromote();
    } catch {
      setPromoteError(true);
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="absolute right-0 top-full z-50 mt-2 flex w-80 flex-col gap-3 rounded-[var(--radius-md)] border p-4"
        style={{
          borderColor: "var(--color-border)",
          backgroundColor: "var(--color-bg-elevated)",
          boxShadow: "var(--shadow-panel)",
        }}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-[var(--font-display)] text-sm">{t("group.title")}</h2>
          <button type="button" onClick={onClose} className="text-xs" style={{ color: "var(--color-text-muted)" }}>
            {t("actions.close", { ns: "common" })}
          </button>
        </div>

        {view === "members" ? (
          <>
            <ul className="flex flex-col gap-2">
              {members.map((member) => {
                const character = membersById.get(member.characterId);
                const isPrimary = member.characterId === chatCharacterId;
                return (
                  <li key={member.id} className="flex items-center gap-2">
                    <MemberAvatar
                      name={character?.name ?? "?"}
                      avatarUrl={avatarSrc(character?.avatarPath ?? null)}
                    />
                    <span className="flex-1 truncate text-sm">{character?.name ?? "?"}</span>
                    {isPrimary && (
                      <span
                        className="rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[0.65rem] font-medium uppercase tracking-wide"
                        style={{ backgroundColor: "var(--color-accent)", color: "var(--color-accent-contrast)" }}
                      >
                        {t("group.primary")}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleRemove(member.characterId)}
                      className="text-xs hover:opacity-80"
                      style={{ color: "var(--color-danger)" }}
                    >
                      {t("group.removeMember")}
                    </button>
                  </li>
                );
              })}
            </ul>

            {removeError && (
              <p className="text-xs" style={{ color: "var(--color-danger)" }}>
                {t("group.removeLastError")}
              </p>
            )}

            <label className="flex flex-col gap-1 text-sm">
              {t("group.addMember")}
              <div className="flex gap-2">
                <select
                  className="flex-1 rounded-[var(--radius-sm)] border px-2 py-1.5 text-sm"
                  style={selectStyle}
                  value={addId}
                  onChange={(e) => setAddId(e.target.value)}
                >
                  <option value="">…</option>
                  {availableToAdd.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void handleAdd()}
                  disabled={!addId}
                  className="rounded-[var(--radius-sm)] px-2.5 py-1.5 text-sm font-medium disabled:opacity-50"
                  style={{ backgroundColor: "var(--color-accent)", color: "var(--color-accent-contrast)" }}
                >
                  {t("group.addMember")}
                </button>
              </div>
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={autoReply}
                onChange={(e) => void onSetAutoReply(e.target.checked)}
              />
              {t("group.autoLabel")}
              <FieldHelp text={t("group.autoHint") ?? ""} />
            </label>

            {/* Sole, deliberately understated entry point into NPC promotion —
                no "+" shortcuts on avatars or elsewhere in the UI. */}
            <button
              type="button"
              onClick={() => void handleOpenPromote()}
              className="self-start text-xs underline-offset-2 hover:underline"
              style={{ color: "var(--color-text-muted)" }}
            >
              {t("group.promote.button")}
            </button>
          </>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              {t("group.promote.hint")}
            </p>

            {!draft ? (
              <>
                <label className="flex flex-col gap-1 text-sm">
                  {t("group.promote.selectNpc")}
                  <select
                    className="rounded-[var(--radius-sm)] border px-2 py-1.5 text-sm"
                    style={selectStyle}
                    value={selectedNpc}
                    onChange={(e) => {
                      setSelectedNpc(e.target.value);
                      if (e.target.value) setCustomName("");
                    }}
                  >
                    <option value="">…</option>
                    {npcSubjects.map((subject) => (
                      <option key={subject} value={subject}>
                        {subject}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1 text-sm">
                  {t("group.promote.customName")}
                  <input
                    type="text"
                    className="rounded-[var(--radius-sm)] border px-2 py-1.5 text-sm"
                    style={selectStyle}
                    value={customName}
                    onChange={(e) => {
                      setCustomName(e.target.value);
                      if (e.target.value) setSelectedNpc("");
                    }}
                  />
                </label>

                <button
                  type="button"
                  onClick={() => void handleGenerate()}
                  disabled={generating || !(selectedNpc || customName.trim())}
                  className="rounded-[var(--radius-sm)] px-2.5 py-1.5 text-sm font-medium disabled:opacity-50"
                  style={{ backgroundColor: "var(--color-accent)", color: "var(--color-accent-contrast)" }}
                >
                  {generating ? t("group.promote.generating") : t("group.promote.generate")}
                </button>
              </>
            ) : (
              <>
                <h3 className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-muted)" }}>
                  {t("group.promote.preview")}
                </h3>
                <label className="flex flex-col gap-1 text-sm">
                  {t("editor.fields.name", { ns: "characters" })}
                  <input
                    type="text"
                    className="rounded-[var(--radius-sm)] border px-2 py-1.5 text-sm"
                    style={selectStyle}
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  {t("editor.fields.description", { ns: "characters" })}
                  <textarea
                    rows={3}
                    className="rounded-[var(--radius-sm)] border px-2 py-1.5 text-sm"
                    style={selectStyle}
                    value={draft.description}
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  {t("editor.fields.personality", { ns: "characters" })}
                  <textarea
                    rows={2}
                    className="rounded-[var(--radius-sm)] border px-2 py-1.5 text-sm"
                    style={selectStyle}
                    value={draft.personality}
                    onChange={(e) => setDraft({ ...draft, personality: e.target.value })}
                  />
                </label>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void handleCreate()}
                    disabled={creating || !draft.name.trim()}
                    className="rounded-[var(--radius-sm)] px-2.5 py-1.5 text-sm font-medium disabled:opacity-50"
                    style={{ backgroundColor: "var(--color-accent)", color: "var(--color-accent-contrast)" }}
                  >
                    {t("group.promote.create")}
                  </button>
                </div>
              </>
            )}

            {promoteError && (
              <p className="text-xs" style={{ color: "var(--color-danger)" }}>
                {t("group.promote.error")}
              </p>
            )}

            <button
              type="button"
              onClick={handleCancelPromote}
              className="self-start text-xs hover:opacity-80"
              style={{ color: "var(--color-text-muted)" }}
            >
              {t("group.promote.cancel")}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
