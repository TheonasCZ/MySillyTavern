#!/usr/bin/env bash
# Spustí MySillyTavern ve vývojovém režimu (aktuální kód z repa).
# Wayland workaround je zapečený v src-tauri/src/main.rs, tady nic není potřeba.
cd "$(dirname "$0")" || exit 1
exec npm run tauri dev
