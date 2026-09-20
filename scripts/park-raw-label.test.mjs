import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { parkRawLabelFailure } from './park-raw-label.mjs';

function failures(relative, content) {
  const source = ts.createSourceFile(relative, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = [];
  function inspect(node) {
    const failure = parkRawLabelFailure(relative, node, source);
    if (failure) found.push(failure);
    ts.forEachChild(node, inspect);
  }
  inspect(source);
  return found;
}

test('rejects opening and self-closing raw labels in active app TSX', () => {
  const source = `<><label htmlFor="name">Name</label>\n<label /></>`;
  for (const app of ['dashboard', 'portal', 'widget']) {
    const relative = `apps/${app}/src/App.tsx`;
    assert.deepEqual(failures(relative, source), [
      `Native label remains in active application source: ${relative}:1`,
      `Native label remains in active application source: ${relative}:2`,
    ]);
  }
});

test('allows official Park label slots and non-app files', () => {
  const source = `<><Field.Label>Name</Field.Label><ParkField.Label>Value</ParkField.Label>
    <ParkSelect.Label>Type</ParkSelect.Label><ParkCheckbox.Label>Enabled</ParkCheckbox.Label></>`;
  assert.deepEqual(failures('apps/dashboard/src/App.tsx', source), []);
  assert.deepEqual(failures('apps/dashboard/src/__tests__/Example.test.tsx', '<label>Fixture</label>'), []);
  assert.deepEqual(failures('apps/portal/src/Example.spec.tsx', '<label>Fixture</label>'), []);
  assert.deepEqual(failures('docs/example.tsx', '<label>Example</label>'), []);
});
