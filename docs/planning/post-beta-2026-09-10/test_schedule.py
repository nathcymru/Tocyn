"""Regression checks for immutable baselines and accepted dependency availability."""
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent


class ScheduleHistoryTests(unittest.TestCase):
    def test_completed_new_issue_preserves_history_and_unlocks_only_after_acceptance(self):
        completed = dict(number=127, dependencies=[], done=True, effort=12, new=True,
                         baselineStart='2026-09-11', baselineTarget='2026-09-19',
                         forecastStart='2026-09-11', forecastTarget='2026-09-19',
                         actualCompletion='2026-09-20', progress=100)
        pending = dict(number=140, dependencies=[127], done=False, effort=8, new=True,
                       baselineStart='2027-02-11', baselineTarget='2027-02-18',
                       actualCompletion=None, progress=0)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            shutil.copyfile(ROOT / 'schedule.py', root / 'schedule.py')
            (root / 'planning-input.json').write_text(json.dumps({
                'anchor': '2026-09-11', 'nodes': [completed, pending]}))
            (root / 'baseline-snapshot.json').write_text('{"items": []}')
            subprocess.run([sys.executable, str(root / 'schedule.py')], check=True)
            result = json.loads((root / 'forecast.json').read_text())
            nodes = {node['number']: node for node in result['nodes']}
            self.assertEqual(nodes[127]['forecastStart'], completed['forecastStart'])
            self.assertEqual(nodes[127]['forecastTarget'], completed['forecastTarget'])
            self.assertEqual(nodes[127]['remainingPlanningHours'], 0)
            self.assertGreater(nodes[140]['forecastStart'], completed['actualCompletion'])
            for original in [completed, pending]:
                for field in ['baselineStart', 'baselineTarget']:
                    self.assertEqual(nodes[original['number']][field], original[field])
            self.assertEqual((root / 'baseline-snapshot.json').read_text(), '{"items": []}')
            subprocess.run([sys.executable, str(root / 'schedule.py'), '--check'], check=True)


if __name__ == '__main__':
    unittest.main()
