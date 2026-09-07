import { describe, it, expect, vi } from 'vitest';
import { TenantTicketService } from '../tenant-ticket.service';
import { BroadcastService } from '../broadcast.service';
import { createVerifiedTenantScope } from '../../auth/scope';
import { Hono } from 'hono';
import { apiAuthMiddleware } from '../../middleware/api-auth.middleware';

describe('PR 43 review regressions', () => {
  it('preserves validated ticket fields', async () => {
    const create = vi.fn().mockResolvedValue({id:'ticket'});
    const service = new TenantTicketService({repositories:{tickets:{create},articles:{create:vi.fn()}}} as any);
    await service.createTicketWithArticle({subject:'Issue',status:'pending',priority:'high',assigned_to:'agent',group_id:'group',custom_fields:'{}'});
    expect(create).toHaveBeenCalledWith(expect.objectContaining({status:'pending',priority:'high',assigned_to:'agent',group_id:'group',custom_fields:'{}'}));
  });
  it('returns a controlled response for a missing API database binding', async () => {
    const app = new Hono(); app.use('*',apiAuthMiddleware); app.get('/',c=>c.text('unexpected'));
    const response = await app.request('/', {headers:{'X-API-Key':'test'}}, {});
    expect(response.status).toBe(503);
  });
  it('broadcasts to distinct tenant objects and rejects missing scope', async () => {
    const idFromName = vi.fn(n=>n);
    const env = {NOTIFICATION_DO:{idFromName,get:vi.fn(()=>({fetch:vi.fn()}))}};
    for (const tenant of ['A','B']) await new BroadcastService(env as any,createVerifiedTenantScope(tenant,'agent',['agent'],1)).broadcast('test',{});
    expect(idFromName.mock.calls).toEqual([['tenant:A'],['tenant:B']]);
    await expect(new BroadcastService(env as any).broadcast('test',{})).rejects.toThrow('Verified tenant scope');
  });
});
