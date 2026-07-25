import { useEffect, useState } from "react";

import { listChatRecipes, type ChatCraftingRecipe } from "../../db/repositories/craftingRepo";

/** Crafting recipes for the current chat, reloaded whenever `id` changes. */
export function useChatRecipes(id: string | undefined) {
  const [recipes, setRecipes] = useState<ChatCraftingRecipe[]>([]);

  useEffect(() => {
    if (!id) {
      setRecipes([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const r = await listChatRecipes(id);
        if (!cancelled) setRecipes(r);
      } catch {
        if (!cancelled) setRecipes([]);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  return recipes;
}
