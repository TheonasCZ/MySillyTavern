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
