import { describe, it, expect, vi } from 'vitest';
import { TenantTicketService } from '../tenant-ticket.service';
import { BroadcastService } from '../broadcast.service';
import { createVerifiedTenantScope } from '../../auth/scope';
import { Hono } from 'hono';
import { loginAuthResolverMiddleware } from '../../middleware/auth.middleware';
import { HttpResendTransport } from '../email/transport';
import { apiAuthMiddleware } from '../../middleware/api-auth.middleware';

describe('PR 43 review regressions', () => {
  it('returns a controlled response for a missing login database binding', async () => {
    const app = new Hono(); app.use('*',loginAuthResolverMiddleware); app.post('/',c=>c.text('unexpected'));
    const response = await app.request('/', {method:'POST',body:JSON.stringify({email:'user@example.test'})}, {});
    expect(response.status).toBe(503);
  });
  it('encodes only the attachment view, not neighboring bytes', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({id:'sent'})));
    vi.stubGlobal('fetch',fetcher);
    try {
      const backing = new Uint8Array([99,65,66,67,88]);
      await new HttpResendTransport().send({to:'a@example.test',subject:'Test',attachments:[{filename:'a.txt',content:backing.subarray(1,4),contentType:'text/plain'}]}, {apiKey:'test',defaultFrom:'support@example.test'});
      const payload = JSON.parse(fetcher.mock.calls[0][1].body);
      expect(payload.attachments[0].content).toBe('QUJD');
    } finally { vi.unstubAllGlobals(); }
  });
  it('bounds aggregate R2 article hydration for a listing', async () => {
    const storage = {getAttachment:vi.fn(async()=>({body:new Response('x'.repeat(100000)).body}))};
    const service = new TenantTicketService({attachmentStorage:storage} as any);
    const articles = Array.from({length:20},(_,id)=>({id:String(id),body:null,body_r2_key:String(id)}));
    const result = await service.hydrateArticles(articles as any);
    expect(result.reduce((sum,a)=>sum+(a.body?.length||0),0)).toBeLessThanOrEqual(1024*1024);
    expect(result[0].body?.length).toBe(65536);
    expect(storage.getAttachment.mock.calls.length).toBeLessThan(20);
  });
  it('keeps legacy canonical projections unbounded until their routes adopt a page', async () => {
    const references = vi.fn().mockResolvedValue([]);
    const service = new TenantTicketService({conversationAudit:{references}} as any);
    const articles = Array.from({length:51},(_,index)=>({
      id:`article-${index}`, ticket_id:'ticket', sender_type:'customer', body:'Synthetic reply', attachments:[], is_internal:false,
    }));
    await service.projectAuditedConversation({id:'ticket',source:'api',customer_email:'customer@example.test'} as any,articles as any);
    expect(references).toHaveBeenCalledWith('ticket',undefined);
    await service.projectAuditedConversation({id:'ticket',source:'api',customer_email:'customer@example.test'} as any,articles as any,{boundedPage:true});
    expect(references).toHaveBeenLastCalledWith('ticket',articles.map(article=>article.id));
  });
  it('keeps authentication valid when scoped usage telemetry fails', async () => {
    const usageBindings: unknown[][] = [];
    const DB = {prepare:(sql:string)=>({bind:(...args:unknown[])=>({
      first:async()=>({tenant_id:'tenant-A',id:'key-A',name:'Integration',permissions:'tickets:read'}),
      run:async()=>{ if(sql.startsWith('UPDATE api_keys')) { usageBindings.push(args); throw new Error('Simulated telemetry write failure'); } }
    })})};
    const app = new Hono(); app.use('*',apiAuthMiddleware); app.get('/',c=>c.text('allowed'));
    const response = await app.request('/',{headers:{'X-API-Key':'lt_test'}},{DB} as any);
    expect(response.status).toBe(200);
    expect(usageBindings[0].slice(1)).toEqual(['tenant-A','key-A']);
  });
  it('preserves validated ticket fields', async () => {
    const createWithInitialArticle = vi.fn().mockResolvedValue({ticket:{id:'ticket'},article:{id:'article'}});
    const service = new TenantTicketService({repositories:{tickets:{createWithInitialArticle},articles:{create:vi.fn()}}} as any);
    await service.createTicketWithArticle({
      subject:'Issue', customer_email:'customer@example.test', source:'api', body:'Initial message', sender_type:'customer',
      status:'pending',priority:'high',assigned_to:'agent',group_id:'group',custom_fields:'{}',
    });
    expect(createWithInitialArticle).toHaveBeenCalledWith(expect.objectContaining({
      ticket: expect.objectContaining({status:'pending',priority:'high',assigned_to:'agent',group_id:'group',custom_fields:'{}'}),
    }));
  });
  it('returns a controlled response for a missing API database binding', async () => {
    const app = new Hono(); app.use('*',apiAuthMiddleware); app.get('/',c=>c.text('unexpected'));
    const response = await app.request('/', {headers:{'X-API-Key':'test'}}, {});
    expect(response.status).toBe(503);
  });
  it('broadcasts to distinct tenant objects and rejects missing scope', async () => {
    const idFromName = vi.fn(n=>n);
    const env = {NOTIFICATION_DO:{idFromName,get:vi.fn(()=>({fetch:vi.fn().mockResolvedValue(new Response('OK'))}))}};
    for (const tenant of ['A','B']) await new BroadcastService(env as any,createVerifiedTenantScope(tenant,'agent',['agent'],1)).broadcast('test',{});
    expect(idFromName.mock.calls).toEqual([['tenant:A'],['tenant:B']]);
    await expect(new BroadcastService(env as any).broadcast('test',{})).rejects.toThrow('Verified tenant scope');
  });
});
