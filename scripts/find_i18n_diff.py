import json
cs=json.load(open('src/i18n/cs.json'))
en=json.load(open('src/i18n/en.json'))

def find_keys(d, path=''):
    keys=[]
    for k,v in d.items():
        p = f'{path}.{k}' if path else k
        if isinstance(v, dict): keys.extend(find_keys(v, p))
        else: keys.append(p)
    return keys

cs_keys=set(find_keys(cs))
en_keys=set(find_keys(en))
for k in sorted(cs_keys-en_keys):
    parts=k.split('.')
    obj=cs
    for p in parts: obj=obj.get(p,{})
    print(f'{k} = {obj}')

print('---')
for k in sorted(en_keys-cs_keys):
    parts=k.split('.')
    obj=en
    for p in parts: obj=obj.get(p,{})
    print(f'{k} = {obj}')
