import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quantiles, run } from './browser-evidence.mjs';
test('nearest-rank quantiles use a sorted copy and retain tail values', () => {
 const values=[100,1,4,2,3];assert.deepEqual(quantiles(values),{p50:3,p95:100,p99:100});assert.deepEqual(values,[100,1,4,2,3]);
 assert.deepEqual(quantiles(Array.from({length:100},(_,i)=>i+1)),{p50:50,p95:95,p99:99});
});
test('invalid or unbounded samples fail before loading browser or opening resources', async () => {
 for(const values of [[],[-1],[NaN],[Infinity]]) assert.throws(()=>quantiles(values),/Invalid timing/);
 for(const count of [0,1,101,2.5,NaN]) await assert.rejects(run('/unused','/unused',count),/Samples must/);
});
