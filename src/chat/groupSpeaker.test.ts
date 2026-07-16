import { describe, expect, it } from "vitest";

import { mergeConsecutiveRoles, pickNextSpeaker, stripSpeakerPrefix, type SpeakerCandidate } from "./groupSpeaker";
import type { PromptMessage } from "../prompt/promptBuilder";

const MEMBERS: SpeakerCandidate[] = [
  { id: "a", name: "Anna", position: 0 },
  { id: "b", name: "Věž", position: 1 },
  { id: "c", name: "Kai", position: 2 },
];

describe("pickNextSpeaker", () => {
  it("returns null for an empty member list", () => {
    expect(pickNextSpeaker([], "hello", [])).toBeNull();
  });

  it("returns the only member for a single-member list, ignoring text/history", () => {
    const single: SpeakerCandidate[] = [{ id: "a", name: "Anna", position: 0 }];
    expect(pickNextSpeaker(single, "", [])).toBe("a");
  });

  it("matches a name mentioned without diacritics ('vez' -> 'Věž')", () => {
    expect(pickNextSpeaker(MEMBERS, "rekni to vez", [])).toBe("b");
  });

  it("picks the last-mentioned member when several are named in the text", () => {
    const text = "Anna a Kai si povidali, pak prisla Vez.";
    expect(pickNextSpeaker(MEMBERS, text, [])).toBe("b");
  });

  it("falls back to round-robin on the longest-silent member when no name is mentioned", () => {
    // a and b have spoken recently (oldest -> newest); c never spoke.
    const recent = ["a", "b", "a"];
    expect(pickNextSpeaker(MEMBERS, "no names here", recent)).toBe("c");
  });

  it("prefers never-spoken members by position when several never spoke", () => {
    const recent = ["a"]; // b and c never spoke; b has lower position
    expect(pickNextSpeaker(MEMBERS, "", recent)).toBe("b");
  });

  it("picks the member who spoke longest ago when everyone has spoken", () => {
    const recent = ["c", "a", "b", "a"]; // last occurrence indices: c=0, a=3, b=2
    expect(pickNextSpeaker(MEMBERS, "", recent)).toBe("c");
  });

  it("handles empty text by falling back to round-robin", () => {
    expect(pickNextSpeaker(MEMBERS, "", [])).toBe("a");
  });
});

describe("stripSpeakerPrefix", () => {
  it("strips a plain 'Name:' prefix", () => {
    expect(stripSpeakerPrefix("Anna: Hello there.", "Anna")).toBe("Hello there.");
  });

  it("strips a bold '**Name:**' prefix", () => {
    expect(stripSpeakerPrefix("**Anna:** Hello there.", "Anna")).toBe("Hello there.");
  });

  it("is case/diacritics insensitive when matching the prefix", () => {
    expect(stripSpeakerPrefix("VEZ: Ahoj.", "Věž")).toBe("Ahoj.");
  });

  it("does not touch an occurrence of the name in the middle of the text", () => {
    const text = "He said hello, Anna: that was odd.";
    expect(stripSpeakerPrefix(text, "Anna")).toBe(text);
  });

  it("is a no-op when the prefix belongs to a different name", () => {
    const text = "Kai: Hello there.";
    expect(stripSpeakerPrefix(text, "Anna")).toBe(text);
  });

  it("is a no-op on text with no prefix at all", () => {
    const text = "Just a plain sentence.";
    expect(stripSpeakerPrefix(text, "Anna")).toBe(text);
  });
});

describe("mergeConsecutiveRoles", () => {
  it("merges adjacent same-role messages by joining content with \\n\\n", () => {
    const input: PromptMessage[] = [
      { role: "system", content: "sys" },
      { role: "assistant", content: "Anna: Hi." },
      { role: "assistant", content: "Kai: Yo." },
      { role: "user", content: "Hey both." },
    ];
    expect(mergeConsecutiveRoles(input)).toEqual([
      { role: "system", content: "sys" },
      { role: "assistant", content: "Anna: Hi.\n\nKai: Yo." },
      { role: "user", content: "Hey both." },
    ]);
  });

  it("leaves already-alternating messages untouched", () => {
    const input: PromptMessage[] = [
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "u2" },
    ];
    expect(mergeConsecutiveRoles(input)).toEqual(input);
  });

  it("handles an empty list", () => {
    expect(mergeConsecutiveRoles([])).toEqual([]);
  });

  it("does not mutate the input array's message objects", () => {
    const input: PromptMessage[] = [
      { role: "assistant", content: "a1" },
      { role: "assistant", content: "a2" },
    ];
    const out = mergeConsecutiveRoles(input);
    expect(input[0].content).toBe("a1");
    expect(out[0].content).toBe("a1\n\na2");
  });
});
