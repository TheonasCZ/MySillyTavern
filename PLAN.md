# MySillyTavern — detailní implementační plán

## 1. Kontext a cíl

Vlastní, lepší obdoba SillyTavern: desktopová aplikace pro AI textové RPG (roleplay s kartami postav), napojená přes API klíče na Gemini / Claude / ChatGPT / DeepSeek / OpenRouter. Dlouhodobý cíl je mobilní verze (Tauri 2 Mobile / Capacitor), proto stack se sdílením ~90 % kódu.

Hlavní odlišnost od SillyTavern: **paměťový systém proti „fantazírování" AI** při dlouhém hraní. Místo posílání celé historie držíme strukturovaná fakta hry v lokální SQLite a AI dostává krátký autoritativní kontext. Šetří tokeny a drží konzistenci příběhu.

Klíčový UX požadavek: **streaming „slovo po slově"** — první token na obrazovce do ~1 s, žádné čekací kolečko, žádné bufferování vět.

## 2. Zafixovaná rozhodnutí

| Oblast | Rozhodnutí |
|---|---|
| Shell | Tauri 2 (Rust backend, malá binárka, budoucí mobil) |
| UI | React 18 + TypeScript + Vite |
| Styly | Tailwind CSS 4; vizuální design řídí skill frontend-design; dark-first (CSS proměnné, přepínač light/dark) |
| Stav | Zustand |
| DB | SQLite přes tauri-plugin-sql, migrace číslované, spouštěné při startu |
| API klíče | OS keyring (crate `keyring` v3): Windows Credential Manager / macOS Keychain / libsecret. Bez master hesla. Klíč nikdy v DB ani v JS — Rust si ho vytahuje sám podle connection_id. Přístup abstrahovat za Rust trait `SecretStore` kvůli budoucímu mobilu |
| HTTP na LLM | Rust command + tauri Channel: SSE parsuje Rust (reqwest se `stream`), tokeny tečou do UI přes Channel. Frontend má tenký TS wrapper s jednotným rozhraním |
| i18n | react-i18next, `cs.json` / `en.json`, čeština výchozí |
| MVP | chat + karty postav + lorebooky + persony + paměťový systém (ledger + shrnutí) |
| Odloženo na v2 | skupinové chaty, vektorový retrieval, sync mezi zařízeními, TTS, obrázky |
| Data | lokálně, žádný server, žádný účet |

## 3. Založení projektu (součást M1)

```bash
npm create tauri-app@latest mysillytavern -- --template react-ts # Vite + React + TS
```

Frontend závislosti: `zustand`, `react-router-dom`, `i18next`, `react-i18next`, `react-markdown`, `remark-gfm`, `tailwindcss@4`, `@tailwindcss/vite`, `@tauri-apps/api`, `@tauri-apps/plugin-sql`, `@tauri-apps/plugin-dialog`.

Rust závislosti (`src-tauri/Cargo.toml`): `tauri` 2, `tauri-plugin-sql` (feature `sqlite`), `tauri-plugin-dialog`, `keyring = "3"`, `reqwest` (features `json`, `stream`, `rustls-tls`), `tokio`, `futures-util`, `serde`, `serde_json`, `base64`, `crc32fast` (PNG chunky), `thiserror`.

Struktura souborů:

