import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {quantiles} from './browser-evidence.mjs';
export function checkBudgets(receipt,policy){
 assert.equal(policy.version,1);assert.equal(receipt.version,1);
 assert.deepEqual(Object.keys(policy.gzipBytes).sort(),['dashboard','portal','widget']);
 assert.deepEqual(Object.keys(policy.timing).sort(),['recoveryMs','startupMs']);
 assert.equal(receipt.baseline.tree,policy.baselineTree,'unexpected historical baseline tree');
 assert.equal(receipt.baseline.trackedDirty,false,'baseline source is dirty');
 assert.equal(receipt.candidate.trackedDirty,false,'candidate source is dirty');
 assert.equal(receipt.baseline.vite,receipt.candidate.vite,'different Vite versions need a new controlled comparison');
 const checks=[];
 const bounded=(name,value,limit)=>{assert.ok(Number.isFinite(value)&&value>=0,`${name}: missing/invalid observation`);assert.ok(Number.isFinite(limit)&&limit>0,`${name}: invalid limit`);checks.push({name,value,limit,passed:value<=limit});};
 for(const [client,limits] of Object.entries(policy.gzipBytes)){
  const artifact=receipt.candidate.artifacts[client];
  bounded(`${client}.allJsGzip`,artifact?.totals?.js?.gzipBytes,limits.allJs);
  bounded(`${client}.allCssGzip`,artifact?.totals?.css?.gzipBytes,limits.allCss);
  if(limits.initialJs!==undefined)bounded(`${client}.initialJsGzip`,artifact?.initial?.totals?.js?.gzipBytes,limits.initialJs);
 }
 for(const client of ['dashboard','portal']){
  const sides=receipt.clients[client];
  assert.ok(Number.isInteger(policy.minimumSamples)&&policy.minimumSamples>=20,'at least 20 samples required');
  assert.ok(sides.baseline.samples.length>=policy.minimumSamples&&sides.baseline.samples.length<=100,'insufficient or unbounded baseline samples');
  assert.equal(sides.candidate.samples.length,sides.baseline.samples.length,'unequal sample counts');
  for(const [metric,limit] of Object.entries(policy.timing)){
   assert.ok(Number.isFinite(limit.baselineMultiplier)&&limit.baselineMultiplier>=1&&Number.isFinite(limit.slackMs)&&limit.slackMs>=0,'invalid timing policy');
   // Derive tails from raw observations, never trust a supplied summary alone.
   const before=quantiles(sides.baseline.samples.map(sample=>sample[metric])).p95;
   const after=quantiles(sides.candidate.samples.map(sample=>sample[metric])).p95;
   bounded(`${client}.${metric}.relativeP95`,after,before*limit.baselineMultiplier+limit.slackMs);
   bounded(`${client}.${metric}.absoluteP95`,after,limit.absoluteP95Ms);
  }
 }
 return {version:1,revision:receipt.candidate.revision,baseline:receipt.baseline.revision,passed:checks.every(check=>check.passed),checks};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const file=process.argv[2];if(!file)throw new Error('Usage: node tools/ui-performance/check-budgets.mjs RECEIPT.json');
 const result=checkBudgets(JSON.parse(readFileSync(file)),JSON.parse(readFileSync(new URL('./budgets.json',import.meta.url))));
 console.log(JSON.stringify(result,null,2));if(!result.passed)process.exitCode=1;
}
