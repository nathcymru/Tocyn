import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { parkTailwindClassFailure } from './park-tailwind-class.mjs';

function failures(relative, content) {
  const source = ts.createSourceFile(relative, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = [];
  function inspect(node) {
    const failure = parkTailwindClassFailure(relative, node, source);
    if (failure) found.push(failure);
    ts.forEachChild(node, inspect);
  }
  inspect(source);
  return found;
}

test('rejects static and conditional Tailwind class names on active surfaces', () => {
  const relative = 'apps/dashboard/src/pages/Example.tsx';
  assert.deepEqual(failures(relative, `<><div className="px-4 text-sm" />\n<div className={ready ? 'dark:bg-slate-900' : styles.root} /></>`), [
    `Tailwind utility px-4 in active application className: ${relative}:1`,
    `Tailwind utility dark:bg-slate-900 in active application className: ${relative}:2`,
  ]);
  assert.equal(failures('packages/ui/src/Example.tsx', '<div className={`rounded-lg ${name}`} />').length, 1);
  assert.equal(failures(relative, '<div className="flex items-center overflow-hidden" />').length, 1);
});

test('follows same-file const strings and simple alias chains used by className', () => {
  const relative = 'apps/dashboard/src/pages/Example.tsx';
  const content = `const utility = 'px-4';
const first = utility;
function Example() {
  const second = first;
  return <div className={second} />;
}`;
  assert.deepEqual(failures(relative, content), [
    `Tailwind utility px-4 in active application className: ${relative}:5`,
  ]);
  assert.equal(failures(relative, 'const utility = `rounded-lg`; <div className={utility} />').length, 1);
});

test('ignores unrelated strings and respects local bindings that shadow outer consts', () => {
  const relative = 'apps/dashboard/src/pages/Example.tsx';
  assert.deepEqual(failures(relative, `const unused = 'px-4'; <div className={styles.root} />`), []);
  assert.deepEqual(failures(relative, `const value = 'px-4'; function Example(value) { return <div className={value} />; }`), []);
  assert.deepEqual(failures(relative, `const value = 'px-4'; function Example() { const value = styles.root; return <div className={value} />; }`), []);
  assert.deepEqual(failures(relative, `const value = 'px-4'; <div className={css({ display: 'grid' })} />`), []);
});

test('allows Panda and Park classes, tests, historical documents, and widget CSS hook', () => {
  const content = `<><div className={css({ px: '4', bg: 'bg.surface' })} />
    <div className="button button--variant_solid" /><div className={styles.root} /></>`;
  assert.deepEqual(failures('apps/portal/src/App.tsx', content), []);
  assert.deepEqual(failures('apps/portal/src/App.tsx', '<div className={clsx(css({ display: "grid" }), styles.root)} />'), []);
  assert.equal(failures('apps/portal/src/App.tsx', '<div className={clsx(css({ display: "grid" }), "px-4")} />').length, 1);
  assert.deepEqual(failures('apps/dashboard/src/__tests__/Example.test.tsx', '<div className="px-4" />'), []);
  assert.deepEqual(failures('docs/example.tsx', '<div className="px-4" />'), []);
  assert.deepEqual(failures('apps/widget/src/App.tsx', 'const css = LUMINA_WIDGET_CSS; <div className={styles.root} />'), []);
});