```
src/
  providers/            # tenký TS wrapper nad Rust chat_stream + typy
    types.ts            # ChatMessage, ChatParams, StreamEvent, ConnectionConfig
    chatStream.ts       # invoke('chat_stream') + Channel → callbacky/AsyncIterable
  prompt/
    promptBuilder.ts
    tokenEstimate.ts
  memory/
    memoryEngine.ts     # orchestrace: kdy extrahovat / shrnout
    extractor.ts        # prompt + parsování JSON výstupu + merge do ledgeru
    summarizer.ts
  cards/
    cardTypes.ts        # Character Card V2/V3 typy
    cardImport.ts       # volá Rust import_card_png / parsuje JSON
    cardExport.ts
  lorebooks/
    activation.ts       # keyword scan
    worldInfoImport.ts
  db/
    database.ts         # otevření DB, helper query/execute
    repositories/       # connectionsRepo, charactersRepo, chatsRepo, messagesRepo,
                        # personasRepo, lorebooksRepo, ledgerRepo, summariesRepo, settingsRepo
  stores/               # Zustand: settingsStore, chatStore, charactersStore, ...
  ui/
    layout/             # AppShell, Sidebar, SlidePanel (mobile-friendly)
    chat/               # ChatScreen, MessageList, MessageBubble, ChatInput, SwipeControls
    memory/             # MemoryPanel (záložky Fakta / Shrnutí / Lorebook zásahy)
    characters/         # GalleryScreen, CardEditor
    personas/
    lorebooks/
    settings/           # připojení, extrakce, jazyk, motiv
  i18n/
    index.ts, cs.json, en.json
src-tauri/src/
  main.rs, lib.rs
  commands/             # chat.rs, secrets.rs, cards.rs
  providers/            # mod.rs (trait), openai.rs, gemini.rs, claude.rs, sse.rs
  png_card.rs           # čtení/zápis tEXt chunků
  migrations.rs
```

## 4. Databázové schéma (migrace 001)

Migrace definované v Rustu (`tauri_plugin_sql::Migration`, `MigrationKind::Up`), číslované, spouštěné při startu. ID všude TEXT (UUID z `crypto.randomUUID()`), časy TEXT ISO-8601.

```sql
CREATE TABLE connections (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('openai','gemini','claude')),
  base_url TEXT,                          -- jen openai-compatible (ChatGPT/DeepSeek/OpenRouter)
  model TEXT NOT NULL,
  temperature REAL NOT NULL DEFAULT 0.8, top_p REAL NOT NULL DEFAULT 0.95,
  max_tokens INTEGER NOT NULL DEFAULT 1024,
  context_budget INTEGER NOT NULL DEFAULT 8000,  -- tokeny pro PromptBuilder
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
); -- API klíč NENÍ v DB; keyring service="MySillyTavern", account=connections.id

CREATE TABLE characters (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '', personality TEXT NOT NULL DEFAULT '',
  scenario TEXT NOT NULL DEFAULT '', first_mes TEXT NOT NULL DEFAULT '',
  mes_example TEXT NOT NULL DEFAULT '',
  alternate_greetings TEXT NOT NULL DEFAULT '[]',  -- JSON pole stringů
  system_prompt TEXT NOT NULL DEFAULT '',
  post_history_instructions TEXT NOT NULL DEFAULT '',
  creator_notes TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]',
  avatar_path TEXT,                        -- appdata/avatars/<id>.png
  card_json TEXT,                          -- původní karta beze změn (bezeztrátový export)
  spec_version TEXT NOT NULL DEFAULT 'v2',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE personas (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '', avatar_path TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE chats (
  id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '',
  character_id TEXT NOT NULL REFERENCES characters(id),
  persona_id TEXT REFERENCES personas(id),
  connection_id TEXT REFERENCES connections(id),
  extraction_connection_id TEXT REFERENCES connections(id),  -- NULL = použij connection_id
  last_extracted_message_id TEXT,
  last_summarized_message_id TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY, chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content TEXT NOT NULL,                   -- zrcadlí swipes[active_swipe]
  swipes TEXT NOT NULL DEFAULT '[]',       -- JSON pole variant (u assistant zpráv)
  active_swipe INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_messages_chat ON messages(chat_id, created_at);

CREATE TABLE lorebooks (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE lore_entries (
  id TEXT PRIMARY KEY, lorebook_id TEXT NOT NULL REFERENCES lorebooks(id) ON DELETE CASCADE,
  keys TEXT NOT NULL DEFAULT '[]', secondary_keys TEXT NOT NULL DEFAULT '[]',  -- JSON pole
  content TEXT NOT NULL DEFAULT '', comment TEXT NOT NULL DEFAULT '',
  priority INTEGER NOT NULL DEFAULT 100,
  always_on INTEGER NOT NULL DEFAULT 0, case_sensitive INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);
CREATE INDEX idx_lore_entries_book ON lore_entries(lorebook_id);
CREATE TABLE lorebook_links (
  id TEXT PRIMARY KEY, lorebook_id TEXT NOT NULL REFERENCES lorebooks(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('character','chat','global')),
  target_id TEXT                           -- NULL u global
);

CREATE TABLE ledger_facts (
  id TEXT PRIMARY KEY, chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('player','world','npc','event','quest')),
  subject TEXT NOT NULL, fact TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  locked INTEGER NOT NULL DEFAULT 0,       -- zamčené extraktor nesmí měnit
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE (chat_id, category, subject)
);

CREATE TABLE summaries (
  id TEXT PRIMARY KEY, chat_id TEXT NOT NULL UNIQUE REFERENCES chats(id) ON DELETE CASCADE,
  up_to_message_id TEXT NOT NULL, text TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
-- klíče: language('cs'), theme('dark'), extraction_interval('10'),
-- verbatim_window('20'), lore_scan_depth('4'), lore_token_budget('800'),
-- default_connection_id, default_persona_id
```

