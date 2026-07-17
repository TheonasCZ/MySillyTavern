import json

for lang in ['en']:
    with open(f'src/i18n/{lang}.json', 'r') as f:
        d = json.load(f)
    
    # Add chat.list.saved
    if 'chat' in d and 'list' in d['chat'] and 'saved' not in d['chat']['list']:
        d['chat']['list']['saved'] = 'Saved.'
    
    # Add personas.form.saved
    if 'personas' in d and 'form' in d['personas'] and 'saved' not in d['personas']['form']:
        d['personas']['form']['saved'] = 'Saved.'
    
    with open(f'src/i18n/{lang}.json', 'w') as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
        f.write('\n')

print('done')
