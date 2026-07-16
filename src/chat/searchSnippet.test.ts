import { describe, expect, it } from "vitest";

import { foldForSearch, searchSnippet } from "./searchSnippet";

describe("foldForSearch", () => {
  it("strips diacritics and lowercases", () => {
    expect(foldForSearch("Věž U Kříže")).toBe("vez u krize");
    expect(foldForSearch("ŘEŘICHA")).toBe("rericha");
  });

  it("keeps emoji and plain text unchanged", () => {
    expect(foldForSearch("ahoj 😀!")).toBe("ahoj 😀!");
  });
});

describe("searchSnippet", () => {
  it("returns short content unchanged when the term is at the start", () => {
    expect(searchSnippet("krystal se rozzářil", "krystal")).toBe("krystal se rozzářil");
  });

  it("finds the term case-insensitively and adds ellipses around a long match", () => {
    const content = `${"a".repeat(100)} Krystal uprostřed ${"b".repeat(100)}`;
    const snippet = searchSnippet(content, "krystal");
    expect(snippet).toContain("Krystal uprostřed");
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
    expect(snippet.length).toBeLessThan(content.length);
  });

  it("matches without diacritics ('vez' finds 'věž')", () => {
    const content = `${"x".repeat(80)} stará věž na kopci ${"y".repeat(80)}`;
    const snippet = searchSnippet(content, "vez");
    expect(snippet).toContain("věž na kopci");
  });

  it("keeps positions correct with emoji before the match", () => {
    const content = `😀😀😀 ${"x".repeat(70)} krystal ${"y".repeat(70)}`;
    expect(searchSnippet(content, "KRYSTAL")).toContain("krystal");
  });

  it("falls back to a leading excerpt when the term is missing", () => {
    const content = "c".repeat(300);
    const snippet = searchSnippet(content, "nenajdeš");
    expect(snippet.length).toBeLessThanOrEqual(121);
    expect(snippet.endsWith("…")).toBe(true);
  });
});
