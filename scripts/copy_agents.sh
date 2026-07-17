#!/bin/bash
M20="/home/morthos/projects/.codewhale-worktrees/mysillytavern/codex-agent-implementer-91cae5da"
M21="/home/morthos/projects/.codewhale-worktrees/mysillytavern/codex-agent-implementer-96be3537"

# M20-unique: personasRepo (conditions)
cp "$M20/src/db/repositories/personasRepo.ts" src/db/repositories/personasRepo.ts

# M21-unique: factionsRepo
cp "$M21/src/db/repositories/factionsRepo.ts" src/db/repositories/factionsRepo.ts

# M21 versions of shared files
cp "$M21/src/chat/inventoryTags.ts" src/chat/inventoryTags.ts
cp "$M21/src/chat/inventoryProcessor.ts" src/chat/inventoryProcessor.ts
cp "$M21/src/prompt/promptBuilder.ts" src/prompt/promptBuilder.ts
cp "$M21/src/ui/personas/PersonaForm.tsx" src/ui/personas/PersonaForm.tsx
cp "$M21/src-tauri/src/migrations.rs" src-tauri/src/migrations.rs
cp "$M21/src/i18n/cs.json" src/i18n/cs.json
cp "$M21/src/i18n/en.json" src/i18n/en.json

echo "base copied"
