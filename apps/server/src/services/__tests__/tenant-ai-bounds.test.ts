import { describe, expect, it, vi } from 'vitest';
import { TenantKnowledgeService } from '../tenant-knowledge.service';

describe('staff AI suggestion bounds', () => {
  it('uses only five recent messages and a topK-15 tenant Vectorize query', async () => {
    const query = vi.fn().mockResolvedValue({ matches: [] });
    const generateEmbeddings = vi.fn().mockResolvedValue(Array.from({ length: 1_024 }, () => 0));
    const generateSuggestion = vi.fn().mockResolvedValue('Draft');
    const articles = Array.from({ length: 5 }, (_, index) => ({ body: `Message ${index}`, body_r2_key: null,
      sender_type: index % 2 ? 'agent' : 'customer' }));
    const listRecentByTicket = vi.fn().mockResolvedValue(articles);
    const service = new TenantKnowledgeService({ repositories: {
      tickets: { get: vi.fn().mockResolvedValue({ id: 'ticket-a' }) },
      articles: { listRecentByTicket },
    }, attachmentStorage: {}, vectorStorage: { query } } as any, { generateEmbeddings, generateSuggestion } as any);

    await expect(service.getAiSuggestion('ticket-a')).resolves.toBe('Draft');
    expect(listRecentByTicket).toHaveBeenCalledWith('ticket-a', 5);
    expect(query).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ topK: 15, returnMetadata: true }));
    expect(generateSuggestion).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.stringContaining('Message 4'), context: [],
    }));
    expect(vi.mocked(generateSuggestion).mock.calls[0][0].input).toContain('Message 0');
  });

  it('caps each stored or hydrated message at 8 KiB before it reaches embedding or the prompt', async () => {
    const oversize = 'x'.repeat(20_000);
    const generateEmbeddings = vi.fn().mockResolvedValue([1]);
    const generateSuggestion = vi.fn().mockResolvedValue('Draft');
    const body = new Response(oversize).body!;
    const service = new TenantKnowledgeService({ repositories: {
      tickets: { get: vi.fn().mockResolvedValue({ id: 'ticket-a' }) },
      articles: { listRecentByTicket: vi.fn().mockResolvedValue([{ body: null, body_r2_key: 'body-a', sender_type: 'customer' }]) },
    }, attachmentStorage: { getAttachment: vi.fn().mockResolvedValue({ body }) }, vectorStorage: { query: vi.fn().mockResolvedValue({ matches: [] }) } } as any,
    { generateEmbeddings, generateSuggestion } as any);
    await expect(service.getAiSuggestion('ticket-a')).resolves.toBe('Draft');
    expect(new TextEncoder().encode(vi.mocked(generateEmbeddings).mock.calls[0][0]).byteLength).toBe(512);
    expect(new TextEncoder().encode(vi.mocked(generateSuggestion).mock.calls[0][0].input).byteLength).toBeLessThanOrEqual(2_048);
  });
});
