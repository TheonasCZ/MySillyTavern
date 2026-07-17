# Merge M20 (Conditions) into M21 (Factions) shared files
# M21 is already in the workspace, M20 parts need to be added

M20="/home/morthos/projects/.codewhale-worktrees/mysillytavern/codex-agent-implementer-91cae5da"

# 1. personasRepo.ts — M20 version has conditions, keep it entirely
cp "$M20/src/db/repositories/personasRepo.ts" src/db/repositories/personasRepo.ts

# 2. inventoryTags.ts — add ConditionMutation + COND parsing
python3 -c "
with open('src/chat/inventoryTags.ts') as f: curr = f.read()
# Add ConditionMutation interface before FactionMutation
curr = curr.replace('export interface FactionMutation {',
    'export interface ConditionMutation {\n  op: \"add\" | \"remove\";\n  name: string;\n  description?: string;\n  duration?: string; // e.g. \"7d\", \"3h\"\n}\n\nexport interface FactionMutation {')
# Add conditionMutations to ParsedTags
curr = curr.replace('questMutations: QuestMutation[];', 'questMutations: QuestMutation[];\n  conditionMutations: ConditionMutation[];')
# Add COND parsing before Faction parsing
curr = curr.replace('// Faction tag parsing',
    '// Condition tag parsing: [COND:+name] [COND:-name] [COND:+name:desc] [COND:+name:desc:7d]\n  cleanText = cleanText.replace(/\\[COND:([+-])([^\\]]+)\\]/gi, (_m, op, rest) => {\n    const parts = rest.split(\":\");\n    const name = parts[0].trim();\n    const desc = parts[1]?.trim();\n    const dur = parts[2]?.trim();\n    conditionMutations.push({ op: op === \"+\" ? \"add\" : \"remove\", name, description: desc, duration: dur });\n    return \"\";\n  });\n\n  // Faction tag parsing')
# Add conditionMutations to return
curr = curr.replace('questMutations,', 'questMutations,\n    conditionMutations,')
with open('src/chat/inventoryTags.ts', 'w') as f: f.write(curr)
print('inventoryTags done')
"

# 3. inventoryProcessor.ts — add condition processing
python3 -c "
with open('src/chat/inventoryProcessor.ts') as f: curr = f.read()
# Add conditions import
curr = curr.replace('import { updatePersona }', 'import { updatePersona, updatePersonaConditions }')
# Add condition processing after skill changes
insert = '''
  // Apply condition mutations
  const conds = persona.conditions ? [...persona.conditions] : [];
  for (const c of conditionMutations) {
    if (c.op === \"add\") {
      const existing = conds.find(x => x.name.toLowerCase() === c.name.toLowerCase());
      if (existing) { existing.description = c.description || existing.description; existing.duration = c.duration || existing.duration; }
      else conds.push({ name: c.name, description: c.description || \"\", expiresAt: null });
    } else {
      const idx = conds.findIndex(x => x.name.toLowerCase() === c.name.toLowerCase());
      if (idx >= 0) conds.splice(idx, 1);
    }
  }
  if (conditionMutations.length > 0) {
    try { await updatePersonaConditions(persona.id, conds); } catch {}
  }'''
curr = curr.replace('// Apply faction mutations', '// Apply condition mutations\n' + insert + '\n\n  // Apply faction mutations')
# Update destructuring to include conditionMutations
curr = curr.replace('const { cleanText, mutations, skillChanges, questMutations }', 'const { cleanText, mutations, skillChanges, questMutations, conditionMutations }')
with open('src/chat/inventoryProcessor.ts', 'w') as f: f.write(curr)
print('inventoryProcessor done')
"

# 4. promptBuilder.ts — add conditions to PersonaLike + rendering
python3 -c "
with open('src/prompt/promptBuilder.ts') as f: curr = f.read()
# Add conditions to PersonaLike
curr = curr.replace('factions?: FactionRepLike[];', 'factions?: FactionRepLike[];\n  conditions?: Array<{ name: string; description?: string }>;')
# Add conditions rendering after faction standings
curr = curr.replace('// Faction standings', 
    '// Conditions\n    if (persona.conditions?.length) {\n      personaLines.push(\"\\nStavy:\");\n      for (const c of persona.conditions) {\n        personaLines.push(`- ${c.name}${c.description ? \": \" + c.description : \"\"}`)\n      }\n    }\n\n    // Faction standings')
# Add condition tag instructions
curr = curr.replace('Změny frakcí: [FACTION:+jméno:delta]', 
    'Změny stavů: [COND:+jméno] přidání, [COND:-jméno] odebrání, [COND:+jméno:popis] s popisem.\\nZměny frakcí: [FACTION:+jméno:delta]')
with open('src/prompt/promptBuilder.ts', 'w') as f: f.write(curr)
print('promptBuilder done')
"

# 5. PersonaForm.tsx — add conditions display
python3 -c "
with open('src/ui/personas/PersonaForm.tsx') as f: curr = f.read()
# Add conditions display after factions section
insert2 = '''
        {/* Conditions display */}
        {initial && initial.conditions && initial.conditions.length > 0 && (
          <div className=\"flex flex-col gap-1\">
            <span className=\"text-sm font-medium\">{t(\"form.fields.conditions\")}</span>
            <div className=\"flex flex-wrap gap-1\">
              {initial.conditions.map((c, i) => {
                const isNeg = c.name.toLowerCase().includes(\"otráv\") || c.name.toLowerCase().includes(\"zraně\") || c.name.toLowerCase().includes(\"zlom\") || c.name.toLowerCase().includes(\"proklet\");
                const isPos = c.name.toLowerCase().includes(\"požehn\") || c.name.toLowerCase().includes(\"posíl\") || c.name.toLowerCase().includes(\"ochran\");
                const color = isNeg ? \"var(--color-danger)\" : isPos ? \"var(--color-success)\" : \"var(--color-brass)\";
                return (
                  <span key={i} className=\"rounded-full px-2 py-0.5 text-xs\" style={{ backgroundColor: color + \"20\", color, border: \"1px solid \" + color + \"40\" }}>
                    {c.name}{c.description ? \": \" + c.description : \"\"}
                  </span>
                );
              })}
            </div>
          </div>
        )}'''
curr = curr.replace('{/* Save button */}', insert2 + '\n\n      {/* Save button */}')
with open('src/ui/personas/PersonaForm.tsx', 'w') as f: f.write(curr)
print('PersonaForm done')
"

# 6. i18n — add condition keys
python3 -c "
import json
for lang in ['cs', 'en']:
    with open(f'src/i18n/{lang}.json') as f: d = json.load(f)
    if 'conditions' not in d.get('personas', {}).get('form', {}).get('fields', {}):
        d['personas']['form']['fields']['conditions'] = {'cs': 'Stavy', 'en': 'Conditions'}[lang]
    with open(f'src/i18n/{lang}.json', 'w') as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
        f.write('\\n')
print('i18n done')
"

echo "=== MERGE COMPLETE ==="
