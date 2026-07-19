# MySillyTavern — roadmapa

Stav k 2026-07-18. Hotovo M1–M15, M25–M32. Zbývá: M33 housekeeping + odložené featury.

---

## ✅ Hotové milníky (zkráceně)

- **M11** — Stabilita (E2E testy, virtualizace, logování) ✅
- **M12** — Kronika, export, statistiky, prompt presety ✅
- **M13** — TTS Web Speech ✅
- **M14** — Zálohy + sync přes složku (JSONL žurnál, SyncPanel, 9× repo) ✅; konfliktní UI ⬜ odloženo
- **M15** — Mobil (průzkum, platform.ts, feature flags, touch swipe, useAndroidBack, burger menu) ✅
- **M25** — Kánon, drift detektor, režie ✅
- **M25.5** — Plná automatika paměti ✅
- **M26** — Samplery (topK/minP/freq/pres), author's note, regex transform, sampler toast ✅
- **M27** — World Info: rekurzivní, AND/NOT, timed, vektorová aktivace ✅
- **M27.5** — ✂️ Zrušeno (nahrazeno tlačítkem "Uložit jako lore")
- **M28** — Jazyk hry (promptTexts.ts, game_language, EN prompty + {lang}) ✅; fáze B (EN pivot) ⬜ odloženo
- **M29** — ✂️ Zrušeno (rozpuštěno do ostatních milníků)
- **M30** — Export/import 2.0 (extensions.mysillytavern, campaign ZIP) ✅
- **M31** — TTS: Edge-TTS + Web Speech, voice profily ✅; fáze B (offline) ⬜ odloženo
- **M32** — Distribuce a update (repo public, updater ověřen) ✅

## ⬜ Zbývající práce

| Položka | Stav |
|---|---|
| **M33 — Repo housekeeping** | ⬜ LICENSE, README aktualizace, `.codewhale/` do `.gitignore`, CI badge, metadata |
| **M14 konfliktní UI** | ⬜ odloženo — banner pro ruční merge konfliktů |
| **M28 fáze B — EN pivot paměti** | ⬜ odloženo — teď zahrnuje i `memory/calendar.ts` (`calendarDescription`, `SEASON_EFFECTS`) a `memory/gameTime.ts` (`weatherDescription`, `timeOfDay`, `Season`/`Weather` labely): veškerý text natvrdo česky, žádný `{lang}` parametr jako zbytek promptu. Při `gameLanguage: "en"` se do jinak anglického promptu vmíchá český blok o datu/počasí. Zjištěno 2026-07-18 při zapojování `gameTime.ts`. |
| **M31 fáze B — Offline TTS** | ⬜ odloženo (průzkum Sherpa-ONNX) |
| **Android release podepisování** | ⬜ výhledově |
| **Gemma fallback** (system prompt do user msg) | ⬜ výhledově |
| **M34 — Lokální AI, duálně přepínatelná (fáze A: desktop)** | ⬜ zadáno 2026-07-19, nezačato |
| **M34 fáze B — Mobil** | ⬜ podmíněno úspěchem fáze A |

---

## QoL + Refactoring (2026-07-18, DeepSeek)

