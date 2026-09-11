import { describe, expect, it, vi } from 'vitest';
import { TenantKnowledgeService } from '../tenant-knowledge.service';

describe('staff AI suggestion bounds', () => {
  it('uses only five recent messages and a topK-15 tenant Vectorize query', async () => {
    const query = vi.fn().mockResolvedValue({ matches: [] });
    const generateEmbeddings = vi.fn().mockResolvedValue(Array.from({ length: 1_024 }, () => 0));
    const generateSuggestion = vi.fn().mockResolvedValue('Draft');
    const articles = Array.from({ length: 5 }, (_, index) => ({ body: `Message ${index}`, body_r2_key: null,
      sender_type: index % 2 ? 'agent' : 'customer' }));
    const listRecentAiSuggestionMessages = vi.fn().mockResolvedValue(articles);
    const service = new TenantKnowledgeService({ repositories: {
      tickets: { get: vi.fn().mockResolvedValue({ id: 'ticket-a' }) },
      articles: { listRecentAiSuggestionMessages },
    }, attachmentStorage: {}, vectorStorage: { query } } as any, { generateEmbeddings, generateSuggestion } as any);

    await expect(service.getAiSuggestion('ticket-a')).resolves.toBe('Draft');
    expect(listRecentAiSuggestionMessages).toHaveBeenCalledWith('ticket-a');
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
      articles: { listRecentAiSuggestionMessages: vi.fn().mockResolvedValue([{ body: null, body_r2_key: 'body-a', body_r2_key_bytes: 6, sender_type: 'customer' }]) },
    }, attachmentStorage: { getAttachment: vi.fn().mockResolvedValue({ body }) }, vectorStorage: { query: vi.fn().mockResolvedValue({ matches: [] }) } } as any,
    { generateEmbeddings, generateSuggestion } as any);
    await expect(service.getAiSuggestion('ticket-a')).resolves.toBe('Draft');
    expect(new TextEncoder().encode(vi.mocked(generateEmbeddings).mock.calls[0][0]).byteLength).toBe(512);
    expect(new TextEncoder().encode(vi.mocked(generateSuggestion).mock.calls[0][0].input).byteLength).toBeLessThanOrEqual(2_048);
  });

  it('preserves the newest bounded message and rejects an oversized R2 key before hydration', async () => {
    const generateEmbeddings = vi.fn().mockResolvedValue([1]);
    const generateSuggestion = vi.fn().mockResolvedValue('Draft');
    const getAttachment = vi.fn();
    const service = new TenantKnowledgeService({ repositories: {
      tickets: { get: vi.fn().mockResolvedValue({ id: 'ticket-a' }) },
      // Repository order is newest first; the tail must remain available after chronological formatting.
      articles: { listRecentAiSuggestionMessages: vi.fn().mockResolvedValue([
        { body: `${'n'.repeat(1_000)} newest-marker`, body_r2_key: null, body_r2_key_bytes: 0, sender_type: 'customer' },
        ...Array.from({ length: 4 }, () => ({ body: 'o'.repeat(1_000), body_r2_key: null, body_r2_key_bytes: 0, sender_type: 'agent' })),
      ]) },
    }, attachmentStorage: { getAttachment }, vectorStorage: { query: vi.fn().mockResolvedValue({ matches: [] }) } } as any,
    { generateEmbeddings, generateSuggestion } as any);
    await expect(service.getAiSuggestion('ticket-a')).resolves.toBe('Draft');
    expect(vi.mocked(generateSuggestion).mock.calls[0][0].input).toContain('newest-marker');
    expect(getAttachment).not.toHaveBeenCalled();

    const keyRejected = new TenantKnowledgeService({ repositories: {
      tickets: { get: vi.fn().mockResolvedValue({ id: 'ticket-a' }) },
      articles: { listRecentAiSuggestionMessages: vi.fn().mockResolvedValue([
        { body: null, body_r2_key: null, body_r2_key_bytes: 1_025, sender_type: 'customer' },
      ]) },
    }, attachmentStorage: { getAttachment }, vectorStorage: { query: vi.fn() } } as any,
    { generateEmbeddings, generateSuggestion } as any);
    await expect(keyRejected.getAiSuggestion('ticket-a')).resolves.toContain('No text context');
    expect(getAttachment).not.toHaveBeenCalled();
  });
});
