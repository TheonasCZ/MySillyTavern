/** Case- and diacritics-insensitive search helpers ("Věž" matches "vez").
 * Pure, so they're unit-testable. */

function foldChar(ch: string): string {
  return ch.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** Folds a whole string for matching ("Věž a 😀" → "vez a 😀"). */
export function foldForSearch(text: string): string {
  return [...text].map(foldChar).join("");
}

/** Index (in code points) of the first folded occurrence of `term` inside
 * `contentChars`, or -1. Walks per code point so emoji and other multi-unit
 * characters don't skew positions. */
function foldedIndexOf(contentChars: string[], term: string): number {
  const target = foldForSearch(term);
  if (!target) return -1;
  for (let i = 0; i < contentChars.length; i++) {
    let acc = "";
    for (let j = i; j < contentChars.length && acc.length < target.length; j++) {
      acc += foldChar(contentChars[j]);
    }
    if (acc.startsWith(target)) return i;
  }
  return -1;
}

/** Builds a short snippet around the first occurrence of `term` in
 * `content`, matching without regard to case or diacritics — used by the
 * chat-list search results. */
export function searchSnippet(content: string, term: string, radius = 60): string {
  const chars = [...content];
  const idx = foldedIndexOf(chars, term);
  if (idx === -1) {
    return chars.slice(0, radius * 2).join("") + (chars.length > radius * 2 ? "…" : "");
  }
  const start = Math.max(0, idx - radius);
  const end = Math.min(chars.length, idx + [...term].length + radius);
  return (
    (start > 0 ? "…" : "") + chars.slice(start, end).join("") + (end < chars.length ? "…" : "")
  );
}
