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
2. ✅ **Sync přes složku** (Syncthing/Nextcloud/Dropbox — bez vlastního
   cloudu): volitelná „sync složka"; žurnál změn (append-only JSONL per
   zařízení + snapshoty). Merge: last-write-wins per entita (zprávy
   append-only → bezkonfliktní; fakta/summary podle updated_at; konflikt =
   zachovat obě verze k ručnímu sloučení v Memory panelu).
3. ⬜ **Konfliktní UI** — banner „nalezeny změny z jiného zařízení" + náhled. (odloženo — základní sync funguje, konflikty se řeší last-write-wins)
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

**Fáze B (port):** ✅ hotovo — změny:
1. ✅ **Keyring** — nebyl blokátor, `secrets.rs` už používal `FileStore` (JSON soubor)
2. ✅ **Desktop pluginy za feature flagem** — `desktop-plugins` v Cargo.toml,
   `tauri-plugin-dialog` a `tauri-plugin-process` volitelné; Rust builder s `#[cfg]`
3. ✅ **`src/platform.ts`** — bezpečné wrappery pro dialog/process/opener,
   catch import failures na Androidu, `openDialog()`/`saveDialog()` vracejí `string | null`
4. ✅ **Touch swipe gesta** — `MessageBubble.tsx`: swipe left/right pro varianty
   (50px threshold), `touch-action: pan-y` v CSS
5. ✅ **Klávesnice viewport** — `ChatInput.tsx`: `visualViewport` resize listener,
   paddingBottom offset
6. ✅ **Android back button** — `src/ui/useAndroidBack.ts`: poslouchá `tauri://back`
   + `popstate`, zavírá panely (export → memory → inventory → questy → director →
   group → navigate back)
7. ✅ **9× import nahrazen** — `backup.ts`, `cardImport.ts`, `cardExport.ts`,
   `campaignExport.ts`, `personaExport.ts`, `worldInfoFile.ts`, `PersonaForm.tsx`,
   `SyncPanel.tsx`, `DiagnosticsPanel.tsx` používají `platform.ts` wrappery

**Dokončení (2026-07-17):**
- ✅ Feature flag `desktop-plugins` nahrazen target-podmíněnými závislostmi
  (`[target.'cfg(not(target_os = "android"))'.dependencies]`) — Android build
  už nepotřebuje `--no-default-features` ani žádný jiný speciální flag
- ✅ Workflow `build-android.yml` opraven: chybějící `id: setup-android`
  (env `NDK_HOME` se předtím nenastavoval), patch `AndroidManifest.xml`
  (`windowSoftInputMode="adjustResize"`) po `tauri android init`,
  přidán debug APK build (release APK je nepodepsaný → nejde nainstalovat;
  debug APK je podepsaný debug klíčem a hratelný)
- ⬜ Volitelně: lokální Android SDK pro build mimo CI; podepisování release
  APK vlastním keystorem (secrets v GitHubu)

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

## M26 — Pokročilé prompt nástroje ✅ HOTOVO

Jen to, co dává smysl pro API providery (Gemini/Claude/OpenAI-compat/Ollama)
— žádné instruct šablony, CFG ani logit bias.

**Rozsah:**
1. **Plné samplery** — doplnit `top_k`, `min_p`, `frequency_penalty`,
   `presence_penalty` do `ConnectionConfig` + Rust adaptérů (poslat jen
   providerům, kteří je umí; nepodporovaný parametr tiše přeskočit, ne failnout).
   `applyPreset` už presety ukládá, jen parametry nepřenáší — dotáhnout.
2. **Author's note / hloubková injekce** — instrukce vkládaná jako
   samostatná systémová zpráva těsně před poslední user message (N=0,
   uživatelsky nastavitelné); editovatelná v Memory panelu per chat.
   Klasika ST, výborná na udržení stylu bez přepisování karty.
3. **Regex transformace výstupu** — uživatelská pravidla find→replace
   aplikovaná na odpovědi před zobrazením (odstranit oblíbené fráze modelu,
   opravit formát kurzívy…); per chat i globálně. UI musí obsahovat
   **testovací pole** — „vlož ukázkovou odpověď" a náhled, co regex udělá.

