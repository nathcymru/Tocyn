import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const requestedOrigin = new URL(process.env.TOCYN_FILTER_ORIGIN ?? 'http://127.0.0.1:5190');
assert.ok(requestedOrigin.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(requestedOrigin.hostname) && requestedOrigin.pathname === '/' && !requestedOrigin.username && !requestedOrigin.password && !requestedOrigin.search && !requestedOrigin.hash, 'Only a loopback HTTP fixture origin is allowed');
const origin = requestedOrigin.origin;
const receiptPath = '/tmp/tocyn-filter-recovery.json';
const syntheticName = 'Synthetic retained filter';
const syntheticCondition = Object.freeze({ field: 'priority', operator: 'contains', value: 'urgent' });
const sourcePaths = [
  'tools/ui-browser/filter-recovery.mjs',
  'apps/dashboard/src/pages/FiltersSettingsPage.tsx',
  'apps/dashboard/src/hooks/useFilters.ts',
  'apps/dashboard/src/__tests__/FilterEditorDialog.test.tsx',
];

function payloadShape(payload) {
  const conditions = Array.isArray(payload.conditions) ? payload.conditions : [];
  return {
    nameLength: typeof payload.name === 'string' ? payload.name.length : -1,
    conditions: conditions.map(condition => ({
      field: typeof condition.field === 'string' ? condition.field : '',
      operator: typeof condition.operator === 'string' ? condition.operator : '',
      valueLength: typeof condition.value === 'string' ? condition.value.length : -1,
    })),
    payloadSha256: createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
  };
}

const sourceHashes = Object.fromEntries(await Promise.all(sourcePaths.map(async path => [
  path,
  createHash('sha256').update(await readFile(path)).digest('hex'),
])));
const browser = await chromium.launch({ headless: true });
let receipt;
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    let externalRequests = 0;
    let blockedMutations = 0;
    const saveAttempts = [];
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== origin) {
        externalRequests++;
        await route.abort();
        return;
      }
      const isCreateFilter = url.pathname === '/api/settings/filters' && request.method() === 'POST';
      if (!isCreateFilter && !['GET', 'HEAD'].includes(request.method())) {
        blockedMutations++;
        await route.abort();
        return;
      }
      if (!isCreateFilter) {
        await route.continue();
        return;
      }
      const payload = JSON.parse(request.postData() ?? '{}');
      const shape = payloadShape(payload);
      saveAttempts.push(shape);
      if (saveAttempts.length === 1) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic local save rejection' }) });
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'synthetic-no-persist', name: syntheticName, conditions: [syntheticCondition], is_system: false }) });
      }
    });

    await page.goto(`${origin}/__test-login`);
    await page.waitForURL('**/settings/agent-permissions');
    await page.goto(`${origin}/settings/filters`);
    const create = page.getByRole('button', { name: 'Create Filter', exact: true });
    await create.waitFor({ state: 'visible' });
    await create.click();
    const dialog = page.getByRole('dialog', { name: 'Create Filter', exact: true });
    await dialog.waitFor({ state: 'visible' });
    const name = dialog.getByRole('textbox', { name: 'Filter Name', exact: true });
    await name.fill(syntheticName);
    await dialog.getByRole('button', { name: 'Add Condition', exact: true }).click();
    const field = dialog.getByRole('combobox', { name: 'Condition 1 field', exact: true });
    const operator = dialog.getByRole('combobox', { name: 'Condition 1 operator', exact: true });
    const value = dialog.getByRole('textbox', { name: 'Condition 1 value', exact: true });
    await field.selectOption(syntheticCondition.field);
    await operator.selectOption(syntheticCondition.operator);
    await value.fill(syntheticCondition.value);
    await dialog.getByRole('button', { name: 'Create Filter', exact: true }).click();

    const alert = dialog.getByRole('alert');
    await alert.waitFor({ state: 'visible' });
    assert.match(await alert.innerText(), /Your changes have been kept/);
    assert.equal(await name.inputValue(), syntheticName, 'Rejected save must retain the filter name');
    assert.equal(await field.inputValue(), syntheticCondition.field, 'Rejected save must retain the condition field');
    assert.equal(await operator.inputValue(), syntheticCondition.operator, 'Rejected save must retain the condition operator');
    assert.equal(await value.inputValue(), syntheticCondition.value, 'Rejected save must retain the condition value');

    await dialog.getByRole('button', { name: 'Create Filter', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await create.waitFor({ state: 'visible' });
    await create.waitFor({ state: 'attached' });
    assert.equal(await create.evaluate(element => element === (element.ownerDocument?.activeElement ?? null)), true, 'Synthetic 200 create contract must restore focus to Create Filter');
    assert.equal(saveAttempts.length, 2, 'The rejected save must be retried once');
    assert.deepEqual(saveAttempts[1], saveAttempts[0], 'The retry must preserve the exact draft request without recording its raw contents');
    assert.equal(externalRequests, 0, 'The browser harness must not access external origins');
    assert.equal(blockedMutations, 0, 'Only the intercepted synthetic filter saves may mutate');

    receipt = Object.freeze({
      version: 1,
      kind: 'tocyn-local-filter-save-recovery',
      recordedAt: new Date().toISOString(),
      revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      workingTreeDirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0,
      environment: Object.freeze({ node: process.version, browser: browser.version(), headless: true, viewport: Object.freeze({ width: 1280, height: 800 }), reducedMotion: 'reduce', dashboardOrigin: origin, localApiFixture: 'http://127.0.0.1:8899', externalRequests, blockedMutations }),
      sourceHashes: Object.freeze(sourceHashes),
      syntheticFault: Object.freeze({ route: '/api/settings/filters', method: 'POST', firstResponseStatus: 503, retryResponseStatus: 200, persistedRecords: 0 }),
      evidence: Object.freeze({ namedCreateFilterDialog: true, rejectedSaveAlert: true, retainedDraft: true, retryPayloadUnchanged: true, syntheticSuccessFocusRestored: true, saveAttemptShapes: Object.freeze(saveAttempts) }),
      limitations: Object.freeze([
        'The 503 and 200 responses are browser-route synthetic faults; neither creates or changes a fixture record.',
        'Authentication and filter-list reads use the existing local loopback fixture only; this is not provider, production, or authorization coverage.',
        'Receipt redacts request bodies and tokens; payload evidence is a digest and field/value lengths only.',
      ]),
    });
  } finally {
    await context.close();
  }
} finally {
  await browser.close();
}
await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(receipt)}\n`);
