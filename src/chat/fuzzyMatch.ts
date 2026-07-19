/** Standard Levenshtein edit distance between two strings. */
export function levenshtein(a: string, b: string): number {
  const al = a.length;
  const bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  const dp: number[][] = Array.from({ length: al + 1 }, () => new Array<number>(bl + 1).fill(0));
  for (let i = 0; i <= al; i++) dp[i][0] = i;
  for (let j = 0; j <= bl; j++) dp[0][j] = j;
  for (let i = 1; i <= al; i++) {
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[al][bl];
}

function commonPrefixLength(a: string, b: string): number {
  const len = Math.min(a.length, b.length);
  let i = 0;
  while (i < len && a[i] === b[i]) i++;
  return i;
}

/** Treats two condition/modification names as "the same" entry even across
 *  Czech word-form variants the model may inconsistently pick between turns
 *  (e.g. "vyčerpaný" adjective vs "vyčerpání" noun — same exhaustion, just a
 *  different grammatical form) — without an LLM call, so it's free.
 *
 *  Only the last word is allowed to fuzz, and only when it shares a long
 *  common stem with a short edit distance — "zraněná ruka" vs "zraněná
 *  noha" must NOT match (different body parts, small edit distance would
 *  otherwise wrongly merge them). All leading words must match exactly. */
export function namesMatch(a: string, b: string): boolean {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (x === y) return true;

  const xWords = x.split(/\s+/);
  const yWords = y.split(/\s+/);
  if (xWords.length !== yWords.length) return false;
  for (let i = 0; i < xWords.length - 1; i++) {
    if (xWords[i] !== yWords[i]) return false;
  }

  const xLast = xWords[xWords.length - 1];
  const yLast = yWords[yWords.length - 1];
  if (xLast === yLast) return true;
  if (xLast.length < 4 || yLast.length < 4) return false;

  const minLen = Math.min(xLast.length, yLast.length);
  const prefix = commonPrefixLength(xLast, yLast);
  if (prefix < minLen - 3) return false; // must share a stem, differ only near the tail

  return levenshtein(xLast, yLast) <= 2;
}