- ✅ **Sidebar** — burger mobil, sbalitelný desktop, auto-collapse, Ctrl+B, žádný divider
- ✅ **Settings tabs** — 7 záložek (Připojení, Hra, Zvuk, Sync, Vzhled, Data, Zkratky), responzivní burger
- ✅ **Refactoring** — chatStore (1223→659 ř., 6 modulů), promptBuilder (1122→914 ř., gameTags+voiceExamples), ChatScreen (1011→532 ř., useChatPanels+useChatActions)
- ✅ **Button styling** — 20+ tlačítek s backgroundem, paddingem, border-radius
- ✅ **Chat layout** — right vertical icon sidebar (📅🎒📜🧍🎬🧠📖) uvnitř flex kontejneru; ← bez textu, sidebar se sekcemi + divider pro narrative controls
- ✅ **Kalendář** — čas dne (🌅☀️🌆🌙), fantasy měsíce s reálnými v závorce, ikony sezón, template-based světové události (20 šablon, 5 na chat), CalendarPanel, 📅 tlačítko v icon baru
- ✅ **Inventář** — grid/list toggle, typové ikony (⚔️🛡️🧪📜💎🍖🔧📦), default list; whole-word + frázový matching (fix "ocelový nůž"=⚔️, "alchymistická sada"=🧪, "inženýrská sada"=🔧); quantity badge 0.7em (škáluje se s fontem); grid mód zobrazuje ikony místo placeholderů
- ✅ **Potvrzovací dialogy** — `showConfirm()` wrapper, 13 míst opraveno
- ✅ **Undo toast**, streaming indikátor, unread badges, import preview, export progress
- ✅ **Drobné opravy** — grey screen (useKeyboardShortcuts mimo Router), inventář přetrvávající napříč chaty

---

## Přepracovaný layout chatu + kalendář s minutami (2026-07-18, Claude)

DeepSeekův pokus o layout skončil rozbitým buildem (heterogenní pole → špatný typ
`onClick`, hardcoded český string místo `t()`) — předěláno od základu.

**Layout hlavičky/inputu:**
- Hlavička přes celou šířku okna: vlevo ← + název, na střed 2řádkový kalendář
  (datum+sezóna / čas+počasí), vpravo avatar vypravěče (GM) s popoverem členů
  skupiny (funguje i pro sólo chaty — dřív se popover renderoval jen když bylo
  víc než 1 postava, takže klik na solo GM avatara nedělal nic)
- Pravý herní panel (🧍 Postava, 🎒 Inventář, 📜 Úkoly, 📅 Kalendář, oddělovač,
  🧠 Paměť, 🎬 Režisér, 📖 Kronika) — stejný vizuální jazyk jako levý Sidebar
  (pozadí za ikonami, accent při aktivním stavu); indikátor připojení (🔌/⚠️)
  přesunut z hlavičky na spodek tohoto panelu (`mt-auto`)
- Persona (kdo píše) přesunuta z dropdownu do avataru přímo vedle inputu —
  klik otevírá popover s fotkou/jménem/věkem/rasou; input přes celou šířku dole
- Ukazatel využití kontextu odstraněn z UI úplně, informace je teď jen v tooltipu
  nad indikátorem připojení (běžný hráč stejně neví, co s číslem v %)
- Tlačítka 💡 Navrhni / ➤ Odeslat / ⏹ Stop sjednocena na ikony stejné velikosti
- Avatary (persona, GM, skupinové) ořezávané od horního okraje (`object-top`),
  ne ze středu — u portrétů je obličej skoro vždy nahoře
- Ikona appky v levém Sidebaru nahradila nicneříkající oranžovou tečku

**Opravené vizuální/UX chyby (nahlášené uživatelem po testování):**
- Záložky v Nastavení splývaly do jednoho bloku — `var(--color-primary)` v
  kódu vůbec neexistovala (paleta má jen `--color-accent`), takže vybraná
  záložka neměla pozadí a text byl tmavý na tmavém
- Checkboxy/radio se neškálovaly s nastavením velikosti písma (pevné px z
  UA stylesheetu) — globální CSS pravidlo `input[type=checkbox/radio] { width/height: 1em }`
- Čísla u dovedností a nadpisy v panelech Postava/Úkoly měly natvrdo
  `text-[10px]`/`text-[9px]` — sjednoceno na `em` jako v Inventáři
- Rozepsaný text zprávy (auto-save draft) se ukládal pod jeden globální
  `localStorage` klíč pro všechny chaty — otevření nového/jiného chatu
  zobrazovalo cizí rozepsaný text ("duchové"). Draft je teď per-chat
  (`chat_draft_<id>`), při přepnutí chatu se pole vždy přepíše i na prázdno

