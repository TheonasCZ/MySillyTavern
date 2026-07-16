# MySillyTavern — roadmapa M11+

Stav k 2026-07-16: hotovo M1–M10 (základ, chat, postavy, persony, lorebooky,
paměť + sémantický retrieval s backfillem, komfort hraní, skupinové chaty
s povýšením NPC, ukotvení pohledu, inline návrhy reakcí). Tento dokument
plánuje další milníky; pořadí = doporučená priorita.

---

## M11 — Stabilita a výkon („mouchy ven")

**Motivace:** Aplikace je funkčně bohatá, ale nasbírala drobné mouchy
(uživatel je zatím neumí popsat — potřebujeme je vidět dřív než on) a chat
s tisíci zprávami začne narážet na limity plného renderu.

**Rozsah:**
1. **E2E smoke testy v harnessu** — `public/debug-anchor.html` zobecnit na
   `public/e2e-harness.html` (mock IPC parametrizovatelný scénářem) a přidat
   `scripts/e2e.mjs` (Playwright Chromium + volitelně WebKit MiniBrowser).
   Scénáře: otevření chatu, odeslání + stream + kotvení (regresní test na
   3830e33), regenerace, větvení, přepnutí mluvčího ve skupině, inline čipy.
   Spouštět ručně `npm run e2e`; ne CI (není).
2. **Virtualizace seznamu zpráv** — render jen viditelného okna (vlastní
   lehká virtualizace nad stávající paginací; NE nová závislost, stačí
   IntersectionObserver + odhad výšek, pozor na kotvení a spacer).
   Hotovo když: chat s 2000 zprávami scrolluje plynule a kotvení funguje.
3. **Sběr chyb do souboru** — `console.error/warn` + Rust chyby logovat do
   `$APPDATA/logs/app.log` s rotací; v Nastavení tlačítko „Otevřít log".
   Uživatel pak mouchy doloží logem.
4. **Bug sweep** — projít známá slabá místa: race při rychlém přepínání
   chatů, opuštění chatu během streamu, HMR artefakty vs. produkční build
   (otestovat `tauri build` release!), přepnutí jazyka za běhu.

**Hotovo když:** e2e scénáře zelené v obou enginech, release build ověřen,
2000zprávový chat plynulý, chyby dohledatelné v logu.
**Riziko:** virtualizace × kotvení — dělat po e2e testech, ať je záchytná síť.

---

## M12 — Nástroje vypravěče (kronika, export, statistiky)

**Motivace:** Několikahodinová kampaň si zaslouží artefakty: přehled děje,
export příběhu, kontrola spotřeby.

**Rozsah:**
1. **Kronika (timeline)** — nová záložka v Memory panelu: chronologický
   přehled „scén" (už existují jako embedding chunky `kind='message'`) +
   event fakta. Klik na scénu → skok na zprávu v historii (vyžaduje
   doscrollování s paginací — načíst okolí zprávy podle created_at).
2. **Export příběhu** — Markdown/HTML export chatu: titul, postavy, souhrn,
   zprávy s markdownem (kurzíva akcí, jména mluvčích ve skupině), volitelně
   bez OOC instrukcí. Rust command `export_story` + dialog uložení
   (tauri-plugin-dialog už je). HTML šablona s tématem Ember Tavern.
3. **Statistiky** — panel v Nastavení: počty zpráv/chat, odhad spotřeby
   tokenů za den/týden (ukládat per-request odhad do nové tabulky
   `usage_log` — migrace 5), počet požadavků (kvůli free tier RPD limitu!),
   velikost DB. Hlavní hodnota: uživatel vidí, kolik z denní kvóty čerpá.
4. **Prompt presety** — pojmenované sady (system prompt dodatky, teplota…)
   přepínatelné per chat; tabulka `presets` (v migraci 5 společně).

**Hotovo když:** kronika ukazuje scény kampaně uživatele, export vytvoří
čitelné HTML jeho hry, statistiky ukazují dnešní počet požadavků.

---

## M13 — TTS předčítání

**Motivace:** Atmosféra — vypravěč čte nahlas; z plánu §10.

**Rozsah:**
1. Web Speech API (`speechSynthesis`) ve webview jako základ — zdarma,
   offline; ověřit dostupnost hlasů ve WebKitGTK (riziko! může chybět —
   pak fallback: Rust command + `espeak-ng`/Piper binárka, rozhodnout podle
   průzkumu na začátku milníku).
