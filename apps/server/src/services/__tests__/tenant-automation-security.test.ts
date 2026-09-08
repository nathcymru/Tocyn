import { afterEach, describe, expect, it, vi } from 'vitest';
import { LegacyArticleBodyStorage, TenantAttachmentStorage } from '../../storage/adapters';
import { TenantAutomationService } from '../tenant-automation.service';

afterEach(() => vi.unstubAllGlobals());
describe('tenant automation safety', () => {
  it('matches supported expressions without backtracking and rejects unsupported syntax', () => {
    const service = new TenantAutomationService({} as any);
    const condition = (value: string, subject: string) => service.evaluateConditions(JSON.stringify([{ field: 'ticket.subject', operator: 'regex', value }]), { ticket: { subject } as any });
    expect(condition('urgent', 'URGENT support')).toBe(true);
    expect(condition('(a+)+$', 'a'.repeat(900) + '!')).toBe(false);
    expect(condition('(a)\\1', 'aa')).toBe(false);
  });
  it('denies unapproved egress and refuses redirects on approved destinations', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('', { status: 200 })); vi.stubGlobal('fetch', fetcher);
    const service = new TenantAutomationService({} as any, ['https://hooks.example.com']);
    for (const url of ['http://hooks.example.com', 'https://hooks.example.com.evil.test', 'https://user:pass@hooks.example.com', 'http://127.0.0.1']) {
      await service.executeAction({ action_type: 'webhook', action_config: JSON.stringify({ url }) }, {});
    }
    expect(fetcher).not.toHaveBeenCalled();
    await service.executeAction({ action_type: 'webhook', action_config: JSON.stringify({ url: 'https://hooks.example.com/events' }) }, {});
    expect(fetcher).toHaveBeenCalledWith('https://hooks.example.com/events', expect.objectContaining({ redirect: 'error' }));
  });
  it.each(['attachment', 'vector'])('retains ownership after %s deletion failure and succeeds on retry', async (failure) => {
    const deps: any = { repositories: {
      automations: { getActiveRules: vi.fn().mockResolvedValue([{ action_config: '{"days_to_keep":30,"delete_attachments":true}' }]) },
      tickets: { findTicketsForRetention: vi.fn().mockResolvedValue([{ id: 'ticket' }]), delete: vi.fn() },
      articles: { listByTicket: vi.fn().mockResolvedValue([{ id: 'article', qa_type: 'answer', chunk_count: 1 }]), delete: vi.fn() },
      attachments: { findByArticle: vi.fn().mockResolvedValue([{ id: 'attachment', r2_key: 'logical-file' }]), delete: vi.fn() },
    }, attachmentStorage: { deleteAttachment: vi.fn().mockResolvedValue(undefined) }, vectorStorage: { deleteByIds: vi.fn().mockResolvedValue(undefined) } };
    (failure === 'attachment' ? deps.attachmentStorage.deleteAttachment : deps.vectorStorage.deleteByIds).mockRejectedValueOnce(new Error('Transient failure'));
    const service = new TenantAutomationService(deps);
    expect((await service.runRetention()).deleted_tickets).toBe(0);
    expect(deps.repositories.attachments.delete).not.toHaveBeenCalled();
    expect(deps.repositories.articles.delete).not.toHaveBeenCalled();
    expect(deps.repositories.tickets.delete).not.toHaveBeenCalled();
    expect((await service.runRetention()).deleted_tickets).toBe(1);
    expect(deps.vectorStorage.deleteByIds).toHaveBeenCalledWith(['qa_article_0']);
  });
  it.each([true, false])('deletes only the selected body namespace (legacy=%s)', async (legacy) => {
    const scope = { tenantId: legacy ? 'default-tenant' : 'tenant-A' } as any;
    const bodyKey = 'tickets/ticket/articles/article/body.txt';
    const scopedKey = `${scope.tenantId}/${bodyKey}`;
    const objects = new Set([bodyKey, scopedKey]);
    const bucket = { delete: vi.fn(async (key: string) => { objects.delete(key); }) } as any;
    const deps: any = {
      attachmentStorage: new TenantAttachmentStorage(scope, bucket),
      legacyArticleStorage: legacy ? new LegacyArticleBodyStorage(scope, bucket) : undefined,
      repositories: {
        automations: { getActiveRules: async () => [{ action_config: '{"days_to_keep":30}' }] },
        tickets: { findTicketsForRetention: async () => [{ id: 'ticket' }], delete: vi.fn() },
        articles: { listByTicket: async () => [{ id: 'article', body_r2_key: bodyKey }], delete: vi.fn() },
        attachments: { findByArticle: async () => [], delete: vi.fn() },
      }
    };
    expect((await new TenantAutomationService(deps).runRetention()).deleted_tickets).toBe(1);
    expect(objects).toEqual(new Set([legacy ? scopedKey : bodyKey]));
    expect(bucket.delete).toHaveBeenCalledTimes(1);
  });

});
