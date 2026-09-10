import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {checkBudgets} from './check-budgets.mjs';
const policy=JSON.parse(readFileSync(new URL('./budgets.json',import.meta.url)));
function fixture(){
 const artifacts=Object.fromEntries(Object.keys(policy.gzipBytes).map(name=>[name,{totals:{js:{gzipBytes:100},css:{gzipBytes:100}},initial:{totals:{js:{gzipBytes:100}}}}]));
 const build={revision:'synthetic',tree:policy.baselineTree,trackedDirty:false,vite:'same',artifacts};
 const timing=()=>({samples:Array.from({length:20},()=>({startupMs:100,recoveryMs:50}))});
 return {version:1,baseline:structuredClone(build),candidate:structuredClone(build),clients:{dashboard:{baseline:timing(),candidate:timing()},portal:{baseline:timing(),candidate:timing()}}};
}
test('evaluates each client bundle and both raw timing distributions',()=>{const result=checkBudgets(fixture(),policy);assert.equal(result.passed,true);assert.equal(result.checks.length,16);});
test('rejects initial, total JS and total CSS regressions independently',()=>{
 for(const field of ['initial','js','css']){const receipt=fixture();if(field==='initial')receipt.candidate.artifacts.portal.initial.totals.js.gzipBytes=72001;else receipt.candidate.artifacts.portal.totals[field].gzipBytes=policy.gzipBytes.portal[field==='js'?'allJs':'allCss']+1;assert.equal(checkBudgets(receipt,policy).passed,false);}
});
test('does not allow invented summaries to conceal a measured timing regression',()=>{const receipt=fixture();receipt.clients.dashboard.candidate.samples=Array.from({length:20},()=>({startupMs:10000,recoveryMs:1000}));receipt.clients.dashboard.candidate.startupMs={p95:1};assert.equal(checkBudgets(receipt,policy).passed,false);});
test('rejects incomplete, dirty, mismatched and invalid evidence',()=>{
 for(const change of [r=>r.baseline.tree='wrong',r=>r.candidate.trackedDirty=true,r=>r.candidate.vite='different',r=>r.clients.portal.candidate.samples.pop(),r=>r.clients.dashboard.baseline.samples=[],r=>r.clients.dashboard.candidate.samples[0].startupMs=NaN,r=>delete r.candidate.artifacts.portal.initial]){const receipt=fixture();change(receipt);assert.throws(()=>checkBudgets(receipt,policy));}
});
