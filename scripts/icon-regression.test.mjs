import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { iconJsxFailures } from './icon-jsx-audit.mjs';

const root = new URL('..', import.meta.url).pathname;
const roots = ['apps/dashboard/src', 'apps/portal/src', 'apps/widget/src', 'packages/ui/src', 'tools/ui-browser'];
const legacyImport = /(?:lucide-react|react-icons|@fortawesome|fontawesome|iconify|@iconify|react-icons\/fa6|@uiw\/react-md-editor|\bMDEditor\b)/i;
const legacyFaAlias = /\bFa(?:AlignLeft|Arrow|Bars|Bell|Bolt|Book|Building|Calendar|Chart|Check|Chevron|Circle|Clock|Cloud|Copy|Credit|Database|Diagram|Ellipsis|Envelope|Eye|File|Filter|Floppy|Folder|Font|Gear|Hard|Key|List|Magnifying|Message|Micro|Paper|Pen|Plus|Right|Shield|Spinner|Square|Table|Ticket|Toggle|Trash|Triangle|User|Users|Wifi|Wp|Xmark)/;
const legacyPackage = /(?:lucide-react|react-icons|@fortawesome|fontawesome|iconify|@iconify|@uiw\/react-md-editor)/i;


function files(dir) {
  const absolute = join(root, dir);
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return files(path);
    return /\.(?:tsx?|jsx?|json|css|mjs)$/.test(entry.name) ? [path] : [];
  });
}

const sourceFiles = roots.flatMap(files);

