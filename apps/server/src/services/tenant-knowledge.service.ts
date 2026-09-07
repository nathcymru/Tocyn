import { TenantRequestDeps } from '../middleware/tenant.middleware';
import { StatelessAiService } from './ai.service';
import { TenantArticleBodyHydrator } from '../storage/adapters';
import { KnowledgeDoc, KnowledgeCategory } from '../repositories/knowledge.repository';
import crypto from 'node:crypto';

export function stripTags(str: string): string {
  if (!str) return '';
  let current = str;
  let previous: string;
  let iterations = 0;
  do {
    previous = current;
    current = current.replace(/<[a-zA-Z\/][^>]*>/g, '');
    iterations++;
  } while (current !== previous && iterations < 10);
  return current;
}

export class TenantKnowledgeService {
  private hydrator: TenantArticleBodyHydrator;

  constructor(
    private deps: TenantRequestDeps,
    private aiService: StatelessAiService
  ) {
    this.hydrator = new TenantArticleBodyHydrator(
      deps.attachmentStorage,
      deps.legacyArticleStorage
    );
  }

  async listDocuments(): Promise<KnowledgeDoc[]> {
    return this.deps.repositories.knowledge.listDocuments();
  }

  async uploadAndProcess(title: string, fileName: string, content: Uint8Array, contentType: string, categoryId?: string, tier: 'answer'|'sop'='answer'): Promise<string> {
    if (content.length > 10 * 1024 * 1024) throw new Error('File too large');
    const safeFileName = fileName.replace(/^.*[\\\/]/, '').replace(/[^a-zA-Z0-9.\-_]/g, '_');
    const id = crypto.randomUUID();
    const filePath = `knowledge/${id}/${safeFileName}`;
    await this.deps.attachmentStorage.putAttachment(filePath, content, { httpMetadata: { contentType } });
    
    await this.deps.repositories.knowledge.createDocument({ id, title, file_path: filePath, category_id: categoryId, tier });
    const text = new TextDecoder().decode(content);
    const chunks = [text]; // mock chunking
    await this.deps.repositories.knowledge.updateDocument(id, { chunk_count: chunks.length });
    
    for (let i = 0; i < chunks.length; i++) {
      const chunkId = `doc_${id}_${i}`;
      const embedding = await this.aiService.generateEmbeddings(chunks[i]);
      await this.deps.vectorStorage.upsert(chunkId, embedding, { source_id: id, type: 'document', text: chunks[i], category_id: categoryId, tier,
        status: 'pending'
      });
    }
    return id;
  }
  async getDocument(id: string): Promise<KnowledgeDoc | null> {
    return this.deps.repositories.knowledge.getDocument(id);
  }

  async getArticleContent(id: string): Promise<string> {
    const doc = await this.deps.repositories.knowledge.getDocument(id);
    if (!doc) throw new Error('Document not found');

    const object = await this.deps.attachmentStorage.getAttachment(doc.file_path);
    if (!object) throw new Error('File not found in storage');

    return await object.text();
  }


  async createCategory(name: string, parentId?: string): Promise<string> {
    return this.deps.repositories.knowledge.createCategory(name, parentId);
  }

  async getCategories(): Promise<KnowledgeCategory[]> {
    return this.deps.repositories.knowledge.getCategories();
  }

  async deleteCategory(id: string): Promise<void> {
    await this.deps.repositories.knowledge.deleteCategory(id);
  }

  async createArticle(title: string, content: string, categoryId?: string | null, tier: 'answer' | 'sop' = 'answer'): Promise<string> {
    const id = crypto.randomUUID();
    const filePath = `knowledge/${id}/body.md`;
    await this.deps.attachmentStorage.putAttachment(filePath, content, { httpMetadata: { contentType: 'text/markdown' } });
    await this.deps.repositories.knowledge.createDocument({ id, title, file_path: filePath, category_id: categoryId, tier });
    
    // Chunk content and vectorize (mock chunking logic for now to match legacy)
    const chunks = [content];
    await this.deps.repositories.knowledge.updateDocument(id, { chunk_count: chunks.length });
    
    for (let i = 0; i < chunks.length; i++) {
      const chunkId = `doc_${id}_${i}`;
      const embedding = await this.aiService.generateEmbeddings(chunks[i]);
      await this.deps.vectorStorage.upsert(chunkId, embedding, {
        source_id: id,
        type: 'document',
        text: chunks[i],
        category_id: categoryId,
        tier,
        status: 'pending'
      });
    }

    return id;
  }

