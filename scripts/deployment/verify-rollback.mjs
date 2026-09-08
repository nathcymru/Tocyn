import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { verifyReleaseArtifact } from './verify-release-artifact.mjs';

export function verifyRollback({ provenancePath, env = process.env, verifyArtifact = verifyReleaseArtifact }) {
if (!provenancePath) throw new Error('Usage: verify-rollback.mjs <provenance.json>');
const provenance = JSON.parse(readFileSync(provenancePath, 'utf8'));
const target = env.TOCYN_RELEASE_TARGET;
if (!['preview', 'beta'].includes(target || '')) throw new Error('A protected rollback target is required');
const expectedRevision = env.TOCYN_KNOWN_GOOD_REVISION;
const expectedDigest = env.TOCYN_KNOWN_GOOD_RELEASE_DIGEST;
if (!/^[0-9a-f]{40}$/i.test(expectedRevision || '')) throw new Error('A protected known-good revision is required for rollback');
if (!/^[0-9a-f]{64}$/i.test(expectedDigest || '')) throw new Error('A protected known-good release digest is required for rollback');
if (provenance.revision !== expectedRevision || provenance.releaseDigest !== expectedDigest) {
  throw new Error('Rollback candidate does not match the recorded known-good immutable release');
}
if (!provenance.providerReceiptDigest) throw new Error('Rollback candidate has no recorded provider receipt');
verifyArtifact(dirname(provenancePath), target);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  verifyRollback({ provenancePath: process.argv[2] });
}