## 5. Rust vrstva

### 5.1 Commandy

| Command | Podpis (zjednodušeně) | Poznámka |
|---|---|---|
| `chat_stream` | `(request_id, connection: ConnectionDto, messages: Vec<ChatMessage>, on_event: Channel<StreamEvent>)` | klíč si vytáhne z keyringu dle `connection.id`; streamuje |
| `chat_abort` | `(request_id)` | zruší běžící stream (mapa request_id → CancellationToken) |
| `chat_complete` | `(connection, messages) → String` | nestreamované volání pro extraktor/summarizer/test spojení (interně sbírá stream) |
| `set_api_key` / `delete_api_key` / `has_api_key` | `(connection_id, key?)` | klíč se nikdy nevrací do JS, jen bool |
| `import_card_png` | `(path) → { card_json: String, avatar_saved_to: String }` | čte tEXt chunk, uloží kopii PNG jako avatar |
| `export_card_png` | `(card_json, avatar_path, out_path)` | vloží chunk do PNG |

`StreamEvent` (serde tagged enum): `Start`, `Token { text }`, `Done { finish_reason }`, `Error { message, retryable }`.

### 5.2 Provider adaptéry (Rust, `providers/`)

Společný trait: sestav HTTP požadavek + funkce pro parsování SSE řádku na `StreamEvent`. Sdílený SSE reader (`sse.rs`): čte `bytes_stream`, dělí na řádky, bere `data: ...`. Interní role: `system` / `user` / `assistant`.

**OpenAI-compatible** (ChatGPT, DeepSeek, OpenRouter — liší se jen base_url + model):

- POST `{base_url}/chat/completions`, hlavička `Authorization: Bearer <key>`
- tělo: `{ model, messages, temperature, top_p, max_tokens, stream: true }`
- SSE: `data: {json}` → `choices[0].delta.content`; konec `data: [DONE]`
- výchozí base URL v UI nabídce: OpenAI `https://api.openai.com/v1`, DeepSeek `https://api.deepseek.com`, OpenRouter `https://openrouter.ai/api/v1`

**Gemini:**

- POST `https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?alt=sse`, hlavička `x-goog-api-key: <key>`
- tělo: `{ systemInstruction: {parts:[{text}]}, contents: [{role: 'user'|'model', parts:[{text}]}], generationConfig: { temperature, topP, maxOutputTokens } }` (mapování: system → systemInstruction, assistant → model)
- SSE: `data: {json}` → `candidates[0].content.parts[*].text`

**Claude:**

- POST `https://api.anthropic.com/v1/messages`, hlavičky `x-api-key`, `anthropic-version: 2023-06-01`
- tělo: `{ model, system, messages, max_tokens, temperature, top_p, stream: true }` (system zprávy vyjmout do `system`)
- SSE eventy: `content_block_delta` → `delta.text`; `message_stop` → Done

Chyby: HTTP status ≠ 2xx → přečíst tělo, vrátit `Error { message: <provider message>, retryable: status==429||>=500 }`.

### 5.3 PNG karty (`png_card.rs`)

