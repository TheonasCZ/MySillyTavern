# MySillyTavern — plán aplikace (desktop, později mobil)

## Kontext

Vlastní, lepší obdoba SillyTavern: desktopová aplikace pro AI textové RPG (roleplay s kartami postav), napojená přes API klíče na Gemini / Claude / ChatGPT / DeepSeek / OpenRouter. Existující řešení nevyhovují (SillyTavern Ultra má rozbité UI, padá na tmavém motivu). Dlouhodobý cíl: mobilní aplikace ve stylu MiniTavern — proto stack, který umožní sdílet kód.

**Hlavní odlišnost od SillyTavern:** paměťový systém proti „fantazírování" AI při dlouhém hraní. Místo posílání celé historie držíme strukturovaná fakta hry v lokální DB a AI dostává krátký autoritativní kontext. Šetří tokeny a drží konzistenci příběhu.

Rozhodnuto s uživatelem:
- **Stack:** Tauri 2 + React + TypeScript (na mobil později Tauri Mobile / Capacitor, ~90 % kódu sdíleno)
- **Data:** lokálně, SQLite; žádný server, žádný účet
- **MVP:** chat + karty postav, lorebooky (World Info), persony, paměťový systém (ledger + shrnutí)
- **Paměť:** stavový ledger faktů + průběžné shrnutí; extrakci faktů dělá levný model na pozadí (výchozí: stejné připojení jako herní model — uživatel plánuje Gemini Flash Lite free tier, extra volání jsou zdarma)
- **UI:** česky + anglicky (i18n od začátku, čeština výchozí), tmavý motiv jako první občan
- **Odloženo na v2:** skupinové chaty, vektorový retrieval vzpomínek, sync mezi zařízeními

## Technologie

| Vrstva | Volba |
|---|---|
| Shell | Tauri 2 (Rust backend, malá binárka, budoucí mobil) |
| UI | React 18 + TypeScript + Vite |
| Styly | Tailwind CSS 4 jako technika zápisu; **vizuální design řídí skill `frontend-design`** (moderní, přívětivé UI, ne šablonový vzhled), dark-first (CSS proměnné, light/dark přepínač) |
| Stav | Zustand |
| DB | SQLite přes `tauri-plugin-sql` |
| API klíče | `tauri-plugin-stronghold` nebo OS keyring (`keyring` crate) — nikdy plaintext v DB |
| i18n | react-i18next, soubory `cs.json` / `en.json` |
| HTTP na LLM | fetch z frontendu přes Tauri (obchází CORS) nebo Rust command; streaming přes SSE |

**Klíčový požadavek — bleskové odpovědi:** streaming „slovo po slově" jako v MiniTavern. První token na obrazovce do ~1 s, text se plynule dopisuje, žádné čekací kolečko. Všechny tři provider adaptéry MUSÍ používat streamovací endpointy (SSE) a UI vykresluje tokeny okamžitě, jak přicházejí (bez debounce/bufferování celých vět).

## Architektura (moduly)

```
src/
  providers/     — adaptéry LLM (jednotné rozhraní ChatProvider)
  prompt/        — PromptBuilder: skládání kontextu z paměti
  memory/        — MemoryEngine: ledger, summarizer, extraktor
  cards/         — import/export karet postav (PNG+JSON, spec V2/V3)
  db/            — schéma, migrace, repozitáře
  ui/            — obrazovky a komponenty
  i18n/
src-tauri/       — Rust: okno, SQLite plugin, keyring, čtení PNG chunků
```

### 1. Providers
Jedno rozhraní `ChatProvider { chatStream(messages, params): AsyncIterable<token> }`. Implementace:
- **OpenAI-compatible** (pokryje ChatGPT, DeepSeek, OpenRouter — liší se jen base URL a modelem)
- **Gemini** (generateContent / streamGenerateContent)
- **Claude** (Messages API)

Konfigurace připojení: provider, base URL, API klíč, model, teplota/top-p, max tokenů. Uložené jako pojmenované „presety připojení"; zvlášť volitelný preset pro extrakci paměti (výchozí = herní preset).

### 2. Karty postav (kompatibilita se SillyTavern)
- Import PNG: číst tEXt chunk `chara` (base64 JSON, Character Card spec V2, u V3 chunk `ccv3`) — parsování chunků v Rustu nebo `png-chunks-extract` v JS
- Import čistého JSON, export zpět do PNG (vložit chunk do obrázku)
- Pole: name, description, personality, scenario, first_mes, mes_example, alternate_greetings, character_book (vestavěný lorebook), tags, avatar
- Editor karty v UI + galerie postav s vyhledáváním a tagy