2. UI: tlačítko ▶ u bubliny + auto-režim „předčítej nové odpovědi"
   (nastavení per chat), stop při novém streamu; volba hlasu a rychlosti
   v Nastavení → Vzhled/nová sekce Zvuk.
3. Skupiny: hlas per postava (mapování postava→hlas v kartě postavy).
4. Čistá logika: příprava textu pro TTS (odstranit markdown, OOC bloky,
   inline možnosti) — `src/chat/ttsText.ts` + testy.

**Hotovo když:** odpověď jde přehrát/zastavit, auto-režim čte nové odpovědi,
každá postava skupiny může mít vlastní hlas.
**Riziko:** kvalita českých hlasů; průzkum PŘED implementací UI.

---

## M14 — Sync a zálohy 2.0

**Motivace:** Ruční ZIP export (M6) nestačí na hraní z více zařízení;
z plánu §10 („sync přes soubor/cloud").

**Rozsah:**
1. **Automatické lokální zálohy** — při startu/denně rotující ZIP do
   `$APPDATA/backups/` (reuse `export_backup`), max N kusů, nastavitelné.
2. **Sync přes složku** (Syncthing/Nextcloud/Dropbox — bez vlastního
   cloudu): volitelná „sync složka"; app do ní píše žurnál změn
   (append-only JSONL per zařízení + periodické snapshoty). Merge strategie:
   last-write-wins per entita (zprávy jsou append-only → bezkonfliktní;
   fakta/summary podle updated_at; konflikt = zachovat obě verze faktu
   k ručnímu sloučení v Memory panelu).
3. **Konfliktní UI** — banner „nalezeny změny z jiného zařízení" + náhled.
4. API klíče se NIKDY nesyncují (zůstávají v keyringu zařízení).

**Hotovo když:** dvě instalace (např. desktop + notebook) sdílející složku
si vymění nový chat i pokračování starého bez ztráty dat.
**Riziko:** merge edge-cases — začít žurnálem a zprávami (bezpečné),
fakta/summary až druhá fáze. Tohle je největší milník, dělit na 2 části.

---

## M15 — Mobil (průzkum → port)

**Motivace:** Hraní z gauče; z plánu §10. Záměrně poslední — závisí na M14
(sync) a stabilitě.

**Rozsah (fáze A — průzkum, timebox):** Tauri 2 Android build: zkompilovat,
ověřit tauri-plugin-sql, keyring (Android Keystore backend `keyring` crate
neumí — nutná náhrada: tauri-plugin-stronghold nebo vlastní EncryptedFile),
WebView chování (kotvení!). Výstup: zpráva co funguje / co ne + rozhodnutí
jít/nejít.
**Rozsah (fáze B — port):** responzivní úpravy (už z velké části jsou:
overlay panely, flex layouty), touch gesta pro swipe variant, klávesnice
vs. input bar, Android back tlačítko.

**Hotovo když (B):** APK hratelné: otevřít chat, poslat zprávu, stream,
paměť funguje, klíč bezpečně uložen.

---

## Průběžně (mimo milníky)

- **Ladění paměti** — po delším hraní uživatele vyhodnotit: drží žánr?
  Vytahují se správné vzpomínky? (viz memory poznámka: nejdřív zkontrolovat,
  zda si zvedl context budget a zamkl kánon fakta). Případně: MMR
  diverzifikace top-K, časový decay skóre.
- **Skupiny v praxi** — auto-režim výběru mluvčího doladit podle reálného
  používání (např. váha „byl osloven přímo" vs. round-robin).
- **Mouchy z hraní** — jakmile je uživatel popíše (nebo je chytí log z M11),
  řešit přednostně před dalším milníkem.

## Doporučené pořadí a velikost

| Milník | Velikost | Poznámka |
|--------|----------|----------|
| M11 stabilita | střední | první — záchytná síť pro všechno další |
| M12 nástroje vypravěče | střední | vysoká viditelná hodnota, nízké riziko |
| M13 TTS | malý–střední | průzkum hlasů může milník zabít — timebox |
| M14 sync | velký | dělit na 2 fáze, začít zálohami |
| M15 mobil | velký | až po M14, fáze A je levný průzkum |
