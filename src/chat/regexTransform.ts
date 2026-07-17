export interface RegexRule {
  id: string;
  pattern: string;
  replacement: string;
  enabled: boolean;
}

/**
 * Applies a set of regex find/replace rules to the input text.
 * Rules are stored as a JSON string (per-preset). Invalid patterns
 * are silently skipped with a console.warn.
 */
export function applyRegexRules(text: string, rulesJson: string): string {
  if (!rulesJson || rulesJson === "[]") return text;

  let rules: RegexRule[];
  try {
    rules = JSON.parse(rulesJson) as RegexRule[];
    if (!Array.isArray(rules) || rules.length === 0) return text;
  } catch {
    // Invalid JSON — treat as no rules
    return text;
  }

  let result = text;
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (!rule.pattern) continue;
    try {
      const re = new RegExp(rule.pattern, "g");
      result = result.replace(re, rule.replacement);
    } catch (err) {
      console.warn(`regexTransform: invalid pattern "${rule.pattern}"`, err);
    }
  }

  return result;
}
