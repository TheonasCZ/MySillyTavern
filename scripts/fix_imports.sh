#!/bin/bash
cd /home/morthos/projects/MySillyTavern

# Add showConfirm import to each file
add_import() {
  local file="$1"
  # Check if already has showConfirm import
  if grep -q "showConfirm" "$file" 2>/dev/null | grep -q "import"; then
    return
  fi
  # Find the existing platform import line or add a new one
  if grep -q "from.*platform" "$file"; then
    # Extend existing import
    sed -i 's/{ \([^}]*\) } from.*platform/{ \1, showConfirm } from "\/home\/morthos\/projects\/MySillyTavern\/src\/platform"/' "$file"
    sed -i 's|from "/home/morthos/projects/MySillyTavern/src/platform"|from "../../platform"|' "$file"
    sed -i 's|from "/home/morthos/projects/MySillyTavern/src/platform"|from "../platform"|' "$file"
  else
    echo "MISSING platform import: $file"
  fi
}

for f in src/ui/characters/CardEditor.tsx \
  src/ui/chat/ChatListScreen.tsx \
  src/ui/chat/ChatScreen.tsx \
  src/ui/lorebooks/LorebookEditor.tsx \
  src/ui/memory/MemoryPanel.tsx \
  src/ui/personas/PersonaForm.tsx \
  src/ui/settings/BackupPanel.tsx \
  src/ui/settings/ConnectionForm.tsx \
  src/ui/settings/PresetsPanel.tsx \
  src/ui/settings/SettingsScreen.tsx; do
  add_import "$f"
done

echo "DONE"