import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {quantiles} from './browser-evidence.mjs';
export function checkWidgetBudgets(receipt, policy) {
 assert.equal(receipt.version,1);
 assert.equal(receipt.trackedDirty,false,'widget evidence requires clean tracked source');
 assert.ok(Number.isInteger(receipt.samplesPerMode)&&receipt.samplesPerMode>=20&&receipt.samplesPerMode<=50);
 assert.equal(receipt.warmups,2);
 assert.equal(receipt.results.length,receipt.samplesPerMode*2);
 const checks=[];
 for(const aiChat of [true,false]) {
  const rows=receipt.results.filter(row=>row.aiChat===aiChat);
  assert.equal(rows.length,receipt.samplesPerMode);
  assert.deepEqual(rows.map(row=>row.sample).sort((a,b)=>a-b),Array.from({length:receipt.samplesPerMode},(_,i)=>i));
  for(const row of rows)assert.equal(row.result,'passed');
  for(const metric of ['startupMs','openMs','recoveryMs']) {
   const limit=policy[metric];
   assert.ok(Number.isFinite(limit)&&limit>0);
   const value=quantiles(rows.map(row=>row.timing[metric])).p95;
   checks.push({aiChat,metric,value,limit,passed:value<=limit});
  }
 }
 return {version:1,revision:receipt.revision,passed:checks.every(check=>check.passed),checks};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
 const result=checkWidgetBudgets(JSON.parse(readFileSync(process.argv[2])),JSON.parse(readFileSync(new URL('./budgets.json',import.meta.url))).widgetTimingP95Ms);
 console.log(JSON.stringify(result,null,2));if(!result.passed)process.exitCode=1;
}