test('application source has no legacy icon-library imports', () => {
  const matches = sourceFiles.flatMap((path) => {
    const content = readFileSync(join(root, path), 'utf8');
    return legacyImport.test(content) || legacyFaAlias.test(content) ? [path] : [];
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

test('active build configuration and tests have no legacy icon/editor references', () => {
  const configFiles = ['apps/dashboard/vite.config.ts', 'apps/portal/vite.config.ts', 'apps/widget/vite.config.ts', 'apps/dashboard/postcss.config.js', 'apps/portal/postcss.config.js', 'apps/widget/postcss.config.js', 'packages/ui/panda.config.ts', 'package.json', 'apps/dashboard/package.json', 'apps/portal/package.json', 'apps/widget/package.json', 'packages/ui/package.json']
    .filter((path) => { try { readFileSync(join(root, path)); return true; } catch { return false; } });
  const matches = configFiles.filter((path) => legacyImport.test(readFileSync(join(root, path), 'utf8')));
  assert.deepEqual(matches, [], `legacy active references found in: ${matches.join(', ')}`);
});

test('shared Phosphor boundary enforces duotone icons', () => {
  const content = readFileSync(join(root, 'packages/ui/src/icons.tsx'), 'utf8');
  assert.match(content, /weight="duotone"/);
  assert.match(content, /aria-hidden=\{props\['aria-label'\] \? undefined : true\}/);
});

test('AST guard checks all active icon JSX and icon-only control names', () => {
  const failures = sourceFiles.flatMap(path => iconJsxFailures(path, readFileSync(join(root, path), 'utf8')));
  assert.deepEqual(failures, []);
});

test('AST guard checks a later aliased vendor import', () => {
  const input = `import { Plus } from '@phosphor-icons/react';
    import { Trash as Delete } from '@phosphor-icons/react';
    <><Plus weight="duotone" aria-hidden="true" /><Delete aria-hidden="true" /></>`;
  assert.match(iconJsxFailures('apps/dashboard/src/Example.tsx', input).join('\n'), /Delete requires weight="duotone"/);
});

test('AST guard checks namespaced vendor JSX and hides icons inside named controls', () => {
  const namespace = `import * as Glyphs from '@phosphor-icons/react'; <Glyphs.Plus aria-hidden="true" />`;
  assert.match(iconJsxFailures('apps/dashboard/src/Example.tsx', namespace).join('\n'), /Glyphs\.Plus requires weight="duotone"/);
  const duplicateName = `import { Plus } from '@phosphor-icons/react'; <button aria-label="Add"><Plus weight="duotone" aria-label="Plus" /></button>`;
  assert.match(iconJsxFailures('apps/dashboard/src/Example.tsx', duplicateName).join('\n'), /requires aria-hidden="true"/);
});

test('AST guard requires a decorative or semantic name on direct vendor JSX', () => {
  const input = `import { Plus } from '@phosphor-icons/react'; <Plus weight="duotone" />`;
  assert.match(iconJsxFailures('apps/dashboard/src/Example.tsx', input).join('\n'), /requires aria-hidden="true"/);
  assert.deepEqual(iconJsxFailures('apps/dashboard/src/Example.tsx', input.replace('/>', 'aria-label="Add" />')), []);
  assert.match(iconJsxFailures('apps/dashboard/src/Example.tsx', input.replace('/>', 'aria-label="" />')).join('\n'), /requires aria-hidden="true"/);
  assert.match(iconJsxFailures('apps/dashboard/src/Example.tsx', input.replace('weight="duotone"', 'weight="bold"').replace('/>', 'aria-hidden="true" />')).join('\n'), /requires weight="duotone"/);
  assert.match(iconJsxFailures('apps/dashboard/src/Example.tsx', input.replace('/>', 'aria-hidden="false" />')).join('\n'), /requires aria-hidden="true"/);
});

test('AST guard rejects title-only icon controls while accepting labelled or text buttons', () => {
  const input = `import { IconPlus } from '@luminatick/ui/icons'; <ParkButton title="Add"><IconPlus /></ParkButton>`;
  assert.match(iconJsxFailures('apps/dashboard/src/Example.tsx', input).join('\n'), /icon-only ParkButton requires aria-label/);
  assert.deepEqual(iconJsxFailures('apps/dashboard/src/Example.tsx', input.replace('title="Add"', 'aria-label="Add"')), []);
  assert.match(iconJsxFailures('apps/dashboard/src/Example.tsx', input.replace('title="Add"', 'aria-label=""')).join('\n'), /requires aria-label/);
  assert.match(iconJsxFailures('apps/dashboard/src/Example.tsx', input.replace('title="Add"', "aria-label={''}")).join('\n'), /requires aria-label/);
  assert.match(iconJsxFailures('apps/dashboard/src/Example.tsx', input.replace('title="Add"', 'aria-label={undefined}')).join('\n'), /requires aria-label/);
  assert.deepEqual(iconJsxFailures('apps/dashboard/src/Example.tsx', input.replace('</ParkButton>', 'Add</ParkButton>')), []);
  assert.deepEqual(iconJsxFailures('packages/ui/src/Example.tsx', input.replace('<ParkButton title="Add">', '<IconButton as="span">').replace('</ParkButton>', '</IconButton>')), []);
});

test('AST guard finds namespace-imported shared icons in icon-only controls', () => {
  const input = `import * as Icons from '@luminatick/ui/icons'; <ParkButton><Icons.IconPlus /></ParkButton>`;
  assert.match(iconJsxFailures('apps/dashboard/src/Example.tsx', input).join('\n'), /icon-only ParkButton requires aria-label/);
  assert.deepEqual(iconJsxFailures('apps/dashboard/src/Example.tsx', input.replace('<ParkButton>', '<ParkButton aria-label="Add">')), []);
});

test('AST guard recognizes conditional known icons without rejecting text alternatives', () => {
  const imports = `import { IconPlus, IconTrash } from '@luminatick/ui/icons';`;
  const iconBranches = `${imports} <ParkButton>{choice ? <IconPlus /> : <IconTrash />}</ParkButton>`;
  const optionalIcon = `${imports} <ParkButton>{choice && <IconPlus />}</ParkButton>`;
  const textAlternative = `${imports} <ParkButton>{choice ? <IconPlus /> : 'Add'}</ParkButton>`;
  assert.match(iconJsxFailures('apps/dashboard/src/Example.tsx', iconBranches).join('\n'), /icon-only ParkButton requires aria-label/);
  assert.match(iconJsxFailures('apps/dashboard/src/Example.tsx', optionalIcon).join('\n'), /icon-only ParkButton requires aria-label/);
  assert.deepEqual(iconJsxFailures('apps/dashboard/src/Example.tsx', textAlternative), []);
});

test('AST guard inspects the actual element rendered by a button asChild', () => {
  const importIcon = `import { IconPlus } from '@luminatick/ui/icons';`;
  const unnamed = `${importIcon} <ParkButton asChild><a href="/add"><IconPlus /></a></ParkButton>`;
  const namedChild = `${importIcon} <ParkButton asChild><a href="/add" aria-label="Add"><IconPlus /></a></ParkButton>`;
  const namedParent = `${importIcon} <ParkButton asChild aria-label="Add"><a href="/add"><IconPlus /></a></ParkButton>`;
  const text = `${importIcon} <ParkButton asChild><a href="/add"><IconPlus />Add</a></ParkButton>`;
  assert.match(iconJsxFailures('apps/dashboard/src/Example.tsx', unnamed).join('\n'), /icon-only ParkButton requires aria-label/);
  assert.deepEqual(iconJsxFailures('apps/dashboard/src/Example.tsx', namedChild), []);
  assert.deepEqual(iconJsxFailures('apps/dashboard/src/Example.tsx', namedParent), []);
  assert.deepEqual(iconJsxFailures('apps/dashboard/src/Example.tsx', text), []);
});

test('AST guard checks an IconButton rendered as an interactive span', () => {
  const importIcon = `import { IconPlus } from '@luminatick/ui/icons';`;
  const interactive = `${importIcon} <IconButton as="span" role="button" tabIndex={0}><IconPlus /></IconButton>`;
  const decorative = `${importIcon} <IconButton as="span"><IconPlus /></IconButton>`;
  assert.match(iconJsxFailures('packages/ui/src/Example.tsx', interactive).join('\n'), /icon-only IconButton requires aria-label/);
  assert.deepEqual(iconJsxFailures('packages/ui/src/Example.tsx', decorative), []);
});

test('AST guard accepts a standalone icon labelled by reference but hides one inside a named control', () => {
  const importIcon = `import { Plus } from '@phosphor-icons/react';`;
  const standalone = `${importIcon} <><span id="add-label">Add</span><Plus weight="duotone" aria-labelledby="add-label" /></>`;
  const duplicate = `${importIcon} <button aria-label="Add"><Plus weight="duotone" aria-labelledby="add-label" /></button>`;
  const hidden = `${importIcon} <button aria-label="Add"><Plus weight="duotone" aria-hidden="true" /></button>`;
  assert.deepEqual(iconJsxFailures('apps/dashboard/src/Example.tsx', standalone), []);
  assert.match(iconJsxFailures('apps/dashboard/src/Example.tsx', duplicate).join('\n'), /requires aria-hidden="true"/);
  assert.deepEqual(iconJsxFailures('apps/dashboard/src/Example.tsx', hidden), []);
});
