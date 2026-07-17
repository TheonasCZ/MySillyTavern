# Pokyny pro agenty pracující na tomto repu

Platí pro každého AI agenta (Claude Code, DeepSeek, Codex, …), který
v tomhle repozitáři commituje.

## Verze a release jen na výslovné požádání

Commitovat a pushovat do `master` po dokončené a otestované změně je
v pořádku průběžně — na to není potřeba se ptát.

**Ale nikdy sám nezvedej verzi** (`version` v `src-tauri/tauri.conf.json`,
`package.json`, `package-lock.json`) **a nikdy sám nevytvářej git tag
`vX.Y.Z`.** Push tagu `v*` spouští `.github/workflows/release.yml` —
plný CI build pro Linux i Windows (~15–20 minut), který vytvoří
veřejný GitHub Release s podepsanými instalačními balíčky.

Důvod: při ladění vznikají opravy rychle za sebou. Zvednutí verze a
tag po každé z nich zbytečně násobí CI běhy a nafukuje historii
Releases balíčky, které nikdo nestáhl. Rozhodnutí "tohle je hotové,
vydej to" má zůstat na uživateli.

Když je hotovo víc oprav najednou, klidně navrhni "chceš z toho udělat
release?" — ale verzi/tag sám nespouštěj, dokud to uživatel
nepotvrdí.

## Dokumentační hygiena (viz ROADMAP.md)

U nových milníků drž číslování z `ROADMAP.md`; commity znač `M<n>` jen
podle téhle roadmapy, ne podle vlastního schématu.
