import { describe, expect, it } from "vitest";

import { prepareForTts } from "./ttsText";

describe("prepareForTts", () => {
  it("strips bold markers", () => {
    expect(prepareForTts("Hello **world**!")).toBe("Hello world!");
  });

  it("strips italic markers (asterisk)", () => {
    expect(prepareForTts("Hello *world*!")).toBe("Hello world!");
  });

  it("strips italic markers (underscore)", () => {
    expect(prepareForTts("Hello _world_!")).toBe("Hello world!");
  });

  it("strips inline code", () => {
    expect(prepareForTts("Use `const x = 1` here.")).toBe("Use const x = 1 here.");
  });

  it("strips fenced code blocks", () => {
    expect(
      prepareForTts("Before\n```\ncode block\nmore code\n```\nAfter"),
    ).toBe("Before\n\nAfter");
  });

  it("strips OOC blocks in square brackets", () => {
    expect(prepareForTts("Let's go. [OOC: are you sure?] Yes!")).toBe(
      "Let's go. Yes!",
    );
  });

  it("strips OOC blocks in parentheses", () => {
    expect(prepareForTts("Hello (OOC: this is meta) world")).toBe(
      "Hello world",
    );
  });

  it("strips OOC blocks case-insensitively", () => {
    expect(prepareForTts("Say [ooc: wait] hello")).toBe("Say hello");
  });

  it("strips Markdown links, keeping link text", () => {
    expect(prepareForTts("Go to [Google](https://google.com) now.")).toBe(
      "Go to Google now.",
    );
  });

  it("strips dice expressions like [1d20]", () => {
    expect(prepareForTts("Roll [1d20] for initiative.")).toBe(
      "Roll for initiative.",
    );
  });

  it("strips dice expressions like [2k6+3]", () => {
    expect(prepareForTts("Damage: [2k6+3]")).toBe("Damage:");
  });

  it("strips inline annotation tags like [1]", () => {
    expect(prepareForTts("Option [1] is best.")).toBe("Option is best.");
  });

  it("strips HTML tags", () => {
    expect(prepareForTts("Say <i>hello</i> there.")).toBe(
      "Say hello there.",
    );
  });

  it("strips horizontal rules", () => {
    expect(prepareForTts("Above\n---\nBelow")).toBe("Above\n\nBelow");
  });

  it("strips blockquote markers", () => {
    expect(prepareForTts("> quoted text")).toBe("quoted text");
  });

  it("strips heading markers", () => {
    expect(prepareForTts("## Chapter 1\n\nThe story begins.")).toBe(
      "Chapter 1\n\nThe story begins.",
    );
  });

  it("collapses multiple blank lines", () => {
    expect(prepareForTts("A\n\n\n\nB")).toBe("A\n\nB");
  });

  it("collapses multiple spaces", () => {
    expect(prepareForTts("Hello    world.")).toBe("Hello world.");
  });

  it("trims surrounding whitespace", () => {
    expect(prepareForTts("  \n hello \n  ")).toBe("hello");
  });

  it("removes empty square brackets left after stripping", () => {
    expect(prepareForTts("Say [] hello")).toBe("Say hello");
  });

  it("handles complex message with mixed elements", () => {
    const input = `**Narrator:** You enter the dark forest. [OOC: roll perception?]

> The trees loom overhead
## The Path

You see *faint* lights ahead. Roll [1d20] for navigation.

\`\`\`
console.log('debug')
\`\`\`

Choose: [1] Go left, [2] Go right. <b>Careful!</b>`;

    const result = prepareForTts(input);
    expect(result).toContain("Narrator:");
    expect(result).toContain("You enter the dark forest.");
    expect(result).not.toContain("[OOC:");
    expect(result).not.toContain("**");
    expect(result).not.toContain("```");
    expect(result).not.toContain("[1d20]");
    expect(result).not.toContain("[1]");
    expect(result).not.toContain("[2]");
    expect(result).not.toContain("<b>");
    expect(result).not.toContain("## ");
    expect(result).not.toContain("> ");
  });

  it("preserves normal text unchanged", () => {
    const input = "The quick brown fox jumps over the lazy dog.";
    expect(prepareForTts(input)).toBe(input);
  });

  it("handles empty input", () => {
    expect(prepareForTts("")).toBe("");
  });
});
