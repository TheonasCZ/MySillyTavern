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
| **M28 fáze B — EN pivot paměti** | ⬜ odloženo |
| **M31 fáze B — Offline TTS** | ⬜ odloženo (průzkum Sherpa-ONNX) |
| **Android release podepisování** | ⬜ výhledově |
| **Gemma fallback** (system prompt do user msg) | ⬜ výhledově |

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

## Nápady a poznámky

### Nápady z brainstormingu (2026-07-18)

- **Hudba/zvuková kulisa** — ambientní přehrávač podle světa kampaně (inspirace Tabletop Audio). Tagování podle dimenzí (prostředí/atmosféra/děj), vazba na directorNote. Nezadáno.
- **Centrální crash reporting (Sentry)** — až bude víc uživatelů. Nutný opt-in, sanitizace dat. Nezadáno.
- **Stárnutí postavy s herním kalendářem** — propojit věk persony s `calendarDate`. Nezadáno.
- **Vizuální herní datum/čas** — ikona podle sezóny/denní doby. Nezadáno.
- **Vektorové hledání v syrové historii** — chunkovat i přepis chatu, nejen fakta. Riziko: objem API volání.
- **Hlasová konzistence NPC** — embeddingy replik jako živý příklad stylu. ✅ Hotovo.
- **Capování podle last_touched** — řadit podle naposledy použitého/změněného, ne podle pořadí přidání. ✅ Hotovo.

### Lokální AI — ucelené hodnocení

- 🟢 **Lokální embedding model** — nejsilnější kandidát (rychlost, nezávislost na providerovi)
- 🟡 **Lokální STT** (whisper.cpp) — nová featura, zralá technologie
- 🔴 **Lokální TTS** — zavrženo (Piper, chybějící české fonémy)
- 🔴 **Lokální generování obrázků** — nereálné (velikost modelů, výkon)
- 🔴 **Lokální model jako vypravěč** — kvalitativní propast
- 🔴 **Lokální model na drift-check** — nespolehlivé u malých modelů

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
