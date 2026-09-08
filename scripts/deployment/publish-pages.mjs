import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { verifyReleaseArtifact } from './verify-release-artifact.mjs';

const [release, environment] = process.argv.slice(2);
const { bindings } = verifyReleaseArtifact(release, environment);
for (const [app, resource] of [['dashboard', 'dashboardPagesProject'], ['portal', 'portalPagesProject']]) {
  const directory = join(release, 'frontend', app);
  if (!existsSync(directory)) throw new Error(`${app} artifact is absent`);
  execFileSync('npx', ['wrangler', 'pages', 'deploy', directory, '--project-name', bindings.resources[resource]], { stdio: 'inherit' });
}
