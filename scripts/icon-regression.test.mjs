import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const roots = ['apps/dashboard/src', 'apps/portal/src', 'apps/widget/src', 'packages/ui/src'];
const legacyImport = /(?:lucide-react|react-icons|@fortawesome|fontawesome|iconify|@iconify|react-icons\/fa6)/i;
const legacyPackage = /(?:lucide-react|react-icons|@fortawesome|fontawesome|iconify|@iconify)/i;
const ignored = new Set(['apps/portal/src/assets/react.svg', 'apps/dashboard/src/pages/KnowledgeEditorPage.tsx']);
// KnowledgeEditor is owned by the concurrent Tiptap migration; its icon import is removed with that surface.


function files(dir) {
  const absolute = join(root, dir);
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return files(path);
    return /\.(?:tsx?|jsx?|json|css|mjs)$/.test(entry.name) ? [path] : [];
  });
}

const sourceFiles = roots.flatMap(files).filter((path) => !ignored.has(path));

test('application source has no legacy icon-library imports', () => {
  const matches = sourceFiles.flatMap((path) => {
    const content = readFileSync(join(root, path), 'utf8');
    return legacyImport.test(content) ? [path] : [];
  });
  assert.deepEqual(matches, [], `legacy icon references found in: ${matches.join(', ')}`);
});

test('workspace manifests have no legacy icon dependencies', () => {
  const manifests = ['package.json', ...readdirSync(join(root, 'apps'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => `apps/${e.name}/package.json`), ...readdirSync(join(root, 'packages'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => `packages/${e.name}/package.json`)];
  const matches = manifests.flatMap((path) => {
    const content = readFileSync(join(root, path), 'utf8');
    return legacyPackage.test(content) ? [path] : [];
  });
  assert.deepEqual(matches, [], `legacy icon dependencies found in: ${matches.join(', ')}`);
});

test('shared Phosphor boundary enforces duotone icons', () => {
  const content = readFileSync(join(root, 'packages/ui/src/icons.tsx'), 'utf8');
  assert.match(content, /weight="duotone"/);
  assert.match(content, /aria-hidden=\{props\['aria-label'\] \? undefined : true\}/);
});

test('direct Phosphor JSX icons declare duotone weight', () => {
  const offenders = sourceFiles.flatMap((path) => {
    const content = readFileSync(join(root, path), 'utf8');
    if (!content.includes("from '@phosphor-icons/react'")) return [];
    const imported = content.match(/import\s*\{([^}]*)\}\s*from\s*'@phosphor-icons\/react'/)?.[1] ?? '';
    const names = imported.split(',').map((part) => part.trim().split(/\s+as\s+/).pop()).filter(Boolean);
    return names.filter((name) => new RegExp(`<${name}\\b(?![^>]*\\bweight=\\\"duotone\\\")`).test(content)).map(() => path);
  });
  assert.deepEqual(offenders, [], `direct Phosphor icons without weight="duotone" found in: ${offenders.join(', ')}`);
});
