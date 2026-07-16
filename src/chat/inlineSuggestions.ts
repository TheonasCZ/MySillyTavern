/** Extracts "what do you do next" options that RP models often append to
 * their replies (a question like "Co uděláš?" followed by 2-4 numbered or
 * bulleted lines). When present, these replace the extra suggest-replies
 * LLM call — the options are already in the message. Pure, unit-tested. */

const MARKER = /^\s*(?:\*\*)?(?:\d+[.)]|[a-dA-D][.)]|[-*•▪])(?:\*\*)?\s+/;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 4;
const MAX_OPTION_LENGTH = 400;

/** Only the list marker is removed — emphasis markers (**bold**, *italics*)
 * stay in the text so the chips can render them and the clicked-in message
 * keeps its styling. */
function stripMarker(line: string): string {
  return line.replace(MARKER, "").trim();
}

/** Returns the trailing option block of an assistant reply (marker lines at
 * the very end, ignoring blank lines between them), or [] when the reply
 * doesn't end with one. */
export function extractInlineSuggestions(text: string): string[] {
  const lines = text.split("\n");
  const options: string[] = [];

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.trim()) continue; // blank lines inside/after the block are fine
    if (!MARKER.test(line)) break; // first non-option line ends the block
    const option = stripMarker(line);
    if (option.length === 0 || option.length > MAX_OPTION_LENGTH) break;
    options.push(option);
    if (options.length > MAX_OPTIONS) return [];
  }

  if (options.length < MIN_OPTIONS) return [];
  return options.reverse();
}