**Kalendář:**
- Přepínač fantasy/reálné měsíce (Nastavení → Hraní), globální nastavení
  přes `settingsStore`, promítá se do hlavičky, `CalendarPanel` i do
  systémového promptu pro AI
- `CalendarDate` má nově `minuteOfHour` — dřív kalendář uměl jen celé
  hodiny, ale AI se v chatu už samo pokoušelo tagovat minuty. Zjištěno, že
  `[TIME:+1h]`, ač zmíněné v instrukcích pro AI, se v parseru vůbec
  nezpracovávalo (jen `[TIME:+Nd]`) — tiše se smazalo beze změny. Nový
  primitiv `advanceMinutes()` (na něm postaveny `advanceDay`/`advanceHour`),
  parser `[TIME:...]` rozumí dnům/hodinám/minutám, čas se všude ukazuje
  jako HH:mm (hlavička, CalendarPanel, AI prompt)
- `CalendarPanel`: mini-měsíc je procházitelný (šipky ‹›, cyklí přes
  `MONTHS`/rok), dny s naplánovanou událostí mají tečku, klik rozbalí
  detail (ikona/název/popis) — vše v jedné kartě s orámováním; nadpis
  opraven z osamoceného genitivu ("Měsíce probuzení") na "Události <měsíc>"
  (v čistém genitivu to samo o sobě v češtině nedávalo smysl)
- Efekty počasí na hratelnost (např. sníh → pomalejší pohyb) vědomě
  odloženo — žádná mechanika počasí zatím není zavedená

---

## Hardcore mode + oprava driftu faktů (2026-07-18, Claude)

**Hardcore mode:**
- Nová vlastnost chatu (`chats.hardcore_mode`, migrace 30) — nastavuje se napevno
  při vytváření chatu (checkbox s hintem), ale jde přepnout i kdykoliv za chodu
  z Režie scény (🎬). Jeden zdroj pravdy, žádná duplicita mezi formulářem a
  popoverem. Karta chatu v seznamu má indikátor 💀. Branch/undo-delete flag
  zachovávají.
- Když zapnuto, model dostává instrukci (`DIRECTOR_HARDCORE_NOTE`), že smrt
  postavy je reálná a trvalá — bez poslední záchrany, ale musí to logicky
  vyplývat z toho, co se stalo. Model to signalizuje tagem `[GAMEOVER:důvod]`,
  který se zpracuje jen když je hardcore skutečně zapnutý (ověřeno na chatu,
  ne věřeno modelu). Jakmile nastane, chat se zablokuje a přes obrazovku se
  zobrazí overlay s důvodem — trvalé, žádné pokračování v tom chatu.
- Vedle toho i obecný (vždy zapnutý) risk/cost systém v `TWO_ROLES_INSTRUCTIONS`:
  riskantní akce nemá být ani automatický čistý úspěch, ani tvrdá zeď kvůli
  chybějícímu skillu — default je "uspěješ, ale něco tě to stojí" (zranění,
  spotřeba materiálu, ztráta věci, čas, komplikace), škálované podle
  nepřipravenosti pokusu. U nejistých situací má model vyzvat k hodu kostkou
  (`/r 1d20`, existující dice systém) a výsledek interpretovat narativně —
  bez pevného DC.
- Popsáno i menší doprovodné opravy: `[GAMEOVER:...]` tag v `inventoryTags.ts`,
  nevyužitá diagnostika `lastTagErrors`/`getLastTagErrors()` teď skutečně
  zapojená do dalšího promptu jako `[TAG CORRECTION]` (dřív mrtvý kód).

**Diagnóza a oprava driftu příběhu (nahlásil uživatel v reálné kampani):**
- Hráč porazil poškozený, 300 let starý konstrukt a AI během pár zpráv (a) hned
  poslala další posilu bez logického zdůvodnění a (b) sloučila samostatný
  runový pilíř (kterého se hráč vůbec nedotkl) s poraženým konstruktem do
  jedné entity.
