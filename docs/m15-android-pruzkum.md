# M15 fáze A — průzkum proveditelnosti Android portu (Tauri 2 Mobile)

Datum: 2026-07-17
Prostředí zkoumáno v: worktree `.claude/worktrees/agent-ae18d7718f9fa174f` (commit `56e38b1`), stroj CachyOS Linux (KDE/Wayland), pouze zjišťování — nic nebylo instalováno.

## Shrnutí a doporučení

**Doporučení: JÍT, ale fáze B je větší než „velký" v ROADMAPu naznačuje kvůli klíčům a testovacímu prostředí.** Žádná ze závislostí port nevylučuje. Jediná tvrdá blokace je crate `keyring` (Secret Service backend), který na Androidu nemá funkční implementaci — ale abstrakce `SecretStore` v `src-tauri/src/commands/secrets.rs` je přesně navržená pro výměnu backendu, takže náklad je omezen na napsání jedné nové implementace traitu + použití existujícího `tauri-plugin-biometric` nebo `android-keyring` crate. Zbytek pluginů (sql, reqwest+rustls) je mobile-ready. `dialog`/`opener`/`process` potřebují na Androidu buď náhradu (dialog je nativně podporovaný jen částečně), nebo odstranění/podmíněnou kompilaci pro desktop-only funkce (opener pro externí odkazy funguje přes intent, process se na mobilu nepoužívá vůbec — process plugin je pro restart/exit desktopové appky).

Odhad fáze B: **8–14 člověko-dnů práce agentů** (viz sekce Doporučení na konci).

---

## 1. Prostředí (na tomto stroji)

Co je k dispozici:

| Nástroj | Stav |
|---|---|
| `adb` | nainstalováno (`/usr/bin/adb`, balíček `android-tools 36.0.1-2.1`) |
| `java`/`javac` | OpenJDK 17.0.19 nainstalováno (balíček `jdk17-openjdk`) — **dostatečné**, Tauri doc doporučuje JBR z Android Studia, ale JDK 17 by mělo fungovat pro Gradle build |
| `sdkmanager` | **chybí** |
| `$ANDROID_HOME` / `$ANDROID_SDK_ROOT` | **nenastaveno**, žádný SDK adresář (`~/Android/Sdk` neexistuje) |
| `$ANDROID_NDK_HOME` | **nenastaveno**, NDK nenainstalován |
| `gradle` | **chybí** (balíček `gradle 9.6.1-1` je v `extra` repu, ale Tauri/Android Gradle Plugin si typicky stahuje vlastní gradle wrapper, takže systémový gradle nemusí být nutný) |
| rustup android targets | **žádný nainstalován** — `rustup target list --installed` vrací pouze `x86_64-unknown-linux-gnu` |
| `npx tauri android` CLI | k dispozici (`tauri-cli 2.11.4` je nainstalované přes npm, `tauri android init/build` podporováno) |

### Co doinstalovat a jak (Arch/CachyOS)

```bash
# JDK je už nainstalované (jdk17-openjdk) — OK, netřeba měnit

# Rust cíle pro Android (rustup je v ~/.cargo, funguje)
rustup target add aarch64-linux-android armv7-linux-androideabi \
  i686-linux-android x86_64-linux-android

# Android SDK + NDK: nejjednodušší cesta je přes Android Studio (obsahuje
# sdkmanager i JBR JDK), balíček je v AUR:
paru -S android-studio
# Po prvním spuštění doinstalovat přes SDK Manager (GUI nebo cmdline):
#   Android SDK Platform, Platform-Tools, NDK (Side by side),
#   Android SDK Build-Tools, Android SDK Command-line Tools

# Alternativa bez Android Studia (menší, ale méně pohodlné):
paru -S android-sdk android-sdk-platform-tools android-sdk-build-tools android-sdk-cmdline-tools-latest
# NDK ručně:
sdkmanager --install "ndk;27.0.12077973"

# Proměnné prostředí (do ~/.zshrc nebo ~/.bashrc):
export ANDROID_HOME="$HOME/Android/Sdk"          # nebo /opt/android-sdk dle instalace
export NDK_HOME="$ANDROID_HOME/ndk/$(ls -1 $ANDROID_HOME/ndk)"
export JAVA_HOME=/opt/android-studio/jbr         # pokud přes Android Studio

# gradle: Tauri Android projekt používá gradle wrapper (gradlew), systémový
# balíček není nutný, ale pro lokální diagnostiku:
sudo pacman -S gradle   # extra/gradle 9.6.1-1, volitelné
```