  async updateArticle(id: string, title: string, content: string, categoryId?: string | null, tier: 'answer' | 'sop' = 'answer', status: 'draft'|'pending'|'published' = 'pending'): Promise<void> {
    await this.deps.repositories.knowledge.updateDocument(id, { title, category_id: categoryId, tier, status });
    await this.deps.repositories.knowledge.updateDocument(id, { title, category_id: categoryId, tier });
    const filePath = `knowledge/${id}/body.md`;
    await this.deps.attachmentStorage.putAttachment(filePath, content, { httpMetadata: { contentType: 'text/markdown' } });
    // Assuming simple re-upsert for now
    const chunks = [content];
    await this.deps.repositories.knowledge.updateDocument(id, { chunk_count: chunks.length });
    
    for (let i = 0; i < chunks.length; i++) {
      const chunkId = `doc_${id}_${i}`;
      const embedding = await this.aiService.generateEmbeddings(chunks[i]);
      await this.deps.vectorStorage.upsert(chunkId, embedding, {
        source_id: id,
        type: 'document',
        text: chunks[i],
        category_id: categoryId,
        tier,
        status: 'pending'
      });
    }
  }

  async publishDocument(id: string): Promise<void> {
    const doc = await this.getDocument(id);
    if (!doc) throw new Error('Document not found');
    await this.deps.repositories.knowledge.updateDocument(id, { status: 'published' });
    const content = await this.getArticleContent(id);
    const chunks = [content];
    for (let i = 0; i < chunks.length; i++) {
      const chunkId = `doc_${id}_${i}`;
      const embedding = await this.aiService.generateEmbeddings(chunks[i]);
      await this.deps.vectorStorage.upsert(chunkId, embedding, {
        source_id: id,
        type: 'document',
        text: chunks[i],
        category_id: doc.category_id,
        tier: doc.tier,
        status: 'published'
      });
    }
  }

  async unpublishDocument(id: string): Promise<void> {
    const doc = await this.getDocument(id);
    if (!doc) throw new Error('Document not found');
    await this.deps.repositories.knowledge.updateDocument(id, { status: 'pending' });
    // Remove from vectorize to ensure it doesn't leak
    const chunkIds = Array.from({length: doc.chunk_count || 1}, (_, i) => `doc_${id}_${i}`);
    await this.deps.vectorStorage.deleteByIds(chunkIds);
  }

  async deleteDocument(id: string): Promise<void> {
    const doc = await this.getDocument(id);
    if (!doc) return;
    
    await this.deps.repositories.knowledge.deleteDocument(id);
    
    // Delete vectors
    const vectorIdsToDelete = [];
    for (let i = 0; i < (doc.chunk_count || 1); i++) {
      vectorIdsToDelete.push(`doc_${id}_${i}`);
    }
    await this.deps.vectorStorage.deleteByIds(vectorIdsToDelete);
  }

  async markArticleAsQA(articleId: string, type: 'answer' | 'sop' | null): Promise<void> {
    // Legacy marks this on 'articles', so use ArticleRepository
    const prevArticle = await this.deps.repositories.articles.get(articleId);
    if (!prevArticle) return;
    
    if (type) {
      const content = prevArticle.body || '';
      const chunkCount = 1;
      await this.deps.repositories.articles.updateQAState(articleId, type, chunkCount);
      
      const chunkId = `qa_${articleId}_0`;
      const embedding = await this.aiService.generateEmbeddings(content);
      await this.deps.vectorStorage.upsert(chunkId, embedding, {
        source_id: articleId,
        type: 'qa',
        text: content,
        tier: type, status: 'published'
      });
    } else {
      const chunkCount = prevArticle.chunk_count || 1;
      await this.deps.repositories.articles.updateQAState(articleId, null, 0);
      
      const vectorIdsToDelete = [];
      for (let i = 0; i < chunkCount; i++) {
        vectorIdsToDelete.push(`qa_${articleId}_${i}`);
      }
      await this.deps.vectorStorage.deleteByIds(vectorIdsToDelete);
    }
  }