- Kořenová příčina nalezena přímo v produkční DB: extraktor faktů zachytil
  improvizované vysvětlení, které si AI vymyslela na místě k ospravedlnění
  eskalace ("vybití energie funguje jako maják přitahující ostatní stroje
  přes rezonanční síť"), jako trvalý `world` fakt. Fakt nebyl zamčený/kánon
  (`canon=0`), ale prompt ho i tak vykresloval pod hlavičkou
  `[WORLD FACTS — binding]` — tedy se stejnou váhou jako skutečné kánon
  zákony. Model pak eskaloval a slil entity, aby zůstal konzistentní s
  vlastní jednorázovou impovizací, kterou teď bral jako závaznou.
- Oprava (`promptTexts.ts`): (1) hlavička nezamčených faktů zmírněna z
  "binding" na "established so far, not unbreakable... a one-off in-fiction
  explanation isn't a new law"; (2) `EXTRACTION_SYSTEM_PROMPT` nově výslovně
  rozlišuje trvalé worldbuilding pravidlo od jednorázové improvizované
  omluvy pro danou scénu — druhé se nemá zapisovat; (3) nová instrukce
  "ENTITY CONSISTENCY AND PACING" v `TWO_ROLES_INSTRUCTIONS` — zakázané
  zpětné slévání/přepisování zavedených entit a reflexivní eskalace hrozeb
  bez zdůvodnění v příběhu.
- Špatný fakt v rozehrané kampani ručně archivován v DB, ať okamžitě přestane
  otravovat prompt (extraktor by ho jinak mohl nechat ležet libovolně dlouho).

---

## M34 — Lokální AI, duálně přepínatelná (zadáno 2026-07-19)

**Motivace:** místo posílání dlouhých instrukcí velkému (cloudovému) modelu ať
lokální AI zpracuje "bookkeeping" úlohy sama a velkému modelu pošle jen
hotová strukturovaná data. Mechaniky, které jsou čistě deterministické
(kostky, počasí, kalendář), lokální AI vůbec nepotřebují — už dnes běží jako
čistý kód bez LLM (`diceCommand.ts`, `gameTime.ts`, `calendar.ts`) a
nemá smysl to měnit. Skutečný prostor pro lokální AI jsou úlohy, které dnes
běží jako **druhé cloudové LLM volání** oddělené od hlavního vypravěče
(`extractor.ts`, `summarizer.ts`, `driftDetector.ts` — všimni si, že appka už
má pro tohle vlastní přepínatelnou connection: `chat.extractionConnectionId`
odlišnou od hlavní vyprávěcí). Nahrazení těchhle volání lokálním modelem
nešetří prompt hlavnímu vypravěči vůbec (ten se nemění), ale šetří
free-tier limity, rychlost a offline dostupnost bookkeepingu.

**Architektura — duální přepínač:**
- Nový typ connection `local` vedle Gemini/Claude/OpenAI v `providers/types.ts`
  — slot se do stávající abstrakce feature-scoped connections (extrakce,
  summary, drift, embedding už dnes mají vlastní connection ID).
  Uživatel si u každé featury zvlášť v Nastavení→Connections vybere cloud
  nebo lokální model — žádné tvrdé přepnutí celé appky.
- **Fáze A (desktop, Windows/Linux):** PoC s inference enginem vázaným na
  Rust (llama.cpp/candle bindings), model stažitelný po instalaci (ne
  zabalený v instalátoru) — manifest s verzí/checksummou, progress bar,
  přeskočí se, pokud je lokální model už stažený a aktuální (stejný princip
  jako assety u velkých her). Cíl: ověřit kvalitu a rychlost na extraktoru/
  summarizeru dřív, než se řeší cokoliv dalšího.
  - ⚠️ Drift detektor (`driftDetector.ts`) zůstává mimo scope fáze A — viz
    existující hodnocení níže ("🔴 Lokální model na drift-check"), tahle
    úloha vyžaduje lepší úsudek než malý model typicky zvládne. Ověřit znovu
    až po PoC na extraktoru/summarizeru, ne předpokládat rovnou úspěch.
- **Fáze B (mobil), podmíněně:** jen pokud se fáze A osvědčí kvalitou a
  rychlostí. Android přidává reálné riziko navíc k tomu, co appku už dnes
  trápí u mobilního buildu (NDK, aarch64/armv7 only, "no space left on
  device" u CI) — těžká nativní ML závislost tam zvyšuje šanci na rozbitý
  build i na slabším telefonu neúnosnou rychlost. Stahování modelu +
  assetů po instalaci stejným mechanismem jako fáze A.

**Nezadáno / neřešeno zatím:** konkrétní model (velikost, kvantizace),
konkrétní Rust inference crate, UI pro výběr/správu stažených modelů,
fallback chování při selhání lokální inference.

---

## Nápady a poznámky

### Nápady z brainstormingu (2026-07-18)

- **Hudba/zvuková kulisa** — ambientní přehrávač podle světa kampaně (inspirace Tabletop Audio). Tagování podle dimenzí (prostředí/atmosféra/děj), vazba na directorNote. Nezadáno.
- **Centrální crash reporting (Sentry)** — až bude víc uživatelů. Nutný opt-in, sanitizace dat. Nezadáno.
- **Stárnutí postavy s herním kalendářem** — propojit věk persony s `calendarDate`. Nezadáno.
- **Vizuální herní datum/čas** — ikona podle sezóny/denní doby. Nezadáno.
- **Vektorové hledání v syrové historii** — chunkovat i přepis chatu, nejen fakta. Riziko: objem API volání.
- **Hlasová konzistence NPC** — embeddingy replik jako živý příklad stylu. ✅ Hotovo.
- **Capování podle last_touched** — řadit podle naposledy použitého/změněného, ne podle pořadí přidání. ✅ Hotovo.
- **Výběr typu kostky u 🎲 tlačítka** — teď je natvrdo 1k20 (nejčastější případ pro risk/cost systém). Do budoucna: rozkliknutelná nabídka/popover s jiným počtem stěn (2k6, k100...) místo jen fixního 1d20. Volný text `/r <výraz>` už podporuje libovolný zápis, jen rychlé tlačítko ne. Nezadáno.

### Lokální AI — ucelené hodnocení

- 🟢 **Lokální embedding model** — nejsilnější kandidát (rychlost, nezávislost na providerovi)
- 🟡 **Lokální STT** (whisper.cpp) — nová featura, zralá technologie
- 🔴 **Lokální TTS** — zavrženo (Piper, chybějící české fonémy)
- 🔴 **Lokální generování obrázků** — nereálné (velikost modelů, výkon)
- 🔴 **Lokální model jako vypravěč** — kvalitativní propast
- 🔴 **Lokální model na drift-check** — nespolehlivé u malých modelů (viz M34 — mimo scope fáze A, ověřit až po PoC na extraktoru/summarizeru)

### Function calling — ✅ Hotovo (commit `2d4d260`)

Model volá `get_item_detail` jen když hráč odkáže na starou/sbalenou věc. Náklady: +0,5–0,7 s navíc, jen když je to potřeba. Scope: Gemini (OpenAI/Claude no-op).

### Embedding-based dedup — 🔴 Zamítnuto

Kosinová podobnost nestačí na rozlišení "sloučit vs. nesloučit" u krátkých českých frází (překryv skóre). Neimplementovat.

---

## Průběžně

- **UI kvalita jako DoD** — FieldHelp u nových polí, složitější nastavení za "Pokročilé"
- **Ladění paměti** — MMR, importance scoring, context budget
- **Skupiny v praxi** — doladit auto-výběr mluvčího
- **Mouchy z hraní** — přednostně před dalším milníkem

Vědomě vynecháno (nedohánět ST): extensions ekosystém, desítky providerů, STscript, instruct šablony, CFG/logit bias, Live2D/VRM.
