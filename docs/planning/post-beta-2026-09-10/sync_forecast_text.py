"""Render current forecast tables/paragraphs without changing baseline or historical records."""
from pathlib import Path
import json,re,sys
r=Path(__file__).resolve().parent;f=json.loads((r/'forecast.json').read_text());nodes={n['number']:n for n in f['nodes']}
def save(p, text):
 if '--check' in sys.argv:
  assert p.read_text()==text, f'Forecast text differs: {p}'
 else:p.write_text(text)
rows=['| Issue | Remaining 3× hours | Lane | Forecast | Prerequisites |','|---|---:|---|---|---|']
for n in sorted((n for n in nodes.values() if not n['done']),key=lambda n:(n['forecastStart'],n['number'])):
 rows.append(f"| [#{n['number']}](https://github.com/nathcymru/Tocyn/issues/{n['number']}) {n['title']} | {n['remainingPlanningHours']:g} | {n['workstream']} | {n['forecastStart']} → {n['forecastTarget']} | {', '.join('#'+str(d) for d in n['dependencies'])} |")
for p in [r/'roadmap.md',r.parents[1]/'wiki-sync/Approved-architectural-roadmap.md',r.parents[1]/'wiki-sync/Omnichannel-implementation-roadmap.md']:
 s=p.read_text();s=re.sub(r'Beta\.2 gate forecast: \*\*[^*]+\*\*',f"Beta.2 gate forecast: **{f['beta2Forecast']}**",s);s=re.sub(r'Expanded scope forecast: \*\*[^*]+\*\*',f"Expanded scope forecast: **{f['expandedForecast']}**",s);s=re.sub(r'Dependency-only critical network length: \d+ planning hours',f"Dependency-only critical network length: {f['dependencyOnlyHours']:g} planning hours",s)
 s=re.sub(r'\| Issue \| Remaining 3× hours[^\n]*\n(?:\|[^\n]*\n)+','\n'.join(rows)+'\n',s)
 s=s.replace('#50/#160 remain unaccepted.', '#50 and #160 are accepted through signed PRs #165 and #166, with Wiki and Project receipts.')
 save(p,s)
for n,v in nodes.items():
 p=r/'issue-bodies'/f'{n}.md'
 if not p.exists():continue
 s=p.read_text();a,sep,b=s.partition('\n<details>\n')
 if v['done'] and n in (48,50,73,79,129,160):
  text=f"Remaining baseline effort: 0h; remaining planning allowance: 0h. Accepted completion: {v['actualCompletion']} (100% of this issue's scoped acceptance). Historical forecast: {v['forecastStart']}–{v['forecastTarget']}."
 elif not v['done']:
  text=f"Remaining baseline effort: {v['effort']:g}h; remaining planning allowance: {v['remainingPlanningHours']:g}h. Forecast: {v['forecastStart']}–{v['forecastTarget']}, {v['workstream']}."
 else:continue
 a=re.sub(r'Remaining baseline effort:.*?(?= Existing baseline history is immutable;)',text,a,flags=re.S)
 save(p,a+sep+b)
print(f['beta2Forecast'],f['expandedForecast'],f['dependencyOnlyHours'])