  async getAiSuggestion(ticketId: string): Promise<string> {
    const ticket = await this.deps.repositories.tickets.get(ticketId);
    if (!ticket) return 'No context found.';

    const articles = await this.deps.repositories.articles.listByTicket(ticketId);
    if (!articles || articles.length === 0) return 'No context found.';
    
    const limitedArticles = articles.slice(0, 5); // top 5 recent

    const hydratedMessages = await Promise.all(
      limitedArticles.map(async (m: any) => {
        let bodyText = await this.hydrator.hydrate(m.body, m.body_r2_key, 8192);
        return {
          body: bodyText,
          sender_type: m.sender_type
        };
      })
    );

    const orderedMessages = hydratedMessages.reverse();

    const validMessages = orderedMessages.filter((m: any) => {
      if (!m.body) return false;
      return stripTags(m.body.substring(0, 8000)).trim().length > 0;
    });

    if (validMessages.length === 0) {
      return 'No text context found in recent messages to generate a suggestion.';
    }

    const lastValidMessage = stripTags(validMessages[validMessages.length - 1].body.substring(0, 8000)).trim();

    const chatHistory = orderedMessages.map((m: any) => {
      const cleanBody = stripTags(m.body).trim();
      return `${m.sender_type === 'customer' ? 'User' : 'Agent'}: ${cleanBody}`;
    }).join('\n');

    const relevantChunks = await this.searchWithFallback(lastValidMessage, 3);
    const hasSOP = relevantChunks.some((c: any) => c.tier === 'sop');
    const systemInstruction = hasSOP ?
      'IMPORTANT: The provided context contains Standard Operating Procedures (SOPs) meant for internal use only. DO NOT expose the raw SOP to the user. Instead, read the SOP and ask the user for the required information needed to fulfill it.' : undefined;

    return await this.aiService.generateSuggestion({
      input: chatHistory,
      context: relevantChunks.map((c) => c.content),
      systemInstruction
    });
  }

  async searchWithFallback(query: string, limit: number = 3, categoryId?: string): Promise<{ content: string, tier: string, score: number }[]> {
    const embedding = await this.aiService.generateEmbeddings(query);
    const filter: any = {};
    if (categoryId) filter.category_id = categoryId;

    let vectorResults = await this.deps.vectorStorage.query(embedding, {
      topK: limit * 5,
      filter: Object.keys(filter).length > 0 ? filter : undefined,
      returnMetadata: true
    });
    
    let matches = vectorResults.matches || [];

    matches = matches.filter((r: any) => {
      const tier = r.metadata?.tier || 'answer';
      if (tier === 'answer') return (r.score as number) >= 0.55;
      if (tier === 'sop') return (r.score as number) >= 0.50;
      return false;
    });

    matches.sort((a: any, b: any) => (b.score as number) - (a.score as number));
    matches = matches.slice(0, limit);

    return matches.map((r: any) => ({
      content: stripTags(r.metadata?.text || '').trim(),
      tier: (r.metadata?.tier as string) || 'answer',
      score: r.score as number
    }));
  }
}

export class WidgetKnowledgeReader {
  constructor(
    private deps: TenantRequestDeps,
    private aiService: StatelessAiService
  ) {}

  async search(query: string, limit: number = 3, categoryId?: string): Promise<{ content: string }[]> {
    const embedding = await this.aiService.generateEmbeddings(query);

    // Widget search EXCLUDES sop and drafts. Only tier = 'answer'.
    const filter: any = { tier: 'answer', status: 'published' };
    if (categoryId) filter.category_id = categoryId;

    let vectorResults = await this.deps.vectorStorage.query(embedding, {
      topK: limit,
      filter,
      returnMetadata: true
    });
    
    let matches = vectorResults.matches || [];
    matches = matches.filter((r: any) => (r.score as number) >= 0.60);

    return matches.map((r: any) => ({ content: stripTags(r.metadata?.text as string).trim() }));
  }
}
