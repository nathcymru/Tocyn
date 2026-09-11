"""Reproduce remaining-work scenarios with the unchanged reference scheduler."""
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent
inputs = json.loads((ROOT / 'planning-input.json').read_text())
evidence = json.loads((ROOT / 'reforecast-evidence.json').read_text())
results = {}
for scenario in ('lower', 'central', 'upper'):
    current = json.loads(json.dumps(inputs))
    for node in current['nodes']:
        estimate = evidence['remainingEffortEstimates'].get(str(node['number']))
        if estimate:
            node['effort'] = estimate[scenario]
    with tempfile.TemporaryDirectory() as temporary:
        directory = Path(temporary)
        (directory / 'planning-input.json').write_text(json.dumps(current))
        for name in ('schedule.py', 'baseline-snapshot.json'):
            shutil.copyfile(ROOT / name, directory / name)
        subprocess.run([sys.executable, str(directory / 'schedule.py')], check=True)
        forecast = json.loads((directory / 'forecast.json').read_text())
    original = {node['number']: node for node in inputs['nodes']}
    nodes = {node['number']: node for node in forecast['nodes']}
    for number, node in nodes.items():
        for field in ('baselineStart', 'baselineTarget', 'actualCompletion', 'progress'):
            assert node.get(field) == original[number].get(field), (number, field)
    ancestors = set()
    def visit(number):
        if number in ancestors:
            return
        ancestors.add(number)
        for dependency in nodes[number]['dependencies']:
            visit(dependency)
    visit(140)
    assert forecast['beta2Forecast'] == evidence['range'][scenario]
    results[scenario] = {
        'beta2Forecast': forecast['beta2Forecast'],
        'remainingPlanningHours': sum(nodes[number]['remainingPlanningHours'] for number in ancestors),
        'betaPrerequisites': [{key: node.get(key) for key in
                              ('number', 'forecastStart', 'forecastTarget', 'remainingPlanningHours')}
                             for number, node in sorted(nodes.items())
                             if number in ancestors and not node['done']],
    }
output = json.dumps(results, indent=2) + '\n'
target = ROOT / 'reforecast-scenarios.json'
if '--check' in sys.argv:
    assert target.read_text() == output, 'Scenario output differs'
else:
    target.write_text(output)
print('Scenario calculations and unchanged baseline/actual/progress fields: PASS')
