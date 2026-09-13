import assert from 'node:assert/strict';
import test from 'node:test';
import { navigationArticle, navigationProfile } from './navigation-profile';

test('tiny remains the original single 35-byte visible body for each ticket', () => {
  const profile = navigationProfile();
  assert.deepEqual(profile, { name:'tiny', articlesPerTicket:1, bytesPerArticle:35 });
  for (const ticket of ['A','B'] as const) {
    assert.equal(navigationArticle(profile,ticket,0), `Synthetic warm conversation body ${ticket}.`);
    assert.equal(Buffer.byteLength(navigationArticle(profile,ticket,0)),35);
  }
});
test('medium produces exactly twenty distinct 1024-byte UTF-8 articles per ticket', () => {
  const profile = navigationProfile('medium');
  assert.equal(profile.articlesPerTicket,20);
  const all: string[] = [];
  for (const ticket of ['A','B'] as const) {
    const bodies: string[]=Array.from({length:profile.articlesPerTicket},(_,index)=>navigationArticle(profile,ticket,index));
    assert.equal(bodies.length,20);
    assert.equal(bodies.reduce((total,body)=>total+Buffer.byteLength(body),0),20480);
    for (const body of bodies) { assert.equal(Buffer.byteLength(body),1024); assert.match(body,/café/); assert.ok(body.length<1024); }
    all.push(...bodies);
  }
  assert.equal(new Set(all).size,40);
});
test('unknown profiles and altered count/byte bounds fail before payload generation', () => {
  for(const name of ['large','','MEDIUM']) assert.throws(()=>navigationProfile(name));
  for(const articlesPerTicket of [0,1,21,1.5,NaN,Infinity]) assert.throws(()=>navigationArticle({...navigationProfile('medium'),articlesPerTicket},'A',0));
  for(const bytesPerArticle of [0,35,1023,1025,1.5,NaN,Infinity]) assert.throws(()=>navigationArticle({...navigationProfile('medium'),bytesPerArticle},'A',0));
});
test('article identity bounds reject fractional, negative and out-of-range indexes', () => {
  for(const index of [-1,20,1.5,NaN,Infinity]) assert.throws(()=>navigationArticle(navigationProfile('medium'),'A',index));
  assert.throws(()=>navigationArticle(navigationProfile(),'A',1));
});
