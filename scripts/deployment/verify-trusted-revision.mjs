import { execFileSync } from 'node:child_process';

const revision = process.env.TOCYN_REVISION;
if (!/^[0-9a-f]{40}$/i.test(revision || '')) throw new Error('A full immutable revision SHA is required');
const git = args => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
git(['cat-file', '--e', `${revision}^{commit}`]);
try { git(['merge-base', '--is-ancestor', revision, 'origin/main']); }
catch { throw new Error('Requested revision is not reachable from trusted origin/main'); }
git(['checkout', '--detach', revision]);