### 3. Paměťový systém (klíčová hodnota aplikace)
**Ledger** — tabulka faktů: `(id, chat_id, category, subject, fact, status, created_at, updated_at)`.
Kategorie: `player` (kdo je hráč, schopnosti, inventář), `world` (žánr, pravidla — např. „magie je vzácná, hráč je amatérský mág"), `npc`, `event`, `quest`. Fakta lze v UI prohlížet, editovat, mazat, zamknout (zamčené extraktor nesmí přepsat — pojistka proti driftu).

**Shrnutí** — tabulka `summaries(chat_id, up_to_message_id, text)`. Když historie přesáhne práh, starší zprávy se zkomprimují do/aktualizují shrnutí.

**Extraktor** — po každých N zprávách (výchozí 10, nastavitelné) tiché volání extrakčního modelu se strukturovaným promptem: „z těchto zpráv vytěž nová/změněná fakta jako JSON". Výstup se merguje do ledgeru (upsert dle subject+category, zamčená fakta se nemění). Selhání extrakce nesmí rozbít hru — jen log + retry příště.

**PromptBuilder** — každý herní prompt skládá:
1. System: karta postavy + persona hráče
2. `[FAKTA SVĚTA — závazná]`: blok z ledgeru (world, player, aktivní npc/quest)
3. Zásahy lorebooků (keyword scan posledních X zpráv, priorita, token budget)
4. `[DOSAVADNÍ PŘÍBĚH]`: shrnutí
5. Posledních ~20 zpráv doslovně
Token budget hlídat počítadlem (odhad ~4 znaky/token stačí), sekce se ořezávají v daném pořadí priorit.

### 4. Lorebooky
Tabulky `lorebooks` a `lore_entries(keys[], content, priority, always_on, case_sensitive)`. Import/export formátu SillyTavern World Info JSON. Aktivace: sken klíčových slov v posledních zprávách. Lorebook lze přiřadit postavě, chatu, nebo globálně.

### 5. Databázové schéma (SQLite)
`connections`, `characters`, `personas`, `chats` (FK postava, persona, connection), `messages` (role, content, swipe varianty), `lorebooks`, `lore_entries`, `ledger_facts`, `summaries`, `settings`. Migrace číslované, spouštěné při startu.

### 6. UI (dark-first, responzivní už teď kvůli mobilu)
- **Chat**: streamované odpovědi, regenerace/swipe variant, editace zpráv, markdown + kurzíva pro akce, avatar postavy
- **Panel paměti** (postranní): záložky Fakta (ledger s editací a zámky) / Shrnutí / Lorebook zásahy — průhlednost = důvěra, uživatel vidí, co AI dostává
- **Galerie postav**, **editor karty**, **persony**, **lorebooky**, **nastavení** (připojení, extrakce, jazyk, motiv)
- Layout mobile-friendly od začátku (jeden sloupec + vysouvací panely), ať port na mobil nebolí

## Milníky (pořadí implementace)

1. **M1 – Skeleton**: Tauri + React + Vite + Tailwind + i18n + SQLite s migracemi; nastavení připojení + bezpečné uložení klíče; test spojení na Gemini free tier
2. **M2 – Chat**: provider adaptéry (Gemini, OpenAI-compatible, Claude), streaming slovo po slově (token-by-token render, měřit čas do prvního tokenu), základní chat UI s historií v DB; před stavbou UI načíst skill `frontend-design`
3. **M3 – Postavy**: import PNG/JSON karet, galerie, editor, export; chat vázaný na postavu (first_mes, scénář)
4. **M4 – Persony + lorebooky**: správa person, lorebooky s keyword aktivací, import World Info
5. **M5 – Paměť**: ledger + extraktor + summarizer + PromptBuilder + panel paměti v UI
6. **M6 – Finiš**: token budget ladění, EN překlad, light motiv, export/záloha dat, chybové stavy

## Ověření

- Po každém milníku spustit `npm run tauri dev` a projít flow ručně
- M2: reálný chat proti Gemini free tier (uživatelův klíč), ověřit streaming a ukládání
- M3: importovat reálnou kartu ze SillyTavern komunity (PNG), ověřit všechna pole
- M5: dlouhý testovací chat (50+ zpráv) — ověřit, že ledger obsahuje správná fakta, shrnutí se aktualizuje a prompt drží token budget; simulovat „drift" (zkusit AI přesvědčit, že hráč je polobůh) a ověřit, že zamčená fakta v promptu drží
- Jednotkové testy: parsování PNG chunků, PromptBuilder (skládání a ořez), merge ledgeru

## Budoucnost (mimo tento plán)
Mobil (Tauri 2 Mobile / Capacitor), skupinové chaty, vektorový retrieval vzpomínek, sync přes soubor/cloud, TTS a generování obrázků.
