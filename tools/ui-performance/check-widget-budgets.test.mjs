import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkWidgetBudgets} from './check-widget-budgets.mjs';
const policy={startupMs:1500,openMs:100,recoveryMs:150};
const fixture=()=>({version:1,trackedDirty:false,samplesPerMode:20,warmups:2,results:[true,false].flatMap(aiChat=>Array.from({length:20},(_,sample)=>({aiChat,sample,result:'passed',timing:{startupMs:100,openMs:40,recoveryMs:50}})))});
test('requires both widget modes and raw distributions regardless of supplied summaries',()=>{
 const receipt=fixture();assert.equal(checkWidgetBudgets(receipt,policy).checks.length,6);
 receipt.timingSummary={false:{openMs:{p95:1}}};receipt.results.filter(r=>!r.aiChat).forEach(r=>r.timing.openMs=101);
 assert.equal(checkWidgetBudgets(receipt,policy).passed,false);
});
test('rejects missing modes, duplicate samples, failures, invalid timings and dirty evidence',()=>{
 for(const alter of [r=>r.results.pop(),r=>r.results[0].sample=1,r=>r.results[0].result='failed',r=>r.results[0].timing.openMs=NaN,r=>r.trackedDirty=true,r=>r.warmups=0]){
  const receipt=fixture();alter(receipt);assert.throws(()=>checkWidgetBudgets(receipt,policy));
 }
});
