import { describe, expect, it, vi } from 'vitest';
import { TenantKnowledgeService } from '../tenant-knowledge.service';

describe('staff AI suggestion bounds', () => {
  it('uses only five recent messages and a topK-15 tenant Vectorize query', async () => {
    const query = vi.fn().mockResolvedValue({ matches: [] });
    const generateEmbeddings = vi.fn().mockResolvedValue(Array.from({ length: 1_024 }, () => 0));
    const generateSuggestion = vi.fn().mockResolvedValue('Draft');
    const articles = Array.from({ length: 6 }, (_, index) => ({ body: `Message ${index}`, body_r2_key: null,
      sender_type: index % 2 ? 'agent' : 'customer' }));
    const service = new TenantKnowledgeService({ repositories: {
      tickets: { get: vi.fn().mockResolvedValue({ id: 'ticket-a' }) },
      articles: { listByTicket: vi.fn().mockResolvedValue(articles) },
    }, attachmentStorage: {}, vectorStorage: { query } } as any, { generateEmbeddings, generateSuggestion } as any);

    await expect(service.getAiSuggestion('ticket-a')).resolves.toBe('Draft');
    expect(query).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ topK: 15, returnMetadata: true }));
    expect(generateSuggestion).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.stringContaining('Message 4'), context: [],
    }));
    expect(vi.mocked(generateSuggestion).mock.calls[0][0].input).not.toContain('Message 5');
  });
});