**Hotovo když:** preset s min_p projde do Ollamy, author's note viditelně
drží styl, regex pravidlo umlčí zvolenou frázi.

---

## M27 — World Info navíc (aktivace jako ST, ale chytřejší) ✅ HOTOVO

**Rozsah:**
1. **Rekurzivní aktivace** — aktivovaný záznam může klíči aktivovat další
   (limit hloubky, ochrana proti cyklu).
2. **Selektivní logika** — sekundární klíče s AND/NOT (záznam se aktivuje
   jen když „drak" A ZÁROVEŇ ne „sen").
3. **Vektorová aktivace** — lore záznamy bez klíčového zásahu se mohou
   aktivovat sémantickou podobností přes existující embedding engine
   (náš trumf — ST na tohle potřebuje extension). Práh + budget v
   nastavení, viditelné v Prompt inspectoru.
4. **Timed effects** — sticky (drží N zpráv po aktivaci), cooldown,
   delay; stav per chat.

**Hotovo když:** import ST World Info se selective/sticky poli zachová
chování; vektorově aktivovaný záznam se ukáže v reportu s důvodem.

---

## M27.5 — Auto-plnění lorebooku ✂️ ZRUŠENO

Navazuje na ducha M25.5 — žádná ruční povinnost. **POZOR: riziko halucinací
a nárůstu API požadavků.**

**Rozsah:**
1. **Destilace lore záznamů ze summarizeru** — při každém běhu summarizeru
   se ze skládaných scén na pozadí destilují TRVALÉ znalosti světa (místa,
   artefakty, legendy, zvyky — NE dějové události, ty patří kronice/ledgeru)
   do kampaňového lorebooku s klíčovými slovy + embeddingy; dedup proti
   existujícím záznamům (sémantická podobnost).
2. **Karanténa** — vygenerované záznamy jdou do stavu „pending"; uživatel
   je v lorebook editoru schválí/zahodí (prevence zanesení halucinací).
   Uživatel-admin: záznamy jde editovat/mazat, karanténu lze vypnout.
3. **Úsporný režim** — destilační LLM call používat laciný model (Gemini
   Flash / Claude Haiku / lokální Ollama); uživatel může auto-plnění
   vypnout úplně.
4. Tlačítko „Přegenerovat z celé kampaně" jako ruční doplněk.

**Hotovo když:** generátor vyrobí použitelný lorebook z kampaně bez
halucinací; schvalovací karanténa funguje; náklady na API jsou řádově
nižší než hlavní chat.

---

## M28 — Jazyk hry per chat (globalizace promptů) — fáze A ✅, fáze B ⬜

**Motivace:** LLM prompty jsou dnes hardcodované české string konstanty
rozstrkané po modulech. Čeština v instrukcích stojí tokeny navíc a anglické
komunitní karty dostávají české obálky. Zároveň NEJDE jen přepsat vše do
angličtiny — jazyk promptu táhne jazyk výstupu (vyprávění, extrahovaná fakta
v Memory panelu musí zůstat v jazyce hry).

### Fáze A („teď" — střední)

1. **Centralizace prompt textů** — nový modul `src/prompt/promptTexts.ts`:
   JEDNA univerzální anglická sada promptů (žádné soubory per jazyk!) +
   parametr `{lang}`; jazyk výstupu vynucuje direktiva „Always respond /
   write content in {lang}" vložená DVAKRÁT — do system promptu a na konec
   kontextu (post-history, kde váží nejvíc). Hlavičky sekcí anglicky
   ([STORY CANON], [WORLD FACTS], [SCENE DIRECTION]…). Few-shot příklad GM
   označit „example shown in English; you always write in {lang}" — jediné
   místo, kde případně dává smysl per-jazyk override, pokud by styl trpěl.
   Dnes konstanty žijí v: `promptBuilder.ts` (DEFAULT_RP_INSTRUCTIONS,
   hlavičky sekcí [KÁNON PŘÍBĚHU]/[FAKTA SVĚTA]/[REŽIE SCÉNY]/[TICHÁ
   KOREKCE]/herní tagy/crafting/frakce), `extractor.ts`
   (EXTRACTION_SYSTEM_PROMPT), `driftDetector.ts` (DRIFT_CHECK_SYSTEM_PROMPT),
   `canonSeed.ts` (SEED_SYSTEM_PROMPT), `summarizer.ts`, `chatStore.ts`
   (instrukce „Pokračuj…", návrhy odpovědí), `director.ts` (PACE/TONE/FOCUS
   noty), `groupSpeaker`/`npcPromotion`/`inlineSuggestions`.
