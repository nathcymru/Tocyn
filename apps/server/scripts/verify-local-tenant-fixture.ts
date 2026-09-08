import { verifyTwoTenantFixture } from './local-tenant-fixture';

async function main(): Promise<void> {
  try {
    const report = await verifyTwoTenantFixture();
    // This report is intentionally credential-free; do not add fixture handles here.
    console.log(JSON.stringify(report));
  } catch (error) {
    console.error(`Local tenant fixture verification failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    process.exitCode = 1;
  }
}

void main();