Ruční průchod chunky (PNG = 8B signatura + chunky délka|typ|data|CRC, `crc32fast`):

- čtení: najít `tEXt` s klíčem `ccv3` (V3, priorita) nebo `chara` (V2); hodnota je base64 JSON → dekódovat, vrátit string
- zápis: odstranit existující `chara`/`ccv3` chunky, vložit nový `tEXt` chunk před `IEND`, přepočítat CRC
- unit testy: roundtrip (zápis → čtení), reálná komunitní karta jako fixture

### 5.4 Keyring (`secrets.rs`)

Trait `SecretStore { get/set/delete }` + implementace `KeyringStore` (`keyring::Entry::new("MySillyTavern", connection_id)`). Trait kvůli budoucí mobilní implementaci.

## 6. Frontend jádro

### 6.1 Provider wrapper (TS)

```ts
interface ChatMessage { role: 'system'|'user'|'assistant'; content: string }
interface StreamCallbacks { onToken(t: string): void; onDone(r: DoneInfo): void; onError(e: StreamError): void }
function chatStream(conn: ConnectionConfig, messages: ChatMessage[], cb: StreamCallbacks): { requestId: string; abort(): Promise<void> }
```

Implementace: `new Channel<StreamEvent>()` z `@tauri-apps/api/core`, `invoke('chat_stream', …)`. Tokeny se rendrují okamžitě (append do stavu streamované zprávy, žádný debounce). Měřit čas do prvního tokenu (log v dev módu).

### 6.2 PromptBuilder (`prompt/promptBuilder.ts`)

Vstup: karta, persona, ledger fakta, shrnutí, aktivované lore záznamy, historie zpráv, `context_budget`. Odhad tokenů: `Math.ceil(chars / 4)`.

Skládání (v tomto pořadí do system zprávy + historie):

1. System: `system_prompt` karty (nebo výchozí RP instrukce) + `description` + `personality` + `scenario` + persona hráče; placeholdery `{{char}}` → jméno postavy, `{{user}}` → jméno persony (nahrazovat ve všech polích karty i lore)
2. `[FAKTA SVĚTA — závazná]`: aktivní fakta z ledgeru, seskupená: world, player, npc, quest, event; formát `- (kategorie/subjekt) fakt`
3. Lorebook zásahy: aktivované záznamy dle priority
4. `[DOSAVADNÍ PŘÍBĚH]`: text shrnutí
5. Historie: posledních ~20 zpráv doslovně (`verbatim_window`) + `post_history_instructions` karty na konec

Ořez při překročení budgetu, v tomto pořadí: (a) lore záznamy od nejnižší priority, (b) starší doslovné zprávy (minimum 4 poslední), (c) shrnutí od začátku textu, (d) fakta kategorií event → quest → npc (world a player se neořezávají), (e) `mes_example`. Jádro system + poslední zprávy se neořezává nikdy. Výstup: `{ messages, report }` — report (co je uvnitř, kolik tokenů, co bylo ořezáno) zobrazí panel paměti.

### 6.3 Paměťový engine (`memory/`)

- **Spouštěč:** po dopsání assistant zprávy → pokud počet zpráv od `last_extracted_message_id` ≥ `extraction_interval` (výchozí 10), zařadit extrakci; pokud počet nesloučených zpráv nad doslovné okno ≥ 10, zařadit shrnutí. Fronta per chat, max 1 běžící job, běží na pozadí, selhání hru nerozbije (jen `console.warn` + pokus při dalším intervalu).
- **Extraktor:** `chat_complete` s extrakčním presetem (výchozí = herní preset; temperature 0). Prompt: aktuální snapshot ledgeru + nové zprávy → „vrať POUZE JSON pole objektů `{category, subject, fact, action: 'upsert'|'remove'}`". Parsování tolerantní (odstranit ```json ploty, najít první `[…]`).
- **Merge do ledgeru:** dle `(chat_id, category, lower(subject))`: existuje & locked → přeskočit; existuje → update fact/status; neexistuje → insert; remove → `status='archived'`.
- **Summarizer:** vezme zprávy od `last_summarized_message_id` po (poslední − `verbatim_window`), pošle „dosavadní shrnutí + nové události → aktualizované shrnutí (max ~300 slov)", přepíše řádek v `summaries`, posune `up_to_message_id`.

