import { execute, newId, nowIso } from "../database";
import type { CardBookV2 } from "../../cards/cardTypes";

/** Minimal lorebook write-path needed to land `character_book` from an
 * imported card as a real lorebook + entries + link. Full lorebook
 * CRUD/activation UI lands in M4 — this only covers "insert what the card
 * brought with it" so nothing from the import is silently dropped. */
export async function createLorebookFromCharacterBook(
  book: CardBookV2,
  characterId: string,
): Promise<string> {
  const lorebookId = newId();
  const now = nowIso();
  await execute(
    `INSERT INTO lorebooks (id, name, description, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $4)`,
    [lorebookId, book.name?.trim() || "Importovaný lorebook", book.description ?? "", now],
  );

  for (const entry of book.entries ?? []) {
    await execute(
      `INSERT INTO lore_entries
        (id, lorebook_id, keys, secondary_keys, content, comment, priority,
         always_on, case_sensitive, enabled, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        newId(),
        lorebookId,
        JSON.stringify(entry.keys ?? []),
        JSON.stringify(entry.secondary_keys ?? []),
        entry.content ?? "",
        entry.comment ?? entry.name ?? "",
        entry.priority ?? entry.insertion_order ?? 100,
        entry.constant ? 1 : 0,
        entry.case_sensitive ? 1 : 0,
        entry.enabled === false ? 0 : 1,
        now,
      ],
    );
  }

  await execute(
    `INSERT INTO lorebook_links (id, lorebook_id, target_type, target_id)
     VALUES ($1, $2, 'character', $3)`,
    [newId(), lorebookId, characterId],
  );

  return lorebookId;
}
