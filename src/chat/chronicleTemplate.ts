import type { ChunkResult } from "./chronicleTypes";
import { THEMES, type ChronicleTheme } from "./chronicleThemes";

export interface TemplateInput {
  title: string;
  theme: string;
  chapters: ChunkResult[];
  personaName?: string;
  personaAvatarBase64?: string;
}

/**
 * Generates a complete self-contained HTML book from AI-processed prose
 * chunks. Embeds all CSS inline and images as base64 so the file is fully
 * portable (works offline, printable, archivable).
 */
export function buildChronicleHtml(input: TemplateInput): string {
  const t: ChronicleTheme = THEMES[input.theme] ?? THEMES.fantasy;

  const chaptersHtml = input.chapters
    .map(
      (ch, i) => `
  <section class="chapter" id="ch-${i}">
    <h2>${escapeHtml(ch.label ?? `Kapitola ${i + 1}`)}</h2>
    <div class="prose">
      ${ch.prose
        .split("\n")
        .filter(Boolean)
        .map((p) => `<p>${escapeHtml(p)}</p>`)
        .join("\n      ")}
    </div>
  </section>`,
    )
    .join("\n");

  const titlePage = input.personaAvatarBase64
    ? `
  <section class="title-page">
    <div class="portrait">
      <img src="${input.personaAvatarBase64}" alt="Portrét postavy" />
    </div>
    <h1>${escapeHtml(input.title)}</h1>
    <p class="subtitle">Kronika dobrodružství</p>
  </section>`
    : `
  <section class="title-page">
    <h1>${escapeHtml(input.title)}</h1>
    <p class="subtitle">Kronika dobrodružství</p>
  </section>`;

  return `<!DOCTYPE html>
<html lang="cs">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(input.title)} — Kronika</title>
<style>
  :root {
    --bg: ${t.bg};
    --accent: ${t.accent};
    --text: ${t.text};
    --font: ${t.font};
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: var(--font);
    background-color: var(--bg);
    color: var(--text);
    line-height: 1.85;
    max-width: 820px;
    margin: 0 auto;
    padding: 2.5rem 2rem;
  }
  .title-page {
    text-align: center;
    padding: 4rem 0 3rem;
    page-break-after: always;
  }
  .title-page h1 {
    font-size: 2.8rem;
    color: var(--accent);
    margin-bottom: 0.5rem;
    letter-spacing: 0.02em;
  }
  .title-page .subtitle {
    font-size: 1.2rem;
    font-style: italic;
    color: var(--text);
    opacity: 0.7;
  }
  .portrait {
    max-width: 300px;
    margin: 0 auto 2rem;
    border-radius: 8px;
    overflow: hidden;
    border: 3px solid var(--accent);
  }
  .portrait img {
    display: block;
    width: 100%;
    height: auto;
  }
  .chapter {
    margin-bottom: 3.5rem;
    page-break-after: always;
  }
  .chapter h2 {
    font-size: 1.6rem;
    color: var(--accent);
    margin-bottom: 1.2rem;
    padding-bottom: 0.5rem;
    border-bottom: 2px solid var(--accent);
  }
  .prose p {
    margin-bottom: 0.9rem;
    text-indent: 1.5em;
    text-align: justify;
  }
  .prose p:first-child {
    text-indent: 0;
  }
  .appendix {
    margin-top: 4rem;
    padding-top: 2rem;
    border-top: 1px solid var(--accent);
    font-size: 0.85rem;
    opacity: 0.7;
  }
  @media print {
    body { max-width: none; padding: 1.2cm; }
    .chapter { page-break-after: always; }
  }
</style>
</head>
<body>
${titlePage}
${chaptersHtml}
<div class="appendix">
  <p><em>Vygenerováno pomocí MySillyTavern — Kronika export</em></p>
  <p>Téma: ${escapeHtml(input.theme)} | ${new Date().toLocaleDateString("cs-CZ")}</p>
</div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
