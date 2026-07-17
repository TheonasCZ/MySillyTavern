import { describe, expect, it } from "vitest";

import worldInfoSampleFixture from "./__fixtures__/worldInfoSample.json";
import { expandKeys } from "./stemming";
import {
  entriesToWorldInfo,
  parseWorldInfoJson,
  worldInfoToEntries,
  type LoreEntryFields,
  type WorldInfoFile,
} from "./worldInfoImport";

/** A realistic-shaped SillyTavern World Info export fixture — the same
 * field names/shape as a real "Ashford Keep.json" world book: an
 * `entries` map keyed by uid, mixing constant (always-on), keyed, and
 * disabled entries with non-default priorities and case sensitivity. */
const FIXTURE: WorldInfoFile = {
  entries: {
    "0": {
      key: ["Ashford", "the keep"],
      keysecondary: ["siege"],
      content: "Ashford Keep has stood for three centuries and never fallen to siege.",
      comment: "Setting: Ashford Keep",
      constant: false,
      order: 100,
      disable: false,
      case_sensitive: false,
    },
    "1": {
      key: [],
      keysecondary: [],
      content: "The realm's calendar uses a 10-month year; magic is rare and feared.",
      comment: "World rules",
      constant: true,
      order: 200,
      disable: false,
      case_sensitive: false,
    },
    "2": {
      key: ["Captain Vane"],
      content: "Captain Vane secretly serves the rival house of Ardenne.",
      comment: "NPC secret",
      constant: false,
      order: 50,
      disable: true,
      case_sensitive: true,
    },
  },
};

describe("worldInfoToEntries", () => {
  it("maps every World Info field to its lore_entries counterpart per the plan's mapping table", () => {
    const entries = worldInfoToEntries(FIXTURE);
    expect(entries).toHaveLength(3);

    const ashford = entries.find((e) => e.comment === "Setting: Ashford Keep")!;
    expect(ashford.keys).toEqual(["Ashford", "the keep"]);
    // Original secondary key is preserved; expanded primary-key forms are merged in.
    expect(ashford.secondaryKeys).toContain("siege");
    for (const k of expandKeys(["Ashford", "the keep"])) {
      expect(ashford.secondaryKeys).toContain(k);
    }
    expect(ashford.content).toBe(
      "Ashford Keep has stood for three centuries and never fallen to siege.",
    );
    expect(ashford.priority).toBe(100);
    expect(ashford.alwaysOn).toBe(false);
    expect(ashford.caseSensitive).toBe(false);
    expect(ashford.enabled).toBe(true); // disable: false -> enabled: true

    const worldRules = entries.find((e) => e.comment === "World rules")!;
    expect(worldRules.alwaysOn).toBe(true); // constant: true -> always_on

    const secret = entries.find((e) => e.comment === "NPC secret")!;
    expect(secret.enabled).toBe(false); // disable: true -> !enabled
    expect(secret.caseSensitive).toBe(true);
  });

  it("defaults missing optional fields sensibly", () => {
    const [entry] = worldInfoToEntries({ entries: { "0": {} } });
    expect(entry.keys).toEqual([]);
    expect(entry.secondaryKeys).toEqual([]);
    expect(entry.content).toBe("");
    expect(entry.comment).toBe("");
    expect(entry.priority).toBe(100);
    expect(entry.alwaysOn).toBe(false);
    expect(entry.caseSensitive).toBe(false);
    expect(entry.enabled).toBe(true);
  });
});

describe("parseWorldInfoJson", () => {
  it("parses a real-shaped World Info JSON file's text", () => {
    const entries = parseWorldInfoJson(JSON.stringify(FIXTURE));
    expect(entries).toHaveLength(3);
  });

  it("throws on JSON without an `entries` object", () => {
    expect(() => parseWorldInfoJson(JSON.stringify({ foo: "bar" }))).toThrow();
  });

  it("imports the on-disk World Info sample fixture (`__fixtures__/worldInfoSample.json`) — this stands in for M4's 'import a real World Info JSON' acceptance check", () => {
    const entries = parseWorldInfoJson(JSON.stringify(worldInfoSampleFixture));
    expect(entries).toHaveLength(3);
    expect(entries.some((e) => e.alwaysOn)).toBe(true);
    expect(entries.some((e) => !e.enabled)).toBe(true);
    expect(entries.find((e) => e.comment === "Setting: Ashford Keep")?.keys).toEqual([
      "Ashford",
      "the keep",
    ]);
    // Extra unmodeled fields like `uid`/`selective` are simply ignored, not
    // an error — real ST exports carry more fields than this app models.
  });
});

describe("entriesToWorldInfo / roundtrip", () => {
  it("mirrors the import mapping on export", () => {
    const fields: LoreEntryFields = {
      keys: ["a", "b"],
      secondaryKeys: ["c"],
      content: "some lore",
      comment: "a comment",
      priority: 42,
      alwaysOn: true,
      caseSensitive: true,
      enabled: false,
      recursiveActivation: false,
      activationDepth: 1,
      selectiveKeys: [],
      timed: null,
      vectorThreshold: null,
      vectorBudget: 2,
    };
    const wi = entriesToWorldInfo([fields]);
    const [[, exported]] = Object.entries(wi.entries);
    expect(exported).toEqual({
      key: ["a", "b"],
      keysecondary: ["c"],
      content: "some lore",
      comment: "a comment",
      constant: true,
      order: 42,
      disable: true, // enabled: false -> disable: true
      case_sensitive: true,
    });
  });

  it("import -> export -> import roundtrips to the same entry fields", () => {
    const imported = worldInfoToEntries(FIXTURE);
    const exported = entriesToWorldInfo(imported);
    const reimported = worldInfoToEntries(exported);

    // Order is preserved by array index, so comparing arrays directly is fine.
    expect(reimported).toEqual(imported);
  });
});