### 6.4 Lorebooky

- Aktivace (`activation.ts`): spojit text posledních `lore_scan_depth` (4) zpráv; entry aktivní když `always_on` nebo libovolný klíč je podřetězcem (dle `case_sensitive`); seřadit dle priority sestupně, brát do `lore_token_budget` (800 tokenů).
- Import World Info JSON (SillyTavern): `entries{uid → e}` → `lore_entries`: `key`→keys, `keysecondary`→secondary_keys, `content`→content, `comment`→comment, `constant`→always_on, `order`→priority, `disable`→!enabled. Export zrcadlově.
- Přiřazení přes `lorebook_links`: postavě (včetně `character_book` z karty), chatu, globálně.

### 6.5 Karty postav

- Import PNG (Rust command) i čistého JSON; podpora spec V2 (`chara_card_v2`) a V3 (`chara_card_v3`) — mapování `data.*` polí na sloupce, originál do `card_json`, `character_book` → nový lorebook + link.
- Export: aktuální sloupce zamergovat do `card_json` → V2 JSON → Rust vloží do avataru.
- Galerie s fulltextovým hledáním (name + tags) a filtrem dle tagů; editor karty se všemi poli.

### 6.6 UI a stav

Routy: `/` (seznam chatů), `/chat/:id`, `/characters`, `/characters/:id`, `/personas`, `/lorebooks`, `/lorebooks/:id`, `/settings`.

