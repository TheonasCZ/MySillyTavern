# MySillyTavern — roadmapa M11+

Stav k 2026-07-17: hotovo M1–M11 (základ, chat, postavy, persony, lorebooky,
paměť + sémantický retrieval s backfillem, komfort hraní, skupinové chaty
s povýšením NPC, ukotvení pohledu, inline návrhy reakcí, stabilita M11).
Vedle toho přibyla vlna herních featur mimo tuto roadmapu — viz sekce
„Práce mimo roadmapu" níže. Tento dokument plánuje další milníky;
pořadí = doporučená priorita.

> **Pozor na číslování:** commity v git historii označené `M13`–`M24`
> (structured persona, inventář, quest journal, kostky, conditions, frakce,
> kalendář, crafting, kronika…) používají **jinou, paralelní číselnou řadu**
> z agentní session — NEodpovídají milníkům M13–M15 v tomto dokumentu.
> Závazné číslování je to zdejší.

---

## M11 — Stabilita a výkon („mouchy ven") — ✅ HOTOVO

Dokončeno ve třech vlnách (commity `bae2320`, `a80c967`, `2be3d7b`):

1. ✅ **E2E smoke testy** — `scripts/e2e.mjs` + mock IPC harness, `npm run e2e`
2. ✅ **Virtualizace seznamu zpráv** — `src/chat/virtualWindow.ts`
3. ✅ **Sběr chyb do souboru** — `src-tauri/src/commands/logging.rs`,
   log v `$APPDATA/logs/`, panel Diagnostika v Nastavení
4. ✅ **Bug sweep** — race při přepínání chatů opraveny, release build ověřen

---

## M12 — Nástroje vypravěče (kronika, export, statistiky) — ✅ HOTOVO

1. ✅ **Kronika (timeline)** — záložka Kronika v Memory panelu (commit
   `66e4908`): chronologicky scény + fakta, skok na zprávu s donačtením
   starší historie; export kroniky viz „M19" commity `6697a36`, `7ae5650`.
2. ✅ **Export příběhu** — HTML/Markdown export s tématy
   (`src-tauri/src/commands/export_chronicle.rs`, `src/chat/chronicleThemes.ts`).
3. ✅ **Statistiky** — `UsagePanel` v Nastavení, `usageRepo`
   (požadavky + odhad tokenů za den/týden/měsíc), commit `6e75c74`.
