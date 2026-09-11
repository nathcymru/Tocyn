import { describe, expect, it, vi } from 'vitest';
import { WidgetKnowledgeReader } from '../tenant-knowledge.service';

describe('widget current document visibility', () => {
  it.each([null, { status: 'draft', tier: 'answer' }, { status: 'published', tier: 'sop' }])('drops stale published vectors when current row is %j', async (doc) => {
    const deps = { repositories: { knowledge: { getDocument: vi.fn().mockResolvedValue(doc) } }, vectorStorage: { query: vi.fn().mockResolvedValue({ matches: [{ score: 1, metadata: { source_id: 'doc', type: 'document', text: 'private stale text' } }] }) } };
    Object.assign(deps, { attachmentStorage: { getAttachment: vi.fn().mockResolvedValue({ body: new Response('Public answer').body }) } });
    const reader = new WidgetKnowledgeReader(deps as any, { generateEmbeddings: vi.fn().mockResolvedValue([1]) } as any);
    expect(await reader.search('question', 3)).toEqual([]);
    expect(deps.repositories.knowledge.getDocument).toHaveBeenCalledWith('doc');
  });
  it('reads current content instead of cached vector text and rejects unknown source types', async () => {
    const deps = { repositories: { knowledge: { getDocument: vi.fn().mockResolvedValue({ status: 'published', tier: 'answer', file_path: 'current-body' }) } }, vectorStorage: { query: vi.fn().mockResolvedValue({ matches: [
      { score: 1, metadata: { source_id: 'doc', type: 'document', text: 'Public answer' } },
      { score: 1, metadata: { source_id: 'bad', type: 'unknown', text: '<'.repeat(20) + 'p>'.repeat(20) } },
    ] }) } };
    Object.assign(deps, { attachmentStorage: { getAttachment: vi.fn().mockResolvedValue({ body: new Response('Public answer').body }) } });
    const reader = new WidgetKnowledgeReader(deps as any, { generateEmbeddings: vi.fn().mockResolvedValue([1]) } as any);
    expect(await reader.search('question', 3)).toEqual([{ content: 'Public answer' }]);
    expect(deps.vectorStorage.query).toHaveBeenCalledWith([1], expect.objectContaining({ topK: 3 }));
  });
  it('hydrates no more than the three current public answers selected by the bounded query', async () => {
    const getDocument = vi.fn().mockResolvedValue({ status: 'published', tier: 'answer', file_path: 'current-body' });
    const getAttachment = vi.fn().mockImplementation(async () => ({ body: new Response('Public answer').body }));
    const query = vi.fn().mockResolvedValue({ matches: Array.from({ length: 3 }, (_, index) => ({
      score: 1, metadata: { source_id: `doc-${index}`, type: 'document' },
    })) });
    const reader = new WidgetKnowledgeReader({ repositories: { knowledge: { getDocument } }, attachmentStorage: { getAttachment }, vectorStorage: { query } } as any,
      { generateEmbeddings: vi.fn().mockResolvedValue([1]) } as any);
    await expect(reader.search('question', 3)).resolves.toHaveLength(3);
    expect(getDocument).toHaveBeenCalledTimes(3);
    expect(getAttachment).toHaveBeenCalledTimes(3);
  });
});
