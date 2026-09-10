import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withTwoTenantFixture } from './local-tenant-fixture';
import { runAuthenticatedNavigation } from '../../../tools/ui-performance/authenticated-navigation';

test('measures real fixture-authenticated dashboard and portal ticket list-to-detail navigation', async () => {
  const receipt = await withTwoTenantFixture(fixture => runAuthenticatedNavigation(fixture, Number(process.env.TOCYN_UI_AUTH_SAMPLES ?? '20')));
  assert.equal(receipt.configuration.samplesPerClient, Number(process.env.TOCYN_UI_AUTH_SAMPLES ?? '20'));
  assert.equal(receipt.measurements.length, receipt.configuration.samplesPerClient * 2);
  assert.deepEqual([...new Set(receipt.measurements.map(measurement => measurement.client))].sort(), ['dashboard', 'portal']);
  assert.ok(receipt.measurements.every(measurement => Number.isFinite(measurement.timing.listToDetailMs) && measurement.timing.listToDetailMs >= 0));
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
});
