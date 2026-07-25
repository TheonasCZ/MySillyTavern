import { useEffect, useState } from "react";

import { searchMessages, type MessageSearchHit } from "../../db/repositories/messagesRepo";

/** Debounced fulltext search across all chats' messages; cleared below two
 * characters so casual typing doesn't fire queries. */
export function useChatSearch() {
  const [searchTerm, setSearchTerm] = useState("");
  const [searchHits, setSearchHits] = useState<MessageSearchHit[] | null>(null);

  useEffect(() => {
    const term = searchTerm.trim();
    if (term.length < 2) {
      setSearchHits(null);
      return;
    }
    const handle = setTimeout(() => {
      void searchMessages(term).then((hits) => setSearchHits(hits));
    }, 250);
    return () => clearTimeout(handle);
  }, [searchTerm]);

  return { searchTerm, setSearchTerm, searchHits };
}