4. ✅ **Prompt presety** — hotovo (commit `3551e12`): migrace 18 (tabulka
   `presets` + `chats.preset_id`), `PresetsPanel` v Nastavení, výběr per
   chat v seznamu chatů, extra system prompt + přepis temperature/topP/
   maxTokens. (Pův. plán říkal „migrace 5" — reálně je to migrace 18.)

---

## M13 — TTS předčítání — ✅ HOTOVO (commit `3551e12`)

1. ✅ Web Speech API (`speechSynthesis`) — `src/chat/useTts.ts`
2. ✅ UI: tlačítko ▶/⏹ u bubliny, auto-režim „předčítej nové odpovědi",
   `TtsPanel` v Nastavení (hlas, rychlost); nový stream předčítání zastaví
3. ✅ Hlas per postava — migrace 17 (`characters.tts_voice`), pole v editoru karty
4. ✅ Čistá logika přípravy textu — `src/chat/ttsText.ts` + testy

Zbývá ověřit ručně: dostupnost hlasů ve WebKitGTK na reálném systému
(riziko z původního plánu trvá — panel v tom případě ukáže „žádné hlasy").

---

## M14 — Sync a zálohy 2.0 — bod 1 hotov

1. ✅ **Automatické lokální zálohy** — rotující ZIP do `$APPDATA/backups/`
   při startu (řízeno z frontendu, respektuje nastavení, WAL checkpoint),
   UI v `BackupPanel`: toggle, počet, „zálohovat teď", seznam záloh
   (commity `c2342e7`, `64fb91a`).
2. ⬜ **Sync přes složku** (Syncthing/Nextcloud/Dropbox — bez vlastního
   cloudu): volitelná „sync složka"; žurnál změn (append-only JSONL per
   zařízení + snapshoty). Merge: last-write-wins per entita (zprávy
   append-only → bezkonfliktní; fakta/summary podle updated_at; konflikt =
   zachovat obě verze k ručnímu sloučení v Memory panelu).
3. ⬜ **Konfliktní UI** — banner „nalezeny změny z jiného zařízení" + náhled.
4. API klíče se NIKDY nesyncují (zůstávají v keyringu zařízení).

**Hotovo když:** dvě instalace sdílející složku si vymění nový chat
i pokračování starého bez ztráty dat.
**Riziko:** merge edge-cases — začít žurnálem a zprávami (bezpečné),
fakta/summary až druhá fáze. Největší zbývající milník, dělit na 2 části.

---

## M15 — Mobil (průzkum → port) — fáze A hotová

**Fáze A (průzkum):** ✅ hotová — `docs/m15-android-pruzkum.md` (commit
`72fe166`). Závěr: JÍT; jediná tvrdá blokace je `keyring` crate → nahradit
`android-keyring` implementací `SecretStore` traitu. Odhad fáze B:
8–14 člověko-dnů. Mezitím přibyl Android build v GitHub Actions
(APK + AAB, commity `749e386`–`46f65e9`) — CI build je první krok fáze B.

**Fáze B (port):** ⬜ responzivní úpravy, touch gesta pro swipe variant,
klávesnice vs. input bar, Android back tlačítko, náhrada keyringu,
SAF dialogy pro import/export záloh.

**Hotovo když (B):** APK hratelné: otevřít chat, poslat zprávu, stream,
paměť funguje, klíč bezpečně uložen.

---

## Práce mimo roadmapu (paralelní agentní session, 2026-07)

Vlna featur dodaná agenty (větve `codex/*` + navazující commity s vlastním
číslováním „M13–M24"). Vše je zmergované v masteru:

**Paměť a prompt (A-řada):** multi-fact subject + diferenciální extrakce
(A1+A6), sliding-window chunking + auto-detekce embeddingů (A2+A9), počítání
tokenů tiktokenem + MMR ořez (A3+A4), adaptivní extrakce + importance scoring
(A5+A10), context-aware mluvčí + stemming lorebooků (A7+A8).

**Herní systémy (B-řada + „M-číslované" commity):**

| Commit(y) | Featura |
|---|---|
| `d4c25f5` | herní čas + sledování emocí (B3+B5) |
| `616c8f6` | Ollama auto-detect + kostky `/roll` (B7+B8) |
| `a0d6693` | prompt inspector / debug panel (B10) |
| `1cffffd` | strukturovaná persona, AI inventář a dovednosti, generování obrázků |
| `6e680b9` | fronta auto-ilustrací, progression systém (skill/level/none) |
| `70f6928` | obrázky v Memory panelu (Pollinations) |
| `0220947` | quest journal + UI kostek |
| `c9638ca`, `d149335` | conditions + reputace frakcí (migrace 13+14) |
| `97e3f2c` | kalendář s českými fantasy měsíci a sezónami |
| `7250809` | crafting (skill=kvalita, perky, recepty) |
| `6697a36`, `7ae5650` | export kroniky (Rust + UI, témata) |

**Infra:** Windows CI build (`99e9e3c`), Android CI (APK/AAB), release
`0.1.0-alpha` (`b00fe03`), QoL (klávesové zkratky, hledání v chatu Ctrl+F,
undo/redo, draft autosave, DB query cache, jazykový dropdown).

---

## M25 — Paměť k dokonalosti (kánon, konzistence, režie) — ✅ HOTOVO (`5806886`)

Čísla M16–M24 přeskočena (kolize s historickými commit labely).
Pozn. k bodu 2: korekce je plně automatická — tiše se přilepí k dalšímu
promptu (TTL 3 odeslání), nic nevyskakuje na uživatele; vidět je jen
v Prompt inspectoru.

**Rozsah:**
1. **Kánon editor („ústava světa")** — oddělit zamčená kánon fakta od
   extrahovaných: vlastní záložka v Memory panelu, vizuálně odlišené,
   extraktor se jich nesmí dotknout (zámky už fungují — jde o UX: snadno
   povýšit fakt na kánon, hromadně zamknout, šablony typu „hráč JE
   amatérský mág"). Kánon jde v promptu první a neořezává se nikdy.
2. **Retrospektivní konzistence check (drift detektor)** — levný LLM job
   po N zprávách: porovnej poslední scény proti ledgeru/kánonu → seznam
   rozporů. UI: banner „AI protiřečí faktu X" + tlačítko „vložit korekci"
   (OOC instrukce do dalšího promptu). Log rozporů do kroniky.
3. **Režisérský panel** — tempo / tón / žánr / míra násilí jako volby
   per chat, promítané do system promptu; staví na presetech (M12.4),
   ale je to živé kolečko vedle chatu, ne statický preset.
4. **Vyhodnocení retrievalu na reálné kampani** — časový decay skóre,
   váhy importance × podobnost × stáří; debug pohled „proč byla vybrána
   tato vzpomínka" v Prompt inspectoru.

**Hotovo když:** drift test z PLAN.md §M5 projde i po 200+ zprávách bez
ručního zásahu; detektor chytí uměle vloženy rozpor; kánon přežije extrakci.

**M25.5 — plná automatika (`65d53be`):** paměť už nevyžaduje žádnou ruční
údržbu. Migrace 19: `canon`/`stability`/`contradiction_streak`. Fakta
potvrzená N extrakcemi (3, u world/player 2) se sama povyšují na měkký
kánon; ten se v promptu i drift checku chová jako zamčený, ale extraktor
ho smí opravit po 2 po sobě jdoucích rozporech (s degradací — pojistka
proti zabetonování chyby). Při prvním otevření chatu se z karty postavy
vydestiluje 3–5 pravidel příběhu jako seed kánonu. Uživatel zůstává
admin: odemknout/zrušit/smazat jde vždy, jen s „tytyty" hláškou.

---

## M26 — Pokročilé prompt nástroje (užitečný výběr ze ST)

Jen to, co dává smysl pro API providery (Gemini/Claude/OpenAI-compat/Ollama)
— žádné instruct šablony, CFG ani logit bias.

**Rozsah:**
1. **Plné samplery** — doplnit `top_k`, `min_p`, `frequency_penalty`,
   `presence_penalty` do ConnectionConfig + Rust adaptérů (poslat jen
   providerům, kteří je umí; Ollama umí vše, Gemini topK, OpenAI penalty).
   Presety je už ukládají — `applyPreset` je zatím nepřenáší, dotáhnout.
2. **Author's note / hloubková injekce** — instrukce vkládaná N zpráv
   před konec historie (per chat, editovatelná v Memory panelu); klasika
   ST, výborná na udržení stylu bez přepisování karty.
3. **Regex transformace výstupu** — uživatelská pravidla find→replace
   aplikovaná na odpovědi (odstranit oblíbené fráze modelu, opravit
   formát kurzívy…); per chat i globálně, s náhledem.

**Hotovo když:** preset s min_p projde do Ollamy, author's note viditelně
drží styl, regex pravidlo umlčí zvolenou frázi.

---

## M27 — World Info navíc (aktivace jako ST, ale chytřejší)

**Rozsah:**
1. **Rekurzivní aktivace** — aktivovaný záznam může klíči aktivovat další
   (limit hloubky, ochrana proti cyklu).
2. **Selektivní logika** — sekundární klíče s AND/NOT (záznam se aktivuje
   jen když „drak" A ZÁROVEŇ ne „sen").
3. **Timed effects** — sticky (drží N zpráv po aktivaci), cooldown,
   delay; stav per chat.
4. **Vektorová aktivace** — lore záznamy bez klíčového zásahu se mohou
   aktivovat sémantickou podobností přes existující embedding engine
   (náš trumf — ST na tohle potřebuje extension). Práh + budget v
   nastavení, viditelné v Prompt inspectoru.

**Hotovo když:** import ST World Info se selective/sticky poli zachová
chování; vektorově aktivovaný záznam se ukáže v reportu s důvodem.

---

## M28 — Jazyk hry per chat (globalizace promptů)

**Motivace:** LLM prompty jsou dnes hardcodované české string konstanty
rozstrkané po modulech. Čeština v instrukcích stojí tokeny navíc a anglické
komunitní karty dostávají české obálky. Zároveň NEJDE jen přepsat vše do
angličtiny — jazyk promptu táhne jazyk výstupu (vyprávění, extrahovaná fakta
v Memory panelu musí zůstat v jazyce hry).

**Rozsah:**
1. **Centralizace prompt textů** — nový modul `src/prompt/promptTexts.ts`
   (nebo `promptTexts/cs.ts` + `en.ts`): všechny LLM string konstanty na
   jedno místo. Dnes žijí v: `promptBuilder.ts` (DEFAULT_RP_INSTRUCTIONS,
   hlavičky sekcí [KÁNON PŘÍBĚHU]/[FAKTA SVĚTA]/[REŽIE SCÉNY]/[TICHÁ
   KOREKCE]/herní tagy/crafting/frakce), `extractor.ts`
   (EXTRACTION_SYSTEM_PROMPT), `driftDetector.ts` (DRIFT_CHECK_SYSTEM_PROMPT),
   `canonSeed.ts` (SEED_SYSTEM_PROMPT), `summarizer.ts`, `chatStore.ts`
   (instrukce „Pokračuj…", návrhy odpovědí), `director.ts` (PACE/TONE/FOCUS
   noty), `groupSpeaker`/`npcPromotion`/`inlineSuggestions`.
2. **Jazyk hry per chat** — sloupec `chats.game_language` ('cs'|'en',
   migrace 20), výběr při založení chatu (default = jazyk UI); všechna místa
   z bodu 1 berou texty podle jazyka chatu, ne globálně.
3. **Analytické joby anglicky vždy** — extraktor, drift check, seed a
   summarizer vracejí JSON/interní text: instrukce přepsat do angličtiny
   (přesnější, levnější) + explicitní direktiva „obsah polí (fact,
   contradiction, summary) piš v jazyce hry: {lang}". Pozor: stávající české
   kampaně mají česká fakta — direktiva podle jazyka chatu to drží.
4. **UI dočištění** — vymést hardcodované fallbacky (`?? "Obnovit…"`
   v SettingsScreen apod.) a české chybové hlášky v Rustu (backup.rs
   „Databáze zatím neexistuje…") → přes i18n / anglicky s překladem na FE.

**Hotovo když:** anglická karta + chat s game_language='en' hraje čistou
angličtinou (vyprávění, fakta, kronika); česká kampaň se chová beze změny;
žádný český string mimo `promptTexts` a `i18n/`.
**Riziko:** změna znění promptů = změna chování extrakce/driftu — po
přepnutí analytických jobů na EN instrukce přejet testy a ručně ověřit
extrakci na české kampani (fakta musí zůstat česky).

---

## Průběžně (mimo milníky)

- **Ladění paměti** — po delším hraní uživatele vyhodnotit: drží žánr?
  Vytahují se správné vzpomínky? (viz memory poznámka: nejdřív zkontrolovat,
  zda si zvedl context budget a zamkl kánon fakta.) MMR diverzifikace a
  importance scoring už jsou v kódu (A-řada) — ladit parametry.
- **Skupiny v praxi** — auto-režim výběru mluvčího doladit podle reálného
  používání (např. váha „byl osloven přímo" vs. round-robin).
- **Mouchy z hraní** — jakmile je uživatel popíše (nebo je chytí log z M11),
  řešit přednostně před dalším milníkem.
- **Dokumentační hygiena** — u nových milníků držet číslování z tohoto
  souboru; commity značit `M<n>` jen podle této roadmapy.

## Doporučené pořadí a velikost (zbývající práce)

| Milník | Velikost | Poznámka |
|--------|----------|----------|
| M26 prompt nástroje | malý–střední | samplery + author's note + regex |
| M27 World Info navíc | střední | vektorová aktivace = náš trumf |
| M28 jazyk hry | střední | centralizace promptů, EN analytické joby |
| M14 sync (body 2–3) | velký | začít žurnálem a zprávami |
| M15 mobil fáze B | velký | po M14; 8–14 dnů dle průzkumu |

Vědomě vynecháno (nedohánět ST): extensions ekosystém, desítky API
providerů, STscript, instruct šablony, CFG/logit bias, Live2D/VRM avatary.
