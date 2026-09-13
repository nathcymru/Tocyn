import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { checkWarmBudget, WARM_RULE } from './check-warm-budget.mjs';
const receipt = JSON.parse(readFileSync(new URL('./fixtures/warm-tiny-087a2172.json', import.meta.url)));
const provenance = JSON.parse(readFileSync(new URL('./fixtures/warm-tiny-087a2172-provenance.json', import.meta.url)));

test('recorded tiny baseline passes by recomputed nearest-rank p95', () => {
  const result = checkWarmBudget(receipt, provenance);
  assert.equal(result.passed, true); assert.equal(result.samples, 20);
  assert.ok(Math.abs(result.p95Ms - 44.3) < 0.00001); assert.equal(result.maximumMs, 80);
});
test('doubling raw observations fails despite an unchanged passing summary', () => {
  const slow = structuredClone(receipt);
  for (const sample of slow.warmSwitches.samples) sample.usefulRenderMs *= 2;
  assert.equal(slow.warmSwitches.returnToA.p95, receipt.warmSwitches.returnToA.p95);
  const result = checkWarmBudget(slow, provenance);
  assert.equal(result.passed, false); assert.ok(Math.abs(result.p95Ms - 88.6) < 0.00001);
});
test('uses nearest rank and includes exactly eighty milliseconds', () => {
  const changed = structuredClone(receipt); let index=0;
  for (const sample of changed.warmSwitches.samples) if(sample.leg==='B-to-A') sample.usefulRenderMs=index++===19?1000:80;
  assert.equal(checkWarmBudget(changed,provenance).passed,true);
  changed.warmSwitches.samples.find(sample=>sample.leg==='B-to-A').usefulRenderMs=80.001;
  assert.equal(checkWarmBudget(changed,provenance).passed,false);
});
for(const [name, change] of [
  ['missing sample',r=>r.warmSwitches.samples.pop()], ['duplicate',r=>r.warmSwitches.samples[1]={...r.warmSwitches.samples[0]}],
  ['negative',r=>r.warmSwitches.samples[0].usefulRenderMs=-1], ['nonfinite',r=>r.warmSwitches.samples[0].usefulRenderMs=Infinity],
  ['NaN',r=>r.warmSwitches.samples[0].usefulRenderMs=NaN], ['string',r=>r.warmSwitches.samples[0].usefulRenderMs='1'],
  ['hardware',r=>r.warmSwitches.hardware='unknown'], ['battery',r=>r.warmSwitches.power='Battery'],
  ['profile',r=>r.warmSwitches.tickets[0].articles=20], ['viewport',r=>r.environment.viewport.width=320],
  ['browser',r=>r.environment.browser='152.0.0.0'], ['Playwright',r=>r.environment.playwright='1.63.0'],
  ['Node',r=>r.environment.node='v24.0.0'],
  ['motion',r=>r.environment.reducedMotion='no-preference'], ['remote',r=>r.environment.remoteBindings=1],
  ['revision',r=>r.revision='a'.repeat(40)], ['source hash',r=>r.sourceHashes['apps/dashboard/src/pages/TicketDetailPage.tsx']='a'.repeat(64)],
  ['missing hash',r=>delete r.sourceHashes['apps/dashboard/src/pages/TicketDetailPage.tsx']], ['artifact',r=>r.artifacts.dashboard='a'.repeat(64)],
  ['failed read',r=>r.warmSwitches.samples[0].detailReads=[{status:503,completionFromClickDriverMs:1}]],
]) test(`rejects ${name}`,()=>{const changed=structuredClone(receipt);change(changed);assert.throws(()=>checkWarmBudget(changed,provenance));});
test('unsupported rule, metric and incomplete trusted provenance fail closed',()=>{
  for(const rule of [{...WARM_RULE,maximumMs:100},{...WARM_RULE,metric:'network-ms'},{...WARM_RULE,samples:1},{}])assert.throws(()=>checkWarmBudget(receipt,provenance,rule));
  assert.throws(()=>checkWarmBudget(receipt,{}));
});
test('CLI accepts the pinned receipt and refuses missing expected provenance',()=>{
  const cli=new URL('./check-warm-budget.mjs',import.meta.url).pathname;
  const args=[new URL('./fixtures/warm-tiny-087a2172.json',import.meta.url).pathname,new URL('./fixtures/warm-tiny-087a2172-provenance.json',import.meta.url).pathname];
  assert.equal(spawnSync(process.execPath,[cli,...args]).status,0);
  assert.equal(spawnSync(process.execPath,[cli,args[0]]).status,1);
});

test('CLI reports a nonzero exit for the doubled raw fixture',()=>{
  const directory=mkdtempSync(join(tmpdir(),'tocyn-warm-budget-'));
  try {
    const changed=structuredClone(receipt);for(const sample of changed.warmSwitches.samples)sample.usefulRenderMs*=2;
    const input=join(directory,'slower.json');writeFileSync(input,JSON.stringify(changed));
    const result=spawnSync(process.execPath,[new URL('./check-warm-budget.mjs',import.meta.url).pathname,input,new URL('./fixtures/warm-tiny-087a2172-provenance.json',import.meta.url).pathname],{encoding:'utf8'});
    assert.equal(result.status,1);assert.equal(JSON.parse(result.stdout).passed,false);
  } finally {rmSync(directory,{recursive:true,force:true});}
});