2. **Jazyk hry per chat** — sloupec `chats.game_language` (libovolný kód,
   migrace 20), výběr při založení chatu (default = jazyk UI); dosadí se do
   `{lang}` direktiv z bodu 1 — tím funguje kterýkoli jazyk světa.
3. **Analytické joby** — extraktor, drift check, seed a summarizer:
   stejný princip, anglické instrukce + „write field contents (fact,
   contradiction, summary) in {lang}". Stávající české kampaně mají česká
   fakta — direktiva podle jazyka chatu to drží.
4. **UI dočištění** — vymést hardcodované fallbacky (`?? "Obnovit…"`
   v SettingsScreen apod.) a české chybové hlášky v Rustu (backup.rs
   „Databáze zatím neexistuje…") → přes i18n / anglicky s překladem na FE.
5. **Podtitulky v sidebaru** — zachovat ST-kompatibilní názvy (Characters /
   Personas), ale přidat vysvětlující podtitulky menším písmem:
   - **Characters / Postavy** → *"AI-run characters — narrators, companions"*
     / *"Postavy ovládané AI — vypravěči, společníci"*
   - **Personas / Persony** → *"Your character — who you are in the story"*
     / *"Tvoje postava — kým jsi ve hře ty"*
6. **Jazyková nápověda v editorech** — u polí karty postavy a persony
   drobný hint (FieldHelp), co psát raději anglicky vs. v jazyce hry:
   ANGLICKY pole čtená AI jako instrukce (system prompt, post-history
   instructions, description/personality) — přesnější a levnější;
   V JAZYCE HRY pole prosakující do vyprávění a určující styl (first
   message, ukázka dialogu mes_example, scénář, jména). U importované
   anglické karty hint „hraješ-li česky, zvaž překlad first message /
   ukázky dialogu — táhnou jazyk a styl výstupu".
   Barevně/ikonou odlišit pole „instrukce pro AI (doporučeně anglicky)"
   vs. „tvůj příběh (tvým jazykem)".

**Hotovo když:** anglická karta + chat s game_language='en' hraje čistou
angličtinou (vyprávění, fakta, kronika); česká kampaň se chová beze změny;
žádný český string mimo `i18n/`; prompty jsou jen anglické s {lang}.
**Riziko:** změna znění promptů = změna chování extrakce/driftu — po
přepnutí analytických jobů na EN instrukce přejet testy a ručně ověřit
extrakci na české kampani (fakta musí zůstat česky).

### Fáze B — anglický pivot pro paměťové artefakty (ODLOŽENO)

> **Nerealizovat dokud fáze A není v provozu a nejsou data z reálných
> vícejazyčných kampaní.** Riziko: překladová vrstva (CS↔EN) by přidala
> LLM volání na každé uložení/načtení faktu, zdvojnásobila náklady na
> analytické joby. Vyhodnotit přínos (přesnější embeddingy?) až po
> zkušenostech z fáze A.

Stručně: fakta/shrnutí/drift nálezy ukládat interně anglicky a překládat
LLM voláním pro zobrazení v Memory panelu. VÝSLOVNĚ NE pro samotné
vyprávění — překladová vrstva by zabila streaming. Vyprávění vždy přímo
v jazyce hry přes `{lang}` direktivu.

---

## M29 — UI ✂️ ZRUŠENO JAKO SAMOSTATNÝ MILNÍK

Původní rozsah M29 (přejmenování, jednoduchý/pokročilý režim, jazykové
zóny, seskupení panelů) je rozpuštěn do ostatních milníků:

- **Podtitulky v sidebaru** (Characters/Personas) → součást M28 bod 5
- **Jazykové zóny v editorech** (barevné/ikonové odlišení) → součást M28 bod 6
- **FieldHelp ke každému poli** → Definition of Done pro všechny nové featur
- **Jednoduchý/Pokročilý režim** → průběžná UI údržba; každý nový panel
  defaultně ukazuje jen základní pole, zbytek za „Pokročilé"
- **Seskupení panelů v Nastavení** → jednorázová změna mimo milníky

---

## M30 — Export/import 2.0 (ST-kompatibilní + naše data) ✅ HOTOVO

**Motivace:** zůstat čitelní pro originální SillyTavern, ale bezeztrátově
přenášet i naše rozšíření.

**Rozsah:**
1. **Namespace blok** `extensions.mysillytavern` v kartě V2/V3 (JSON i PNG
   tEXt chunk) — spec s tím počítá, ST ho ignoruje, my čteme: TTS hlas,
   výchozí režie, doporučený preset. **Do karty dávat jen metadata, ne**
   celý lorebook (některé ST implementace selžou nad velkými tEXt chunky).
2. **Export chatu/kampaně** — vlastní ZIP formát (chat + ledger vč.
   canon/stability + summary + questy + inventář + kalendář + lorebooky
   + kronika) s manifestem verze (pro budoucí migrace). **Selektivní export:**
   „jen chat", „chat + paměť", „vše".
3. **World Info export** — zachovat ST pole 1:1 (vč. selective/sticky z
   M27), naše navíc (embeddingy ne — dopočítají se) do `extensions`.
4. **Roundtrip testy v CI** — naše→ST→naše bez ztráty ST polí; naše→naše
   bez ztráty čehokoli. Smoke test s reálným ST (import projde bez chyby).

**Hotovo když:** karta exportovaná u nás jde importovat do originálního ST
beze změny chování; reimport k nám vrátí i všechna naše data; roundtrip
testy prochází v CI.

---

## M31 — TTS backendy (fallback řetězec) — fáze A ✅, fáze B ⬜

**Motivace:** Web Speech API na Linuxu = espeak (robotický), na Androidu
nefunguje vůbec. Chceme offline neuronové hlasy pro češtinu. Původní plán
na Piper TTS padá: (1) `rhasspy/piper` archivován v říjnu 2025, (2) eSpeak-ng
neobsahuje české fonémy (ř, ť, ď, ň, ě…), výslovnost je nekonzistentní,
(3) existují lepší alternativy — Edge-TTS (online, zdarma, výborná čeština)
a Sherpa-ONNX / Chatterbox (offline, k průzkumu).

### Architektura — fallback řetězec

```
1. Edge-TTS (online, zdarma, neuronové hlasy, ~300 ms)
   ↓ fallback při offline / chybě
2. Offline backend (Sherpa-ONNX / Piper — podle průzkumu ve fázi B)
   ↓ fallback
3. Web Speech API (už máme — funguje jako poslední záchrana)
   ↓
4. Ticho + notifikace „TTS nedostupné"
```

### Fáze A — Edge-TTS (malý)

**Edge-TTS fakta:** Microsoft provozuje TTS API pro Edge browser (Read Aloud).
Zdarma, bez API klíče, používá se přes WebSocket. České neuronové hlasy:
`cs-CZ-VlastaNeural` (žena) a `cs-CZ-AntoninNeural` (muž) — kvalita 8/10,
latence první slabiky pod 500 ms, podporuje streaming. SSML umožňuje
modulaci pitch (±Hz), rate (±%), volume (±%). Limit: jen jeden `<voice>` +
jeden `<prosody>` tag, ale pro čtení dialogů to stačí. Riziko: neoficiální
API — Microsoft může změnit/zablokovat (naposledy omezili custom SSML 2023,
základní TTS funguje stabilně).

**Rozsah:**
1. **Druhý backend v `useTts`** — rozšířit `speak()` o backend selektor;
   fallback logika: zkus Edge-TTS → Web Speech.
2. **Integrace `msedge-tts`** — npm balíček (TypeScript, funguje v browseru
   přes WebSocket, žádný Python, žádný Rust). Syntéza streamuje audio do
   `<audio>` elementu — první slovo slyšet během desítek ms.
3. **Voice profily per postava** — nová tabulka `tts_voice_profiles`
   (migrace 21): jméno profilu, voice ID, pitch, rate, volume. Presety:
   „Temný vypravěč" (Antonin, pitch -15Hz, rate -10%), „Elf" (Vlasta,
   pitch +20Hz), „Stařec" (Antonin, pitch -25Hz, rate -15%)…
   `characters.tts_voice` odkazuje na profil (zpětně kompatibilní —
   fallback na holé voice ID). Náhled „přehrát ukázku".
4. **UI** — `TtsPanel` ukáže aktuální backend („online — Microsoft neural"
   / „offline — Web Speech fallback"); voice picker s profily + testovacím
   tlačítkem.

**Hotovo když:** česká odpověď se přehraje Edge-TTS do 500 ms od kliknutí,
hlasy per postava včetně modulace (pitch/rate), offline fallback na Web
Speech funguje.

### Fáze B — Offline backend (malý–střední, PO PRŮZKUMU)

> **Nerealizovat před fází A.** Nejdřív vyhodnotit Edge-TTS v provozu
> (stabilita, limity). Pak prozkoumat offline alternativy.

1. **Průzkum Sherpa-ONNX + VITS** — Sherpa-ONNX má C API, jde bundlovat
   jako nativní knihovnu (žádný Python). Pokud existuje český VITS model
   s dobrou kvalitou → preferovaný offline backend.
2. **Alternativně Piper** — pokud Sherpa-ONNX nevyjde, Piper jako offline
   fallback s explicitním varováním o kvalitě české výslovnosti (chybějící
   fonémy).
3. **Android** (váže na M15 B) — oba offline backendy musí fungovat na
   aarch64; Edge-TTS funguje všude kde je internet.

---

## M32 — Distribuce a aktualizace (z projektu produkt)

**Stav (2026-07-17):** Wayland workaround zapečen do `main.rs` (Linux:
`GDK_BACKEND=x11` + `WEBKIT_DISABLE_DMABUF_RENDERER=1`, jen pokud nejsou
nastavené). Lokálně „nainstalováno": release binárka v `~/.local/bin/
mysillytavern` + ikona v menu (`~/.local/share/applications/
mysillytavern.desktop`), vedle toho dev ikona „MySillyTavern (dev)"
spouštějící `spustit.sh` (kompiluje aktuální repo).

⚠️ **Nainstalovaná binárka je zmrazená k datu buildu** — po každé vlně
změn je potřeba ji přebuildit (`npm run tauri build`) a překopírovat,
jinak uživatel hraje na staré verzi. Tohle je hlavní motivace pro
auto-update níže.

**Cíl:** stáhnu → nainstaluju → mám ikonu → hraju; aktualizace řeší apka
sama („je nová verze" notifikace + tlačítko aktualizovat).

1. ✅ **GitHub Releases CI** — `release.yml`: na tag `v*` staví
   `tauri-action` Linux (deb/rpm/AppImage) + Windows (MSI/NSIS),
   vytvoří Release a podepsaný `latest.json` pro updater.
2. ✅ **In-app updater** — `tauri-plugin-updater` (desktop-only přes
   target deps), pubkey + endpoint v `tauri.conf.json`,
   `createUpdaterArtifacts`, capability `desktop.json` (Android má
   vlastní `default.json` bez desktop pluginů). UI: `UpdateBanner.tsx`
   — check při startu, toast „Nová verze X – Aktualizovat", stažení
   + ověření podpisu + restart. Na Linuxu updater aktualizuje jen
   AppImage → distribuce = AppImage.
3. ✅ **Verzování** — verze zobrazená v Nastavení → Diagnostika
   (`getVersion()`); při release zvednout `version` v
   `tauri.conf.json` + `package.json` a tagnout `v<verze>`.

**Stav 2026-07-18 v noci:**
- ✅ Secret `TAURI_SIGNING_PRIVATE_KEY` nahrán (soukromý klíč je
  POUZE v `~/.tauri/mysillytavern.key` — NEZTRATIT, bez něj nejdou
  podepsat další updaty; heslo prázdné)
- ✅ GitHub token rozšířen (Actions + Secrets read/write) — CI běhy
  lze sledovat a mazat přes `gh`
- ✅ Verze 0.1.0 (MSI nesnese `-alpha` — pre-release identifikátor
  musí být číselný), tag `v0.1.0` pushnut → Release CI běží
- ✅ `build-windows.yml` jen `workflow_dispatch` (distribuce =
  release.yml); `build-android.yml` zůstává na push jako jediná
  průběžná kontrola Androidu
- ✅ Release v0.1.0 VYDÁN — AppImage/deb/rpm + Windows NSIS/MSI,
  vše podepsané, latest.json funguje
- ✅ Lokální instalace přepnuta na `~/Applications/MySillyTavern.AppImage`
  (menu ikona na něj ukazuje; stará binárka z ~/.local/bin odstraněna)
  → samoaktualizace od další verze funguje
- ✅ CI: Rust cache (Swatinem/rust-cache) ve všech workflow; Android
  build omezen na aarch64+armv7 (x86 emulátorové buildy zaplnily disk
  runneru — „No space left on device"); debug APK jen aarch64
- ✅ UX: lidské hlášky chyb providerů (humanizeError.ts) — rate limit
  s odpočtem, špatný klíč, přetížení, neznámý model
- ✅ Paměť: gemini-embedding-001 → gemini-embedding-2 (768 dims
  ověřeno přes API); bez migrace — herní data smazána na přání
  uživatele (nový start kampaně), postavy/persony/připojení zachovány,
  záloha DB v ~/Dokumenty/mysillytavern-pred-wipe-2026-07-18.db
- ⬜ Výhledově: Android do release.yml (podepsané APK přes keystore
  v secrets); Gemma fallback pro system prompt (Gemma nepodporuje
  system_instruction — nutný prefix do první zprávy)

**Repo zveřejněno (2026-07-18 v noci):** in-app updater potřeboval
veřejné URL k Release assetům (`releases/latest/download/...`) —
private repo je vracelo neautentizovaným požadavkům jako 404, takže
apka aktualizaci nikdy nenašla. Ověřeno před přepnutím: žádné API
klíče/secrety v historii (jen v `secrets.json` mimo repo, negitované).

## M33 — Přizpůsobit repo veřejnému světu (housekeeping)

Repo je teď public — chybí mu základní věci, co veřejný repozitář má mít:

- ⬜ **LICENSE** — zatím žádná; rozhodnout jakou (MIT/GPL/proprietární
  "source-available"?) a přidat soubor
- ⬜ **README.md aktualizovat** — pořád radí ručně nastavovat
  `GDK_BACKEND=x11 WEBKIT_DISABLE_DMABUF_RENDERER=1` (workaround je
  už zapečený v `main.rs`, viz M15), chybí přímý odkaz na stažení
  hotové aplikace z Releases (ne každý bude chtít buildit ze zdrojáku)
- ⬜ **`.codewhale/state/subagent-transcripts/*.jsonl`** — commitované
  transkripty agentních session v repu; zvážit `.gitignore` (jsou to
  provozní artefakty ladění, ne zdrojový kód — i když v nich zatím nic
  citlivého nebylo, netřeba je táhnout ve veřejné historii)
- ⬜ **CI status badge** v README (build-android/release passing/failing)
- ⬜ **CONTRIBUTING.md** — jen pokud/až bude chtít uživatel přijímat
  externí přispěvatele; zatím není jasné, jestli to je záměr projektu
- ⬜ Zkontrolovat `package.json`/`Cargo.toml` metadata (author, repository
  URL, description) — teď je vidí kdokoli

**Hotovo když:** nový návštěvník repa na GitHubu za minutu pochopí co
projekt je, jak si stáhnout hotovou apku (bez buildění), a jakou má
licenci.

---

## Průběžně (mimo milníky)

- **UI kvalita jako DoD** — každý nový feature musí přijít s FieldHelp
  u všech nových polí; složitější nastavení za rozbalovacím „Pokročilé".
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
- **Nápad (2026-07-18): stárnutí postavy s herním kalendářem** — persona
  má věk, chat má kalendář (dny/roky), ale nejsou propojené. Při postupu
  herního času by věk mohl reálně stárnout (přepočet z data narození +
  aktuálního herního data), volitelně s dopadem na staty po určitém věku,
  a s hákem pro nesmrtelnost/prodloužení života (flag co přepočet zastaví
  nebo zpomalí). Věk i staty jsou teď (po M-inventář/M-skilly migraci)
  chat-scoped, takže tohle na ně může navázat přirozeně. Nezačínat dokud
  neběží M-skilly agent v inventoryProcessor.ts/chatStore.ts (kolize).
- **Nápad (2026-07-18): vizuální herní datum/čas v UI** — kalendář
  (`calendarDate` v ChatScreen) se dnes ukazuje jen jako textový popisek
  (`formatCalendarDateShort`, `SEASON_EFFECTS`). Chtělo by to výraznější
  vizuál: ikona podle sezóny (jaro/léto/podzim/zima), ikona podle denní
  doby (svítání/den/soumrak/noc — [TIME:+1d] zatím dny neposouvá po
  hodinách, jen kalendářně, viz M32 poznámka o [TIME:14:00] bez hodin
  v kalendáři — tohle by dalo smysl řešit spolu s hodinovou granularitou).
  Umístění: pravděpodobně hlavička chatu vedle ostatních ikon panelů.
- **Nápad (2026-07-18): panel "Postava" — přehled stavu vedle Inventáře
  a Questů** — nová ikona v hlavičce chatu (mozek pro paměť, batoh pro
  inventář, svitek pro questy — sem by patřila postava/štít). Obsah:
  věk, HP/zranění, buffy a debuffy (kondice — `[COND:...]` tag už
  existuje a je od dneška chat-scoped, takže data jsou po ruce), tělesné
  modifikace (protézy, mutace, runové implantáty — herní svět to má),
  a hlavně **seznam dovedností** s úrovněmi — hráč se potřebuje kdykoli
  rychle podívat "co vlastně umím a v jakém jsem stavu", ne to hledat
  zpětně v historii chatu. Datově navazuje přímo na dnešní migraci
  skills/xp/level/conditions na chat — ty samé zdroje dat (`chat.skills`,
  `chat.conditions`, `chat.xp`/`chat.level`), jen chybí UI panel a tag
  pro tělesné modifikace (nejspíš nový `[MOD:+popis]` v duchu `[COND:...]`).

## Doporučené pořadí a velikost (zbývající práce)

| Milník | Velikost | Poznámka |
|--------|----------|----------|
| M26 prompt nástroje | ✅ HOTOVO | samplery, author's note, regex transform |
| M31 TTS fáze A | ✅ HOTOVO | Edge-TTS + Web Speech fallback, voice profily |
| M28 jazyk hry fáze A | ✅ HOTOVO | promptTexts.ts, game_language, EN prompty + {lang} |
| M27 World Info navíc | ✅ HOTOVO | rekurzivní, AND/NOT, timed, vektorová aktivace |
| M30 export/import 2.0 | ✅ HOTOVO | extensions.mysillytavern, campaign ZIP |
| M27.5 auto-plnění lorebooku | ✂️ ZRUŠENO | tlačítko "Uložit jako lore" u faktů |
| M14 sync | ✅ HOTOVO | JSONL žurnál, SyncPanel, 9× repo |
| M15 mobil | ✅ HOTOVO | platform.ts, feature flags, touch swipe, useAndroidBack |
| M31 TTS fáze B | ⬜ odloženo | offline backend — až po průzkumu |
| M28 fáze B | ⬜ odloženo | EN pivot pro paměť |
| M14 konfliktní UI | ⬜ odloženo | banner pro ruční merge konfliktů |
| M32 distribuce+update | ✅ HOTOVO | repo public, updater ověřen v0.1.2→v0.1.3 |
| M33 repo housekeeping | ⬜ NOVÝ | LICENSE, README, .codewhale gitignore, CI badge |

Vědomě vynecháno (nedohánět ST): extensions ekosystém, desítky API
providerů, STscript, instruct šablony, CFG/logit bias, Live2D/VRM avatary.
