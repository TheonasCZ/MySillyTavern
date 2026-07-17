# MySillyTavern

Desktopová aplikace (Tauri 2 + React 19 + TypeScript) pro AI textové RPG —
vlastní, lepší obdoba SillyTavern. Napojuje se přes vlastní API klíče na
Gemini / Claude / OpenAI-compatible poskytovatele (ChatGPT, DeepSeek,
OpenRouter) a lokální Ollamu. Všechna data drží lokálně v SQLite, žádný
server, žádný účet.

Hlavní odlišnost od SillyTavern: **paměťový systém proti „fantazírování" AI**
při dlouhém hraní — strukturovaná fakta hry (ledger), průběžná shrnutí a
sémantický retrieval vzpomínek (embeddingy) místo posílání celé historie.

## Funkce

- **Chat se streamováním** slovo po slově, regenerace/swipe varianty, větvení
  příběhu, inline návrhy reakcí, ukotvení pohledu na odeslanou zprávu
- **Karty postav** — import/export PNG karet (Character Card V2/V3)
  kompatibilních se SillyTavern, galerie, editor
- **Persony, lorebooky** — import/export World Info JSON, aktivační sken
- **Paměť** — ledger faktů (se zámky), summarizer, embeddingy + MMR výběr,
  prompt inspector (co přesně AI dostala)
- **Skupinové chaty** s automatickým výběrem mluvčího a povýšením NPC
- **RPG systémy** — kostky (`/roll`), quest journal, inventář a dovednosti,
  herní kalendář (fantasy měsíce), conditions, reputace frakcí, crafting
- **Kronika** — export příběhu do HTML/Markdown s tématy
- **Statistiky spotřeby** — požadavky a odhad tokenů za den/týden/měsíc
- **Generování ilustrací** (Pollinations) do Memory panelu
- **Zálohy** — ruční i automatické rotující ZIP zálohy při startu
- **TTS předčítání** (Web Speech API), hlas per postava *(rozpracováno)*
- **Prompt presety** per chat *(rozpracováno)*
- i18n čeština/anglicky, dark/light motiv, škálování písma

API klíče se ukládají výhradně do OS keyringu (nikdy do DB ani souborů).

## Vývoj

```bash
npm install
npm run tauri dev    # dev build s hot-reload
npm test             # vitest (jednotkové testy)
npm run e2e          # Playwright smoke testy nad mock IPC harnessem
npm run tauri build  # release build
```

Na Linuxu s Waylandem spouštět s workaroundem pro WebKitGTK:

```bash
GDK_BACKEND=x11 WEBKIT_DISABLE_DMABUF_RENDERER=1 npm run tauri dev
```

Windows a Android buildy běží v GitHub Actions (viz `.github/workflows/`).
Průzkum Android portu: `docs/m15-android-pruzkum.md`.

## Dokumentace

- `PLAN.md` — původní implementační plán (M1–M6, historický dokument)
- `ROADMAP.md` — roadmapa milníků M11+ a stav prací
