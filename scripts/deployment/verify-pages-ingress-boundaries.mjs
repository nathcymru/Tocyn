import { writeFileSync } from 'node:fs';
import { verifyProviderResources } from './verify-provider-resources.mjs';

const [release, environment, output] = process.argv.slice(2);
if (!release || !output || !['preview', 'beta'].includes(environment)) throw new Error('Usage: verify-pages-ingress-boundaries.mjs <release> <preview|beta> <output.json>');

// This runs after Pages publication but before service-token credentials are made
// available. It discovers every current Pages alias and proves each has Access.
const receipt = await verifyProviderResources({ release, environment, writeReceipt: false });
writeFileSync(output, `${JSON.stringify({ pages: receipt.observedPages }, null, 2)}\n`);
