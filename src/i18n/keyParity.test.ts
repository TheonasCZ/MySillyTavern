import { describe, expect, it } from "vitest";

import cs from "./cs.json";
import en from "./en.json";

/** Recursively collects every leaf key path (e.g. "chat.room.errors.generic")
 * from a nested translation object, so we can diff the two locale files
 * structurally rather than just checking top-level namespaces. */
function collectKeyPaths(obj: unknown, prefix = ""): string[] {
  if (obj === null || typeof obj !== "object") return [prefix];
  const entries = Object.entries(obj as Record<string, unknown>);
  return entries.flatMap(([key, value]) => collectKeyPaths(value, prefix ? `${prefix}.${key}` : key));
}

describe("i18n key parity", () => {
  it("cs.json and en.json declare exactly the same set of keys", () => {
    const csKeys = collectKeyPaths(cs).sort();
    const enKeys = collectKeyPaths(en).sort();

    const missingInEn = csKeys.filter((k) => !enKeys.includes(k));
    const missingInCs = enKeys.filter((k) => !csKeys.includes(k));

    expect(missingInEn, `keys present in cs.json but missing in en.json: ${missingInEn.join(", ")}`).toEqual([]);
    expect(missingInCs, `keys present in en.json but missing in cs.json: ${missingInCs.join(", ")}`).toEqual([]);
  });

  it("no translation value is an empty string", () => {
    const checkEmpty = (obj: unknown, prefix: string, file: string) => {
      if (obj === null || typeof obj !== "object") {
        expect(obj, `${file}: ${prefix} is empty`).not.toBe("");
        return;
      }
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        checkEmpty(value, prefix ? `${prefix}.${key}` : key, file);
      }
    };
    checkEmpty(cs, "", "cs.json");
    checkEmpty(en, "", "en.json");
  });
});
