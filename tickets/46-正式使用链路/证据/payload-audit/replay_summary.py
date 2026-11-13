"""记录回放汇总：读 replay.test.ts 写出的 replay.json。用法：python replay_summary.py <replay.json>"""
import json,sys,collections
data=json.load(open(sys.argv[1],encoding='utf8'))
calls=data['calls']
print('calls',len(calls),'valid',sum(c['ok'] for c in calls),'write calls',sum(1 for c in calls if c.get('write')),'loads',data['loads'])
for c in calls:
    if not c['ok']: print('INVALID',c['name'],c.get('error','')[:400].replace('\n',' | '))
agg=collections.defaultdict(lambda:[0,0,0])
for c in calls:
    if c.get('before'):
        a=agg[c['name']]; a[0]+=1; a[1]+=c['before']; a[2]+=c['after']
tb=sum(v[1] for v in agg.values()); ta=sum(v[2] for v in agg.values())
print('parsed results',sum(v[0] for v in agg.values()),'chars before',tb,'after',ta, f'{1-ta/tb:.1%}')
for k,v in sorted(agg.items(), key=lambda kv:-kv[1][1]):
    print(f'  {k:<40}{v[0]:>4}{v[1]:>9}{v[2]:>9}{1-v[2]/v[1]:>8.1%}')
