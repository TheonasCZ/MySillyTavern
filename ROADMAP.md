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
- ✅ **Inventář** — grid/list toggle, typové ikony (⚔️🛡️🧪📜💎🍖🔧📦), default list
- ✅ **Potvrzovací dialogy** — `showConfirm()` wrapper, 13 míst opraveno
- ✅ **Undo toast**, streaming indikátor, unread badges, import preview, export progress
- ✅ **Drobné opravy** — grey screen (useKeyboardShortcuts mimo Router), inventář přetrvávající napříč chaty

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
