import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const roots = ['apps/dashboard/src', 'apps/portal/src', 'apps/widget/src', 'packages/ui/src'];
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
  const configFiles = ['apps/dashboard/vite.config.ts', 'apps/dashboard/vite.config.js', 'package.json', 'apps/dashboard/package.json', 'apps/portal/package.json', 'apps/widget/package.json', 'packages/ui/package.json']
    .filter((path) => { try { readFileSync(join(root, path)); return true; } catch { return false; } });
  const matches = configFiles.filter((path) => legacyImport.test(readFileSync(join(root, path), 'utf8')));
  assert.deepEqual(matches, [], `legacy active references found in: ${matches.join(', ')}`);
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

test('direct Phosphor JSX icons are explicitly decorative or labelled', () => {
  const offenders = sourceFiles.flatMap((path) => {
    const content = readFileSync(join(root, path), 'utf8');
    if (!content.includes("from '@phosphor-icons/react'")) return [];
    const imported = content.match(/import\s*\{([^}]*)\}\s*from\s*'@phosphor-icons\/react'/)?.[1] ?? '';
    const names = imported.split(',').map((part) => part.trim().split(/\s+as\s+/).pop()).filter(Boolean);
    return names.filter((name) => new RegExp(`<${name}\\b(?=[^>]*>)`).test(content) && !new RegExp(`<${name}\\b[^>]*(?:aria-hidden|aria-label)`).test(content)).map(() => path);
  });
  assert.deepEqual(offenders, [], `direct Phosphor icons without aria-hidden or aria-label found in: ${offenders.join(', ')}`);
});
