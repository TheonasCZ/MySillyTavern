import { describe, expect, it } from "vitest";

import { chunkMessagesForEmbedding, factEmbeddingText, selectBackfillCandidates } from "./embeddingsEngine";

function msg(id: string, role: string, content: string) {
  return { id, role, content };
}

describe("chunkMessagesForEmbedding", () => {
  it("returns no chunks for no messages", () => {
    expect(chunkMessagesForEmbedding([])).toEqual([]);
  });

  it("folds up to 6 messages into one chunk keyed by the first message id", () => {
    const messages = Array.from({ length: 6 }, (_, i) => msg(`m${i}`, "user", `krátká ${i}`));
    const chunks = chunkMessagesForEmbedding(messages);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].refId).toBe("m0");
  });

  it("starts a new chunk after 6 messages", () => {
    const messages = Array.from({ length: 8 }, (_, i) => msg(`m${i}`, "user", `krátká ${i}`));
    const chunks = chunkMessagesForEmbedding(messages);
    expect(chunks).toHaveLength(2);
    expect(chunks[1].refId).toBe("m6");
  });

  it("splits early when the char cap is reached", () => {
    const long = "x".repeat(1600);
    const chunks = chunkMessagesForEmbedding([msg("a", "user", long), msg("b", "assistant", "ok")]);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].refId).toBe("a");
    expect(chunks[1].refId).toBe("b");
  });

  it("labels roles as Hráč/Vypravěč", () => {
    const [chunk] = chunkMessagesForEmbedding([
      msg("a", "user", "Vytáhnu krystal."),
      msg("b", "assistant", "Krystal se rozzáří."),
    ]);
    expect(chunk.text).toContain("Hráč: Vytáhnu krystal.");
    expect(chunk.text).toContain("Vypravěč: Krystal se rozzáří.");
  });

  it("overlap=0 behaves the same as no overlap", () => {
    const messages = Array.from({ length: 8 }, (_, i) => msg(`m${i}`, "user", `krátká ${i}`));
    const noOverlap = chunkMessagesForEmbedding(messages);
    const explicitZero = chunkMessagesForEmbedding(messages, 0);
    expect(explicitZero).toEqual(noOverlap);
  });

  it("overlap=3 carries last 3 messages into next chunk", () => {
    const messages = Array.from({ length: 12 }, (_, i) => msg(`m${i}`, "user", `krátká ${i}`));
    const chunks = chunkMessagesForEmbedding(messages, 3);
    // 12 messages, chunk size 6, overlap 3:
    // chunk 0: m0..m5 (refId m0), keep m3,m4,m5
    // chunk 1: m3..m8 (refId m3), keep m6,m7,m8
    // chunk 2: m6..m11 (refId m6), flush with keep=0
    expect(chunks).toHaveLength(3);
    expect(chunks[0].refId).toBe("m0");
    expect(chunks[1].refId).toBe("m3");
    expect(chunks[2].refId).toBe("m6");
  });

  it("overlap text appears in both chunks that share messages", () => {
    const messages = [
      msg("a", "user", "Ahoj"),
      msg("b", "assistant", "Nazdar"),
      msg("c", "user", "Jak je?"),
      msg("d", "assistant", "Dobře."),
      msg("e", "user", "Super."),
      msg("f", "assistant", "Fajn."),
      msg("g", "user", "Konec."),
    ];
    // 7 messages, chunk size 6, overlap 3:
    // chunk 0: a..f (refId a), keep d,e,f
    // chunk 1: d..g (refId d)
    const chunks = chunkMessagesForEmbedding(messages, 3);
    expect(chunks).toHaveLength(2);
    // Both chunks should contain messages d, e, f
    expect(chunks[0].text).toContain("Hráč: Super.");
    expect(chunks[1].text).toContain("Hráč: Super.");
  });
});

describe("selectBackfillCandidates", () => {
  it("drops the last verbatimWindow messages", () => {
    const messages = Array.from({ length: 10 }, (_, i) => msg(`m${i}`, "user", `${i}`));
    const result = selectBackfillCandidates(messages, 4);
    expect(result.map((m) => m.id)).toEqual(["m0", "m1", "m2", "m3", "m4", "m5"]);
  });

  it("filters out non user/assistant roles", () => {
    const messages = [msg("a", "system", "sys"), msg("b", "user", "hi"), msg("c", "assistant", "hey")];
    const result = selectBackfillCandidates(messages, 0);
    expect(result.map((m) => m.id)).toEqual(["b", "c"]);
  });

  it("returns empty when history is shorter than the window", () => {
    const messages = Array.from({ length: 3 }, (_, i) => msg(`m${i}`, "user", `${i}`));
    expect(selectBackfillCandidates(messages, 20)).toEqual([]);
  });
});

describe("factEmbeddingText", () => {
  it("is deterministic and includes category/subject", () => {
    expect(factEmbeddingText({ category: "event", subject: "Krystal", fact: "Nalezen v lese." })).toBe(
      "(event/Krystal) Nalezen v lese.",
    );
  });
});
