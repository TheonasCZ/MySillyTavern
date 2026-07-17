/**
 * TTS text preparation — strips markdown, OOC blocks, dice expressions,
 * and other non-speakable tokens from messages before feeding them to the
 * speech synthesis engine.
 */

/**
 * Clean a message for TTS reading:
 * - Strip **bold**, *italic*, _italic_
 * - Strip inline code (`code`) and fenced code blocks (```...```)
 * - Strip OOC blocks: [OOC: ...] (case-insensitive)
 * - Strip inline suggestion/annotation tags like [1], [A], [x]
 * - Strip dice expressions: [1d20], [1d100+5], [2k6], etc.
 * - Strip Markdown links: [text](url) → text
 * - Strip HTML tags
 * - Collapse multiple newlines/spaces
 * - Trim
 */
export function prepareForTts(text: string): string {
  let cleaned = text;

  // 1. Strip fenced code blocks (```...```)
  cleaned = cleaned.replace(/```[\s\S]*?```/g, "");

  // 2. Strip inline code (`code`)
  cleaned = cleaned.replace(/`([^`]+)`/g, "$1");

  // 3. Strip OOC blocks: [OOC: ...] or (OOC: ...), case-insensitive
  cleaned = cleaned.replace(/\[OOC:[^\]]*\]/gi, "");
  cleaned = cleaned.replace(/\(OOC:[^)]*\)/gi, "");

  // 4. Strip Markdown links: [text](url) → text
  cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

  // 5. Strip dice expressions: [1d20], [1d100+5], [2k6+1], etc.
  //    Pattern: [number d/k number optional math]
  cleaned = cleaned.replace(/\[\d+[dk]\d+(?:[+\-*/]\d+)*\]/gi, "");

  // 6. Strip inline annotation/suggestion tags: [1], [A], [x], etc.
  //    (short alphanumeric tokens in square brackets)
  cleaned = cleaned.replace(/\[[A-Za-z0-9]{1,4}\]/g, "");

  // 7. Strip bold/italic markers: **, *, _
  //    Careful: * and _ can be ambiguous; only strip when used as wrappers.
  cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, "$1");
  cleaned = cleaned.replace(/\*([^*]+)\*/g, "$1");
  //    Underscore italic: _word_ (but not inside words like file_name)
  cleaned = cleaned.replace(/(?<!\w)_([^_]+)_(?!\w)/g, "$1");

  // 8. Strip HTML tags
  cleaned = cleaned.replace(/<[^>]+>/g, "");

  // 9. Strip horizontal rules (---, ***, ___)
  cleaned = cleaned.replace(/^[-*_]{3,}\s*$/gm, "");

  // 10. Strip blockquote markers (> at line start)
  cleaned = cleaned.replace(/^>\s?/gm, "");

  // 11. Strip heading markers (# at line start)
  cleaned = cleaned.replace(/^#{1,6}\s+/gm, "");

  // 12. Collapse multiple blank lines into a single newline
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");

  // 13. Collapse multiple spaces (outside of newlines)
  cleaned = cleaned.replace(/[ \t]{2,}/g, " ");

  // 14. Trim whitespace
  cleaned = cleaned.trim();

  // 15. Remove empty square brackets left after stripping
  cleaned = cleaned.replace(/\[\]/g, "");

  // 16. Collapse any double spaces created by removals
  cleaned = cleaned.replace(/ {2,}/g, " ");

  return cleaned;
}
