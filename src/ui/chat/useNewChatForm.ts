import { useEffect, useMemo, useState } from "react";

import { greetingOptions, resolveGreeting } from "../../chat/systemPrompt";
import { getCharacter } from "../../db/repositories/charactersRepo";
import { createMessage } from "../../db/repositories/messagesRepo";
import type { Character } from "../../db/repositories/charactersRepo";
import type { Chat, ChatDraft } from "../../db/repositories/chatsRepo";
import type { Persona } from "../../db/repositories/personasRepo";
import type { ConnectionConfig } from "../../providers/types";

/** All "create a new chat" form state, derived values, and the submit
 * handler — used by `NewChatForm`. Depends on characters/personas/
 * connections already being loaded by the caller. */
export function useNewChatForm({
  characters,
  charactersLoaded,
  personas,
  personasLoaded,
  connections,
  create,
  t,
  navigate,
}: {
  characters: Character[];
  charactersLoaded: boolean;
  personas: Persona[];
  personasLoaded: boolean;
  connections: ConnectionConfig[];
  create: (draft: ChatDraft) => Promise<Chat>;
  t: (key: string, opts?: Record<string, unknown>) => string;
  navigate: (path: string) => void;
}) {
  const [newTitle, setNewTitle] = useState("");
  const [newConnectionId, setNewConnectionId] = useState<string>("");
  const [newEmbeddingConnectionId, setNewEmbeddingConnectionId] = useState<string>("");
  const [newImageConnectionId, setNewImageConnectionId] = useState<string>("");
  const [newTagExtractionConnectionId, setNewTagExtractionConnectionId] = useState<string>("");
  /** Order of selection = roster position, first checked = primary member
   * (plan §7 M10 group create form). */
  const [newCharacterIds, setNewCharacterIds] = useState<string[]>([]);
  const [starterCharacterId, setStarterCharacterId] = useState<string>("");
  const [newPersonaId, setNewPersonaId] = useState<string>("");
  const [newGreeting, setNewGreeting] = useState<string>("");
  const [newGameLanguage, setNewGameLanguage] = useState<string>("cs");
  const [newHardcoreMode, setNewHardcoreMode] = useState(false);

  // Auto-select the first character when creating a new chat
  useEffect(() => {
    if (!charactersLoaded || characters.length === 0) return;
    if (newCharacterIds.length === 0) {
      setNewCharacterIds([characters[0].id]);
      setStarterCharacterId(characters[0].id);
    }
  }, [charactersLoaded, characters]);

  // Auto-select the default persona (or first available) when creating a new chat
  useEffect(() => {
    if (!personasLoaded || personas.length === 0) return;
    const defaultPersona = personas.find((p) => p.isDefault);
    setNewPersonaId(defaultPersona?.id ?? personas[0].id);
  }, [personasLoaded, personas]);

  useEffect(() => {
    if (connections.length > 0 && !newConnectionId) {
      setNewConnectionId(connections[0].id);
    }
  }, [connections, newConnectionId]);

  useEffect(() => {
    if (characters.length > 0 && newCharacterIds.length === 0) {
      setNewCharacterIds([characters[0].id]);
    }
  }, [characters, newCharacterIds.length]);

  const toggleCharacter = (id: string) => {
    setNewCharacterIds((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    );
  };

  // The "who starts" pick must stay one of the checked characters — reset to
  // the primary (first checked) whenever it falls out of the selection.
  useEffect(() => {
    if (newCharacterIds.length === 0) {
      setStarterCharacterId("");
    } else if (!newCharacterIds.includes(starterCharacterId)) {
      setStarterCharacterId(newCharacterIds[0]);
    }
  }, [newCharacterIds, starterCharacterId]);

  useEffect(() => {
    if (personas.length > 0 && !newPersonaId) {
      const def = personas.find((p) => p.isDefault) ?? personas[0];
      setNewPersonaId(def.id);
    }
  }, [personas, newPersonaId]);

  const selectedCharacter = useMemo(
    () => characters.find((c) => c.id === starterCharacterId) ?? null,
    [characters, starterCharacterId],
  );

  const greetingChoices = useMemo(() => {
    if (!selectedCharacter) return [];
    return greetingOptions(selectedCharacter);
  }, [selectedCharacter]);

  useEffect(() => {
    setNewGreeting(greetingChoices[0] ?? "");
  }, [greetingChoices]);

  const handleCreate = async () => {
    if (newCharacterIds.length === 0) return;
    const title = newTitle.trim() || t("newChat.defaultTitle");
    // The starter picks first in the roster so it becomes the primary
    // member (`chat.characterId`) — `characterIds[0]` is the invariant.
    const orderedIds = [
      starterCharacterId,
      ...newCharacterIds.filter((id) => id !== starterCharacterId),
    ];
    const created = await create({
      title,
      characterIds: orderedIds,
      connectionId: newConnectionId || null,
      embeddingConnectionId: newEmbeddingConnectionId || null,
      imageConnectionId: newImageConnectionId || null,
      tagExtractionConnectionId: newTagExtractionConnectionId || null,
      personaId: newPersonaId || null,
      gameLanguage: newGameLanguage,
      hardcoreMode: newHardcoreMode,
    });

    const character = await getCharacter(starterCharacterId);
    if (character) {
      const persona = personas.find((p) => p.id === newPersonaId) ?? null;
      const greetingText = resolveGreeting(character, newGreeting || null, persona);
      if (greetingText) {
        await createMessage(created.id, "assistant", greetingText, character.id);
      }
    }

    setNewTitle("");
    setNewGameLanguage("cs");
    setNewHardcoreMode(false);
    navigate(`/chat/${created.id}`);
  };

  return {
    newTitle, setNewTitle,
    newConnectionId, setNewConnectionId,
    newEmbeddingConnectionId, setNewEmbeddingConnectionId,
    newImageConnectionId, setNewImageConnectionId,
    newTagExtractionConnectionId, setNewTagExtractionConnectionId,
    newCharacterIds, toggleCharacter,
    starterCharacterId, setStarterCharacterId,
    newPersonaId, setNewPersonaId,
    newGreeting, setNewGreeting,
    newGameLanguage, setNewGameLanguage,
    newHardcoreMode, setNewHardcoreMode,
    greetingChoices,
    handleCreate,
  };
}
