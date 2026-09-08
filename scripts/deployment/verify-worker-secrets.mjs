import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const [config] = process.argv.slice(2);
if (!config || basename(config) !== 'wrangler.deploy.json') throw new Error('Usage: verify-worker-secrets.mjs <path/to/wrangler.deploy.json>');
const manifest = JSON.parse(readFileSync(join(dirname(config), 'binding-manifest.json'), 'utf8'));
const output = execFileSync('npx', ['wrangler', 'secret', 'list', '--format', 'json', '--config', config], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
});
const present = new Set(JSON.parse(output).map(secret => secret.name));
const missing = manifest.requiredSecrets.filter(name => !present.has(name));
if (missing.length) throw new Error(`Required Worker secrets are absent: ${missing.join(', ')}`);
