import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const output = readdirSync('dist');
assert.ok(output.includes('lumina-widget.js'), 'Widget IIFE is missing');
assert.deepEqual(output.filter(name => name.endsWith('.css')), [],
  'Widget fonts must not require a separate host stylesheet');

const bundle = readFileSync('dist/lumina-widget.js', 'utf8');
for (const font of ['Atkinson Hyperlegible', 'Inter']) {
  assert.ok(bundle.includes(`font-family:${font}`), `${font} font faces are missing from the IIFE`);
}
assert.ok((bundle.match(/@font-face/g) ?? []).length >= 5, 'Widget font faces are missing');
assert.ok(bundle.includes('data:font/woff2;base64,'), 'Widget fonts must be bundled locally');
assert.ok(bundle.includes('--fonts-primary') && bundle.includes('.button--variant_solid'),
  'Panda and Park rules are missing from the ShadowRoot stylesheet');
process.stdout.write('Widget IIFE contains local Atkinson/Inter faces and Park/Panda CSS; no host stylesheet is required.\n');
