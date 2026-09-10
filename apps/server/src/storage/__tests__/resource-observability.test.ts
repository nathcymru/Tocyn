import { afterEach, expect, it, vi } from 'vitest';
import { createVerifiedTenantScope } from '../../auth/scope';
import { createTenantRequestDeps } from '../../middleware/tenant.middleware';
import { TenantR2Adapter } from '../adapters';
import { LocalBetaAttachmentStorage } from '../local-beta-attachments';
import type { LocalBetaAdmissionRepository } from '../../repositories/local-beta-admission.repository';
import { MAX_RESOURCE_EVENTS_PER_COMPOSITION } from '../../observability/resource-operation';
import { BroadcastService } from '../../services/broadcast.service';
const scope = createVerifiedTenantScope('synthetic-tenant-a', 'synthetic-actor', ['agent'], 1);
afterEach(() => vi.restoreAllMocks());
it('measures actual qualified R2 calls without copying keys, content, options or result fields', async () => {
  const result={private:'object-body'}; const bucket={get:vi.fn(async()=>result),put:vi.fn(async()=>result),delete:vi.fn(async()=>undefined)};const emit=vi.fn();
  const adapter=new TenantR2Adapter(scope,bucket,emit);
  expect(await adapter.get('private-key')).toBe(result);
  expect(await adapter.put('private-key','private-content',{customMetadata:{private:'metadata'}})).toBe(result);
  await adapter.delete('private-key');
  expect(bucket.get).toHaveBeenCalledWith('synthetic-tenant-a/private-key');
  expect(bucket.put).toHaveBeenCalledTimes(1);expect(bucket.delete).toHaveBeenCalledWith('synthetic-tenant-a/private-key');
  expect(emit.mock.calls.map(([event])=>[event.resource,event.operation,event.outcome])).toEqual([['r2','read','success'],['r2','write','success'],['r2','delete','success']]);
  expect(JSON.stringify(emit.mock.calls)).not.toMatch(/private|synthetic-tenant|synthetic-actor/);
});
it('preserves the exact R2 failure and never retries or compensates an uncertain write', async () => {
  const error={private:'uncertain write'};const bucket={get:vi.fn(),put:vi.fn(async()=>{throw error;}),delete:vi.fn()};const emit=vi.fn(()=>{throw new Error('diagnostic failure');});
  await expect(new TenantR2Adapter(scope,bucket,emit).put('object','body')).rejects.toBe(error);
  expect(bucket.put).toHaveBeenCalledTimes(1);expect(bucket.delete).not.toHaveBeenCalled();
  expect(emit).toHaveBeenCalledWith(expect.objectContaining({operation:'write',outcome:'failure'}));
});
it('keeps durable admission ahead of R2 and emits no R2 event when admission rejects', async () => {
  const error=new Error('admission denied');const chargeUploadAttempt=vi.fn(async()=>{throw error;});
  const admission={chargeUploadAttempt} as unknown as LocalBetaAdmissionRepository;
  const bucket={get:vi.fn(),put:vi.fn(),delete:vi.fn()};const emit=vi.fn();
  const storage=new LocalBetaAttachmentStorage(scope,bucket,admission,emit);
  await expect(storage.putAttachment('object','body')).rejects.toBe(error);
  expect(chargeUploadAttempt).toHaveBeenCalledTimes(1);expect(bucket.put).not.toHaveBeenCalled();expect(emit).not.toHaveBeenCalled();
});
it.each(['production','disabled','isolated'])('enforces composition gating and output limits in %s mode', async mode => {
  const log=vi.spyOn(console,'log').mockImplementation(()=>{});
  const bucket={get:vi.fn(async()=>null),put:vi.fn(),delete:vi.fn()};
  const deps=createTenantRequestDeps(scope,{DB:{},ATTACHMENTS_BUCKET:bucket,VECTOR_INDEX:{},ENVIRONMENT:mode==='production'?'production':'development',LOCAL_BETA_ENABLED:'true',OBSERVABILITY_MODE:mode==='disabled'?'off':'isolated-evidence'});
  for(let index=0;index<MAX_RESOURCE_EVENTS_PER_COMPOSITION+2;index++) await deps.attachmentStorage.getAttachment(`private-${index}`);
  expect(bucket.get).toHaveBeenCalledTimes(MAX_RESOURCE_EVENTS_PER_COMPOSITION+2);
  expect(log).toHaveBeenCalledTimes(mode==='isolated'?MAX_RESOURCE_EVENTS_PER_COMPOSITION:0);
  expect(JSON.stringify(log.mock.calls)).not.toMatch(/private|synthetic/);
});
it.each(['isolated','production','disabled'])('shares the trusted request emitter with Durable Object broadcasts: %s', async mode => {
  const log=vi.spyOn(console,'log').mockImplementation(()=>{});
  const fetch=vi.fn(async()=>new Response('ok'));
  const env={DB:{},ATTACHMENTS_BUCKET:{},VECTOR_INDEX:{},ENVIRONMENT:'development',LOCAL_BETA_ENABLED:'true',OBSERVABILITY_MODE:'isolated-evidence',NOTIFICATION_DO:{idFromName:vi.fn(()=> 'tenant-object'),get:vi.fn(()=>({fetch}))}} as any;
  if(mode==='production')env.ENVIRONMENT='production';if(mode==='disabled')env.OBSERVABILITY_MODE='disabled';
  const deps=createTenantRequestDeps(scope,env);
  await new BroadcastService(env,scope,deps.emitResourceOperation).broadcast('ticket.updated',{tenantId:'private',body:'private'});
  expect(fetch).toHaveBeenCalledTimes(1);
  if(mode==='isolated')expect(log).toHaveBeenCalledWith(expect.stringContaining('"resource":"durable_object"'));else expect(log).not.toHaveBeenCalled();
  expect(log.mock.calls.flat().join(' ')).not.toMatch(/private|synthetic-tenant/);
});
