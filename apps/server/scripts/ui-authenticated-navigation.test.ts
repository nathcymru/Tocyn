import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withTwoTenantFixture } from './local-tenant-fixture';
import { runAuthenticatedNavigation } from '../../../tools/ui-performance/authenticated-navigation';

test('measures real fixture-authenticated dashboard and portal ticket list-to-detail navigation', async () => {
  const receipt = await withTwoTenantFixture(fixture => runAuthenticatedNavigation(fixture, Number(process.env.TOCYN_UI_AUTH_SAMPLES ?? '20'), {warmSwitches: process.env.TOCYN_UI_AUTH_WARM === '1', warmProfile: process.env.TOCYN_UI_AUTH_PROFILE}));
  assert.equal(receipt.configuration.samplesPerClient, Number(process.env.TOCYN_UI_AUTH_SAMPLES ?? '20'));
  assert.equal(receipt.measurements.length, receipt.configuration.samplesPerClient * 2);
  assert.deepEqual([...new Set(receipt.measurements.map(measurement => measurement.client))].sort(), ['dashboard', 'portal']);
  assert.ok(receipt.measurements.every(measurement => Number.isFinite(measurement.timing.listToDetailMs) && measurement.timing.listToDetailMs >= 0));
  assert.deepEqual(receipt.recovery.map(measurement => measurement.client), ['dashboard', 'portal']);
  assert.ok(receipt.recovery.every(measurement => Number.isFinite(measurement.timing.failedDetailRetryMs) && measurement.timing.failedDetailRetryMs >= 0));
  if (process.env.TOCYN_UI_AUTH_WARM === '1') {
    assert.equal(receipt.warmSwitches?.cycles, receipt.configuration.samplesPerClient);
    assert.equal(receipt.warmSwitches?.samples.length, receipt.configuration.samplesPerClient * 2);
    assert.equal(receipt.warmSwitches?.thresholdEvaluated, false);
    assert.equal(receipt.warmSwitches?.profile.name,process.env.TOCYN_UI_AUTH_PROFILE ?? 'tiny');
    assert.ok(receipt.warmSwitches?.tickets.every(ticket=>ticket.articles===receipt.warmSwitches!.profile.articlesPerTicket && ticket.bodyBytes===receipt.warmSwitches!.profile.bytesPerArticle));
    assert.equal(new Set(receipt.warmSwitches?.tickets.map(ticket => ticket.id)).size, 2);
    assert.ok(receipt.warmSwitches?.samples.every(sample => Number.isFinite(sample.usefulRenderMs) && sample.usefulRenderMs >= 0));
  } else assert.equal(receipt.warmSwitches, undefined);
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
});