- Layout: jeden hlavní sloupec + vysouvací panely (Sidebar vlevo, MemoryPanel vpravo jako overlay na úzkých šířkách) — mobile-friendly od začátku.
- Chat: streamovaný render tokenů, markdown (react-markdown + remark-gfm, kurzíva = akce), avatar, editace zprávy, regenerace + swipe šipky (varianty v `messages.swipes`), tlačítko stop (abort).
- Panel paměti: záložky Fakta (tabulka ledgeru: edit, smazat, zámek-toggle) / Shrnutí (čtení + ruční editace) / Lorebook & prompt (report z PromptBuilderu — co přesně AI dostala).
- Nastavení: CRUD presetů připojení (klíč jde jen do keyringu, pole „klíč uložen ✓"), test spojení, extrakční preset + interval, jazyk, motiv.
- Motiv: CSS proměnné na `:root`, třída `dark`/`light` na `<html>`, dark výchozí. Před stavbou UI načíst skill frontend-design (moderní, přívětivý vzhled, ne šablona).
- Zustand: settingsStore, connectionsStore, chatStore (aktivní chat, streamovaná zpráva, memory joby), charactersStore, personasStore, lorebooksStore. Perzistence vždy přes repozitáře do SQLite (žádný localStorage pro data).
- i18n: všechny texty přes `t()` od prvního commitu; namespacy `common`, `chat`, `characters`, `memory`, `settings`.

## 7. Milníky

### M1 — Skeleton

- Scaffold projektu, Tailwind 4, react-router, i18n (cs+en soubory, cs výchozí), dark motiv základ
- tauri-plugin-sql + migrace 001 (celé schéma), `db/database.ts` + repozitáře connections, settings
- Keyring commandy + `SecretStore` trait
- Obrazovka Nastavení → připojení: CRUD presetů, uložení klíče, test spojení (`chat_complete` s „ping")

**Hotovo, když:** `npm run tauri dev` běží; preset na Gemini free tier s uživatelovým klíčem projde testem spojení; klíč není nikde v DB/souborech; přepnutí jazyka funguje.

### M2 — Chat

- Rust: `chat_stream`/`chat_abort`/`chat_complete`, SSE reader, adaptéry Gemini → OpenAI-compatible → Claude (v tomto pořadí, Gemini lze hned testovat)
- TS wrapper `chatStream`, měření času do prvního tokenu
- Načíst skill frontend-design, postavit chat UI: seznam chatů, MessageList, ChatInput, streamovaný render token-by-token, stop, regenerace/swipe, editace, ukládání do `messages`
- Cargo testy parserů SSE (fixture data všech tří providerů)

**Hotovo, když:** reálný chat proti Gemini free tier streamuje slovo po slově (první token ≲ 1 s), historie přežije restart, regenerace vytváří swipe varianty, abort funguje.

### M3 — Postavy

- Rust `png_card.rs` + commandy import/export, cargo testy (roundtrip + reálná karta)
- Mapování V2/V3 → DB, import JSON, export do PNG
- Galerie (hledání, tagy), editor karty, avatary do appdata
- Chat vázaný na postavu: `first_mes` (+ výběr z `alternate_greetings`) jako první zpráva, scénář/karta v system promptu

**Hotovo, když:** reálná komunitní PNG karta ze SillyTavern se importuje se všemi poli, `character_book` se objeví jako lorebook, export → reimport je bezeztrátový.

### M4 — Persony + lorebooky

- CRUD person, výchozí persona, `{{user}}` substituce
- CRUD lorebooků a záznamů, aktivační sken, `lorebook_links` (postava/chat/globál)
- Import/export World Info JSON
- Vitest: aktivace (case sensitivity, always_on, priorita, budget), WI mapování

**Hotovo, když:** záznam s klíčem zmíněným v posledních zprávách se objeví v promptu (viditelné v panelu), import reálného World Info JSON projde.

### M5 — Paměť

- `ledger_facts` + `summaries` repozitáře, ruční CRUD faktů v panelu paměti (včetně zámků)
- Extraktor (prompt, tolerantní parser, merge) + fronta jobů; extrakční preset v nastavení
- Summarizer + posuvné doslovné okno
- PromptBuilder s budgetem a ořezem dle priorit + report do panelu
- Vitest: PromptBuilder (skládání, ořez, placeholdery), merge ledgeru (upsert, locked, remove), odhad tokenů

**Hotovo, když:** v dlouhém chatu (50+ zpráv) ledger obsahuje správná fakta, shrnutí se aktualizuje, prompt drží budget; „drift test": zamknout fakt „hráč je amatérský mág", zkusit AI přesvědčit o polobohu → zamčený fakt zůstává v ledgeru i promptu.

### M6 — Finiš

- Ladění token budgetu (report v panelu, nastavitelný budget per připojení)
- Kompletace EN překladu, light motiv doladit
- Export/záloha dat (zkopírovat SQLite soubor + avatary do ZIP přes dialog; import zpět)
- Chybové stavy: 429/5xx s retry hláškou v UI, offline stav, prázdné stavy obrazovek
- Průchod všech flow, cargo test + vitest zelené

## 8. Ověření (průběžně)

- Po každém milníku `npm run tauri dev` a ruční průchod flow daného milníku (kritéria „Hotovo, když" výše)
- M2: reálný chat proti Gemini free tier (uživatelův klíč) — streaming + ukládání
- M3: reálná komunitní PNG karta — všechna pole
- M5: dlouhý chat 50+ zpráv, drift test se zamčeným faktem
- Jednotkové testy: PNG chunky (Rust), SSE parsery (Rust), PromptBuilder, merge ledgeru, lore aktivace, WI import (vitest)

## 9. Rizika a okraje

- Gemini free tier limity (429): extraktor/summarizer při 429 mlčky ustoupí a zkusí to v dalším intervalu; herní stream zobrazí srozumitelnou hlášku s tlačítkem opakovat
- Nevalidní JSON z extraktoru: tolerantní parser; při selhání se nic nemerguje, jen log
- Exotické karty: některé V3 karty používají `iTXt` místo `tEXt` — čtení podporovat obojí, zápis vždy `tEXt`
- Dlouhé chaty: MessageList načítá zprávy stránkovaně (posledních 100, doscrollování dotáhne starší)
- Přerušený stream: částečnou odpověď uložit s příznakem, nabídnout „pokračovat/regenerovat"

## 10. Budoucnost (mimo tento plán)

Mobil (Tauri 2 Mobile / Capacitor), skupinové chaty, vektorový retrieval vzpomínek, sync přes soubor/cloud, TTS a generování obrázků.
