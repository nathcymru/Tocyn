"""Offline integrity checks for the reconciled source ledger and capacity forecast."""
import hashlib
import json
import re
import runpy
import zipfile
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ledger = json.loads((ROOT / 'traceability.json').read_text())
forecast = json.loads((ROOT / 'forecast.json').read_text())
requirements = ledger['requirements']
assert len(ledger['files']) == 54
assert len({r['id'] for r in requirements}) == len(requirements)
records = {(r['source']['archive'], r['source']['file'], r['source']['line']): r for r in requirements}
for archive, metadata in ledger['archives'].items():
    path = ROOT / 'sources' / metadata['file']
    assert hashlib.sha256(path.read_bytes()).hexdigest() == metadata['sha256']
    with zipfile.ZipFile(path) as source:
        for f in (f for f in ledger['files'] if f['archive'] == archive):
            content = source.read(f['file'])
            assert hashlib.sha256(content).hexdigest() == f['sha256']
            for line_number, text in enumerate(content.decode().splitlines(), 1):
                if not text.strip() or re.match(r'^#{1,6}\s', text) or re.fullmatch(r'[|\s:—-]+', text) or text.startswith('```'):
                    continue
                record = records[archive, f['file'], line_number]
                assert record['text'] == text
                assert record['owningIssues'] and record['implementationStatus'] and record['disposition']

nodes = {n['number']: n for n in forecast['nodes']}
assert len(nodes) == len(forecast['nodes'])
for r in requirements:
    assert all(n in nodes or n == 126 for n in r['owningIssues'])
assert len([n for n in nodes.values() if n.get('alias', '').startswith('NEW-UX')]) == 14
assert len([n for n in nodes.values() if n.get('alias', '').startswith('PG-') and n.get('alias') != 'PG-GOV-00']) == 17
assert {159, 160, 161, 162}.issubset(nodes)
for n, prerequisites in {64:[50],91:[50],51:[50,64,91],87:[51],88:[87],152:[151],76:[152],77:[152],73:[136,162],137:[73,79,162],140:[73,137]}.items():
    assert set(prerequisites).issubset(nodes[n]['dependencies']), (n, prerequisites)
assert not {76,77}.intersection(nodes[152]['dependencies'])
assert 67 not in nodes[128]['dependencies']
lanes = defaultdict(list)
anchor = date.fromisoformat(forecast['anchor'])
for node in nodes.values():
    if node['done']:
        continue
    start, end = map(date.fromisoformat, (node['forecastStart'], node['forecastTarget']))
    assert anchor <= start <= end
    assert start.weekday() != 6 and end.weekday() != 6
    assert node['remainingPlanningHours'] == 3 * node['effort']
    for dep in node['dependencies']:
        if not nodes[dep]['done']:
            assert nodes[dep]['forecastTarget'] < node['forecastStart'], (node['number'], dep)
    lanes[node['workstream']].append((start,end,node['number']))
assert len(lanes) == 2
for tasks in lanes.values():
    tasks.sort()
    assert all(a[1] < b[0] for a,b in zip(tasks,tasks[1:]))
# Exercise the real scheduling calculation, including cycle detection and shared review capacity.
import sys
saved = sys.argv
sys.argv = ['schedule.py', '--check']
computed = runpy.run_path(str(ROOT / 'schedule.py'))
sys.argv = saved
assert all(0 <= h <= 4 for h in computed['review'])
assert sum(computed['review']) == sum(n['effort'] * .5 for n in nodes.values() if not n['done'])
print(f'PASS: 54 files, {len(requirements)} source clauses, {len(nodes)} graph nodes, dependency/lane/review-capacity invariants')
