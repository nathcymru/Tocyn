import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { convertV4MiniflareOptions, Miniflare, type V4WorkerdStructuredLog } from 'miniflare';
import { splitSql } from './split-sql';

const migrationsDirectory = join(import.meta.dirname, '..', 'migrations');
const tenantId = 'runtime-synthetic-tenant';
const documentId = 'runtime-synthetic-document';

type WorkflowInstance = {
  status: () => Promise<{ status: string; error?: unknown }>;
};

async function waitForTerminal(instance: WorkflowInstance): Promise<{ status: string; error?: unknown }> {
  const deadline = Date.now() + 10_000;
  do {
    const status = await instance.status();
    if (status.status === 'complete' || status.status === 'errored' || status.status === 'terminated') return status;
    await new Promise(resolve => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  throw new Error('Synthetic local Workflow did not reach a terminal state');
}

async function bundledWorker(): Promise<string> {
  const result = await build({
    entryPoints: ['src/index.ts'], bundle: true, format: 'esm', platform: 'neutral', write: false,
    external: ['cloudflare:workers', 'node:crypto'],
  });
  return result.outputFiles[0].text;
}

async function applyMigrations(db: D1Database): Promise<void> {
  for (const name of readdirSync(migrationsDirectory).filter(name => name.endsWith('.sql')).sort()) {
    const statements = splitSql(readFileSync(join(migrationsDirectory, name), 'utf8'));
    await db.batch(statements.map(statement => db.prepare(statement)));
  }
}

async function createRuntime(workerScript: string, localBetaEnabled?: string) {
  const logs: V4WorkerdStructuredLog[] = [];
  const miniflare = new Miniflare(convertV4MiniflareOptions({ workers: [{
    name: 'vectorize-workflow-runtime-proof', modules: true, script: workerScript,
    compatibilityFlags: ['nodejs_compat'],
    d1Databases: { DB: '6d0a2797-a176-4fe0-b392-921c3171bc1b' },
    r2Buckets: ['ATTACHMENTS_BUCKET'],
    // The installed Miniflare AI binding is remote-only. This draft job exercises
    // the real Workflow engine, D1 and R2 bindings without contacting a provider.
    workflows: { VECTORIZE_WORKFLOW: { name: 'vectorize-workflow-runtime-proof', className: 'VectorizeWorkflow', stepLimit: 1 } },
    bindings: {
      ENVIRONMENT: 'test', OBSERVABILITY_MODE: 'isolated-evidence',
      ...(localBetaEnabled === undefined ? {} : { LOCAL_BETA_ENABLED: localBetaEnabled }),
    },
  }], handleStructuredLogs: log => { logs.push(log); } }));
  try {
    const db = await miniflare.getD1Database('DB');
    await applyMigrations(db);
    return { miniflare, db, logs };
  } catch (error) {
    await miniflare.dispose();
    throw error;
  }
}

test('real disposable Miniflare Workflow executes the test evidence path and retains published-only behavior', async () => {
  const { miniflare, db, logs } = await createRuntime(await bundledWorker());
  try {
    await db.prepare('INSERT INTO knowledge_docs (tenant_id, id, title, file_path, status) VALUES (?, ?, ?, ?, ?)')
      .bind(tenantId, documentId, 'Synthetic document', 'runtime/synthetic.md', 'draft').run();
    const bindings = await miniflare.getBindings<{ VECTORIZE_WORKFLOW: { create: (options: { params: unknown }) => Promise<WorkflowInstance> } }>();
    const instance = await bindings.VECTORIZE_WORKFLOW.create({ params: { tenantId, action: 'update', documentId } });
    const status = await waitForTerminal(instance);

    assert.equal(status.status, 'complete');
    assert.equal((await db.prepare('SELECT status FROM knowledge_docs WHERE tenant_id = ? AND id = ?').bind(tenantId, documentId).first<{ status: string }>())?.status, 'draft');
    const bucket = await miniflare.getR2Bucket('ATTACHMENTS_BUCKET') as unknown as R2Bucket;
    assert.deepEqual((await bucket.list()).objects, []);
    const events = logs.map(log => JSON.parse(log.message)).filter((value): value is Record<string, unknown> => value?.type === 'resource.operation');
    assert.deepEqual(events.map(event => [event.resource, event.operation, event.outcome]), [
      ['d1', 'invoke', 'success'], ['workflow', 'run', 'success'],
    ]);
    assert.equal(JSON.stringify(events).includes(tenantId), false);
    assert.equal(JSON.stringify(events).includes(documentId), false);
  } finally {
    await miniflare.dispose();
  }
});

test('real disposable Miniflare Workflow rejects local-beta execution before its step runs', async () => {
  const { miniflare, logs } = await createRuntime(await bundledWorker(), 'true');
  try {
    const bindings = await miniflare.getBindings<{ VECTORIZE_WORKFLOW: { create: (options: { params: unknown }) => Promise<WorkflowInstance> } }>();
    const instance = await bindings.VECTORIZE_WORKFLOW.create({ params: { tenantId, action: 'update', documentId } });
    const status = await waitForTerminal(instance);

    assert.equal(status.status, 'errored');
    assert.match(JSON.stringify(status.error), /Vector workflows are disabled in the local beta/);
    assert.equal(logs.some(log => log.message.includes('resource.operation')), false);
  } finally {
    await miniflare.dispose();
  }
});