Zdroj: [Tauri Prerequisites — mobile Android](https://v2.tauri.app/start/prerequisites/)

Bez tohoto SDK+NDK prostředí **nelze provést krok 3 (build)** — proto nebyl proveden `tauri android init`/`build` (viz sekce 3).

---

## 2. Kompatibilita závislostí

| Plugin/crate | Android stav | Poznámka / náhrada |
|---|---|---|
| `tauri-plugin-sql` (sqlite) | **Podporováno** — SQL plugin funguje napříč desktop i mobile, používá SQLite přes stejné rozhraní, žádná úprava kódu očekávána. | [SQL plugin docs](https://v2.tauri.app/plugin/sql/), [plugins-workspace repo](https://github.com/tauri-apps/plugins-workspace) |
| `keyring` v3 (Secret Service) | **NEPODPOROVÁNO** na Androidu — backend Secret Service je Linux-desktop specifický (D-Bus), na Androidu neexistuje. | Viz sekce 3 níže — nutná náhrada |
| `tauri-plugin-dialog` | **Částečně** — oficiální plugin seznam (v2.tauri.app/plugin/) neuvádí Android/iOS badge pro `dialog` jako plně podporovaný stejným API jako desktop; systémové dialogy (file picker) fungují jinak přes Android Storage Access Framework. Nutno ověřit konkrétní use-case v appce (pravděpodobně import/export ZIP zálohy — na Androidu vyžaduje SAF intent, ne desktop file dialog). | [Tauri plugin list](https://v2.tauri.app/plugin/) |
| `tauri-plugin-opener` | **Omezeně** — otevírání externích URL/odkazů funguje přes Android intent systém, ale plugin dokumentace nemá explicitní Android badge jako plně 1:1 s desktopem; pravděpodobně funguje pro `open_url`, ale ne pro otevírání souborů v systémovém editoru stejným způsobem. | [Tauri plugin list](https://v2.tauri.app/plugin/) |
| `tauri-plugin-process` | **Nepoužitelné/irelevantní na mobilu** — `relaunch`/`exit` koncepty desktopové appky nedávají na Androidu smysl (aplikace se řídí Android lifecycle, ne vlastním exit). Component by měl být podmíněně kompilován jen pro desktop (`#[cfg(not(target_os = "android"))]`). | — |
| `reqwest` + `rustls-tls` | **Funguje** — je to čistě Rust TLS stack (žádná závislost na OpenSSL/systémových cert store problémech), cross-kompilace pro `aarch64-linux-android` je standardní a dobře zdokumentovaná; SSE streaming (chunked/stream feature) by měl fungovat stejně jako na desktopu, protože běží v Rust vrstvě nezávisle na WebView. | [reqwest Android cross-compile issue thread](https://github.com/seanmonstar/reqwest/issues/1014), [cross-platform Rust HTTP guide](https://logankeenan.com/posts/cross-platform-rust-http-request/) |
| vite dev flow (`tauri android dev`) | **Podporováno** oficiálně — `npx tauri android dev` spouští dev server a nahrává do emulátoru/zařízení; vyžaduje funkční SDK+NDK prostředí a připojené zařízení/emulátor přes `adb`. | [Mobile Plugin Development](https://v2.tauri.app/develop/plugins/develop-mobile/) |

---

## 3. Klíče — náhrada za `keyring` na Androidu

`keyring` v3 nemá funkční Android backend (Secret Service je D-Bus/Linux-desktop only). Existují tři cesty:

1. **`tauri-plugin-stronghold`** — oficiální Tauri plugin, technicky podporuje mobile (`#[cfg_attr(mobile, tauri::mobile_entry_point)]` v kódu), ale **je oficiálně označen jako deprecated a bude odstraněn v Tauri v3** — nedoporučuji stavět na něm novou závislost pro dlouhodobě udržovanou appku. ([GitHub discussion #7846](https://github.com/orgs/tauri-apps/discussions/7846), [tauri-plugin-stronghold repo](https://github.com/tauri-apps/tauri-plugin-stronghold))

2. **`tauri-plugin-biometric`** (oficiální) — **plně podporuje Android i iOS** podle plugin listu, ale řeší jen *autentizaci* (biometric prompt), ne úložiště samotného secretu. Dal by se kombinovat s vlastním šifrovaným úložištěm odemykaným biometrií.

3. **`android-keyring` / `android-native-keyring-store`** crates — komunitní implementace `Store` traitu z `keyring-core`, které přemostí na Android KeyStore + EncryptedSharedPreferences přes JNI, **bez nutnosti psát vlastní Java/Kotlin kód**. `keyring-rs` repo přímo zmiňuje, že Tauri Mobile poskytuje potřebnou inicializaci JNI kontextu. ([android-keyring crates.io](https://crates.io/crates/android-keyring), [keyring-rs DeepWiki Android KeyStore](https://deepwiki.com/open-source-cooperative/keyring-rs/5.4-android-keystore))

**Doporučená cesta: (3) `android-keyring` crate jako druhá implementace `SecretStore` traitu, podmíněně kompilovaná pro `target_os = "android"`.**

Odůvodnění:
- `SecretStore` trait v `src-tauri/src/commands/secrets.rs` už je navržený přesně pro tento účel (dokumentační komentář na řádku 1-3 to explicitně říká).
- `android-keyring` je aktivně udržovaný nástupce v rámci stejného `keyring-rs`/`keyring-core` ekosystému (ne cizí závislost) — API by mělo být blízké současnému použití `keyring::Entry`.
- Nevyžaduje psaní vlastního JNI/Kotlin kódu (na rozdíl od EncryptedSharedPreferences „ručně").
- Nemá deprecation riziko jako Stronghold.

Pracnost: **1–2 člověko-dny** — nová implementace `AndroidKeyringStore: SecretStore` (přidání crate, `cfg(target_os = "android")` swap v místě, kde se dnes používá `KeyringStore` — pravděpodobně `lib.rs`/state setup), plus otestování na zařízení/emulátoru (uložení, čtení, smazání API klíče). Riziko: crate `android-keyring` je mladší/méně používaný než `keyring` samotné — může být potřeba drobný debugging JNI inicializace při prvním zprovoznění v Tauri kontextu.

---

## 4. WebView rizika

- Android verze Tauri **nebundluje vlastní WebView** — používá systémový Android System WebView (Chromium-based), jehož verze se odvíjí od aktuálně nainstalovaného WebView provideru na zařízení (typicky "Android System WebView" nebo Chrome, aktualizovaný přes Google Play). Oficiální dokumentace **neuvádí konkrétní minimální číslo verze** — doporučuje ověřit aktuální verzi přes `chrome://version` v Android WebView Devtools. ([Webview Versions | Tauri](https://v2.tauri.app/reference/webview-versions/))
- Komunitní diskuze uvádí, že teoreticky je podporován Android 7+, ale reálně testováno/doporučeno **Android 9+** (starší emulátory mívají zastaralé WebView, které se chová jinak než reálná zařízení). ([tauri-apps/tauri Discussion #11843](https://github.com/tauri-apps/tauri/discussions/11843))
- Protože Android System WebView je **Chromium-based** (na rozdíl od desktopového WebKitGTK, kde chybí nativní scroll anchoring a appka to řeší vlastní logikou), **scroll anchoring v chatu by mělo fungovat nativně** stejně jako v Chromium e2e testech na desktopu (Chrome/Chromium). To je dobrá zpráva — kód psaný/testovaný pro Chromium chování by se neměl chovat jinak na Androidu z hlediska scroll anchoring. Přesto doporučuji manuální ověření na reálném zařízení ve fázi B, protože chování WebView providerů (Google WebView vs. OEM varianty na některých zařízeních) může mít drobné odchylky.

---

## 5. Krok „pokus o build" (bod 3 zadání)

**Neproveden.** Prostředí v tomto worktree/stroji nemá nainstalovaný Android SDK ani NDK (viz sekce 1) — `ANDROID_HOME`/`ANDROID_SDK_ROOT` nejsou nastavené, `sdkmanager` chybí, `rustup target list --installed` neobsahuje žádný `*-android` target a `gradle` není v PATH. Podle zadání („Pokud prostředí chybí, NEinstaluj — jen zdokumentuj") jsem se instalaci úmyslně vyhnul (vyžadovala by `sudo pacman`/AUR helper). Jakmile uživatel doinstaluje SDK+NDK dle příkazů v sekci 1, lze ve fázi B spustit:

```bash
npx tauri android init
npx tauri android build --apk --ci
```

---

## 6. Rizika (souhrn)

1. **Klíče (keyring)** — vyřešeno návrhem výše, ale je to jediná skutečná blokace, ne triviální swap (JNI vrstva může mít nečekané problémy).
2. **dialog/opener na Androidu** — pravděpodobně vyžadují úpravu kódu (SAF intent pro import/export ZIP zálohy z M14/M6 dat export feature), ne jen recompile. Nutno prověřit v kódu, kde přesně `tauri-plugin-dialog` používáme (backup export/import) a otestovat na zařízení.
3. **process plugin** — je desktop-only koncept (`relaunch`/`exit`); nutná podmíněná kompilace, aby build na Androidu vůbec prošel (plugin nemusí mít mobile support vůbec).
4. **WebView fragmentace** — různé OEM WebView providery na reálných zařízeních (nejen Google referenční), riziko drobných odchylek chování oproti desktop e2e testům.
5. **Vývojové prostředí** — Android Studio/SDK je velká instalace (několik GB), a build cyklus (Gradle + Rust cross-compile) je výrazně pomalejší než desktop `cargo build` — ovlivní iterační rychlost fáze B.
6. **Touch/klávesnice/back tlačítko** (zmíněno v ROADMAPu pro fázi B) — mimo rozsah fáze A, ale je to netriviální UX práce (input bar vs. software klávesnice, Android back button mapping na `Escape`/zavření panelů).

---

## 7. Doporučení jít/nejít a odhad fáze B

**Jít.** Žádná závislost port nevylučuje; jediná tvrdá překážka (keyring) má jasně identifikovanou náhradu s nízkou pracností (1-2 dny) díky tomu, že `SecretStore` abstrakce byla dopředu připravená.

Odhad fáze B (člověko-dny práce agentů, orientačně):

| Úkol | Odhad |
|---|---|
| Prostředí (SDK/NDK instalace uživatelem, `tauri android init`, první úspěšný build) | 0.5–1 den (mimo agenta — uživatel/manuální) |
| Náhrada keyring → `android-keyring` implementace `SecretStore` | 1–2 dny |
| dialog/opener/process — audit použití, podmíněná kompilace, náhrada SAF pro export/import | 1–2 dny |
| Responzivní UI úpravy (panely, layouty — dle ROADMAPu už z velké části hotovo) | 1 den |
| Touch gesta pro swipe variant | 1–2 dny |
| Klávesnice vs. input bar (viewport resize handling) | 1 den |
| Android back tlačítko (mapování na zavírání panelů/navigaci) | 0.5–1 den |
| Testování na reálném zařízení/emulátoru (chat, stream, paměť, klíč) end-to-end | 1–2 dny |
| Buffer na neočekávané WebView/Gradle/NDK problémy | 1–2 dny |
| **Celkem** | **8–14 člověko-dnů** |

To odpovídá klasifikaci „velký" v ROADMAP tabulce, ale na horní hranici — doporučuji v plánování počítat spíš s 12-14 dny než s optimistickým minimem, protože mobilní build toolchain (Gradle+NDK+Rust cross-compile) přináší typicky víc "prvního běhu" tření než čistě webová/desktopová práce.
