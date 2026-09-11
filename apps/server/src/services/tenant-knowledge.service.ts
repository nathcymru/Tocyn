import { TenantRequestDeps } from '../middleware/tenant.middleware';
import { AI_SUGGESTION_MAX_INLINE_BODY_BYTES, AI_SUGGESTION_MAX_R2_KEY_BYTES } from '../repositories/interfaces';
import { StatelessAiService } from './ai.service';
import { TenantArticleBodyHydrator } from '../storage/adapters';
import { KnowledgeDoc, KnowledgeCategory } from '../repositories/knowledge.repository';
import { KnowledgeIndexRepository, decodeCompleteKnowledgePrefix, KNOWLEDGE_INDEX_MANIFEST_READ_BYTES, splitKnowledgeManifestBatch, knowledgeSourceFenceStatements } from '../repositories/knowledge-index.repository';
import { KNOWLEDGE_SOURCE_MAX_BYTES, validKnowledgeSourceText, KnowledgeSourceAdmissionError, type KnowledgeSourceAdmission, type KnowledgeSourceCommit } from '../budgets/knowledge-source-admission.service';
import crypto from 'node:crypto';
import { MAX_BGE_REQUEST_BYTES, MAX_STAFF_CONTEXT_BYTES, MAX_STAFF_HISTORY_BYTES, boundUntrustedAiText, truncateUtf8, truncateUtf8Tail } from './ai-input-bounds';

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

  if (current !== previous) {
    throw new Error("Maximum tag stripping depth exceeded: possible malicious input");
  }

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

  private admitted(admission: KnowledgeSourceAdmission): KnowledgeSourceCommit | undefined {
    if (admission.status === 'rejected') throw new Error('Knowledge source admission unavailable');
    return admission.status === 'admitted' ? admission.commit : undefined;
  }

  async uploadAndProcess(title: string, fileName: string, content: Uint8Array, contentType: string,
    categoryId?: string, tier: 'answer'|'sop'='answer', admission: KnowledgeSourceAdmission = {status:'disabled'}): Promise<string> {
    if (content.length > 10 * 1024 * 1024) throw new Error('File too large');
    const safeFileName = fileName.replace(/^.*[\\\/]/, '').replace(/[^a-zA-Z0-9.\-_]/g, '_');
    const id = crypto.randomUUID();
    const filePath = `knowledge/${id}/${safeFileName}`;
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(content); }
    catch { throw new Error('Knowledge source must be valid UTF-8 text'); }
    const commit = this.admitted(admission);
    try {
      if (commit) await commit.start();
      await this.stageSource(id,filePath,text,content,contentType,categoryId ?? null,tier,commit,
        [this.deps.repositories.knowledge.createDocumentStatement({id,title,file_path:filePath,category_id:categoryId,tier})]);
      commit?.settle('committed');
      return id;
    } catch (error) { commit?.settle('unknown'); if(commit && !(error instanceof KnowledgeSourceAdmissionError))throw new KnowledgeSourceAdmissionError('Knowledge source admission unavailable'); throw error; }
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

  async createArticle(title: string, content: string, categoryId?: string | null,
    tier: 'answer' | 'sop' = 'answer', admission: KnowledgeSourceAdmission = {status:'disabled'}): Promise<string> {
    if (!validKnowledgeSourceText(content)) throw new Error('Knowledge source exceeds 10 MiB');
    const id = crypto.randomUUID();
    const filePath = `knowledge/${id}/body.md`;
    const sourceTier = tier ?? 'answer', commit = this.admitted(admission);
    try {
      if (commit) await commit.start();
      await this.stageSource(id,filePath,content,content,'text/markdown',categoryId ?? null,sourceTier,commit,
        [this.deps.repositories.knowledge.createDocumentStatement({id,title,file_path:filePath,category_id:categoryId,tier:sourceTier})]);
      commit?.settle('committed');
      return id;
    } catch (error) { commit?.settle('unknown'); if(commit && !(error instanceof KnowledgeSourceAdmissionError))throw new KnowledgeSourceAdmissionError('Knowledge source admission unavailable'); throw error; }
  }

  async updateArticle(id: string, title: string, content: string, categoryId?: string | null,
    tier: 'answer' | 'sop' = 'answer', admission: KnowledgeSourceAdmission = {status:'disabled'}): Promise<void> {
    if (!validKnowledgeSourceText(content)) throw new Error('Knowledge source exceeds 10 MiB');
    const sourceTier = tier ?? 'answer', commit = this.admitted(admission);
    try {
      if (commit) await commit.start();
      const existing = await this.getDocument(id);
      if (!existing) throw new Error('Document not found');
      const filePath = `knowledge/${id}/body.md`;
      await this.stageSource(id,filePath,content,content,'text/markdown',categoryId ?? null,sourceTier,commit,
        this.deps.repositories.knowledge.updateDocumentRequiredStatements(id,{title,category_id:categoryId,tier:sourceTier,status:'pending'}));
      commit?.settle('committed');
    } catch (error) { commit?.settle('unknown'); if(commit && !(error instanceof KnowledgeSourceAdmissionError))throw new KnowledgeSourceAdmissionError('Knowledge source admission unavailable'); throw error; }
  }

  private async stageSource(documentId: string, filePath: string, text: string, source: Uint8Array | string, contentType: string,
    categoryId: string | null, tier: 'answer'|'sop', commit?: KnowledgeSourceCommit,
    initialStatements: readonly import('@cloudflare/workers-types').D1PreparedStatement[] = []): Promise<void> {
    if (!validKnowledgeSourceText(text)) throw new Error(`Knowledge source exceeds ${KNOWLEDGE_SOURCE_MAX_BYTES} bytes`);
    const index = new KnowledgeIndexRepository(this.deps.database, this.deps.scope);
    const sourceBytes = typeof source === 'string' ? new TextEncoder().encode(source).byteLength : source.byteLength;
    const staged = await index.begin(documentId,filePath,tier,categoryId,sourceBytes,'document',commit?.fence,initialStatements);
    try {
      await commit?.authorizeCurrent();
      const bytes = typeof source === 'string' ? new TextEncoder().encode(source) : source;
      const fingerprint = crypto.createHash('sha256').update(bytes).digest('hex');
      const put = await this.deps.attachmentStorage.putAttachment(staged.filePath,source,{ httpMetadata:{contentType},
        customMetadata:{tocynKnowledgeSourceFingerprint:fingerprint},onlyIf:{etagDoesNotMatch:'*'} });
      if (put?.res === null) throw new Error('Knowledge source capture conflicted');
      if (!await index.sourceCaptured(documentId,staged.version,commit?.fence,
        this.deps.repositories.knowledge.updateDocumentRequiredStatements(documentId,{file_path:staged.filePath,chunk_count:0,status:'pending'}))) {
        throw new Error('Knowledge source capture was superseded');
      }
    } catch(error) {
      try { await commit?.authorizeCurrent(); await index.sourceFailed(documentId,staged.version,commit?.fence); } catch { /* unresolved authority/result remains charged and source_pending */ }
      throw error;
    }
  }

  /** One workflow callback turns at most 100 R2-backed chunks into durable
   * manifest rows. It never reloads a full 10 MiB source. */
  async prepareManifestBatch(documentId: string, version: number): Promise<'next'|'ready'|'stale'|'missing'> {
    const index = new KnowledgeIndexRepository(this.deps.database, this.deps.scope);
    const preparation = await index.preparation(documentId, version);
    if (!preparation) return 'missing';
    try {
      const object = await this.deps.attachmentStorage.getAttachmentRange(preparation.filePath, preparation.sourceOffset, KNOWLEDGE_INDEX_MANIFEST_READ_BYTES);
      if (!object) { await index.sourceFailed(documentId, version); return 'missing'; }
      const bytes = new Uint8Array(await object.arrayBuffer());
      const decoded = decodeCompleteKnowledgePrefix(bytes);
      const sourceComplete = preparation.sourceOffset + bytes.byteLength >= preparation.sourceBytes;
      const chunks = splitKnowledgeManifestBatch(decoded.text, sourceComplete);
      if (!chunks.length || (!sourceComplete && chunks.reduce((sum, chunk) => sum + new TextEncoder().encode(chunk).byteLength, 0) === 0)) {
        await index.sourceFailed(documentId, version); return 'missing';
      }
      const consumed = chunks.reduce((sum, chunk) => sum + new TextEncoder().encode(chunk).byteLength, 0);
      const outcome = await index.publishPreparationBatch(documentId, preparation, chunks, consumed);
      if (outcome === 'ready') await this.deps.repositories.knowledge.updateDocument(documentId, { chunk_count: preparation.chunkIndex + chunks.length, status: 'pending' });
      return outcome;
    } catch (error) {
      await index.sourceFailed(documentId, version);
      throw error;
    }
  }

  /** Called only by the trusted workflow after it has admitted exactly one chunk. */
  async indexManifestChunk(documentId: string, version: number, chunkIndex: number): Promise<'next'|'complete'|'stale'|'missing'> {
    const index = new KnowledgeIndexRepository(this.deps.database, this.deps.scope);
    const doc = await this.getDocument(documentId);
    const source = await index.current(documentId, version);
    if (!doc || !source) return 'missing';
    if (source.source_kind !== 'document' || source.state !== 'pending' || !await index.isCurrent(documentId, version)
      || doc.file_path !== source.file_path || doc.tier !== source.tier || (doc.category_id ?? null) !== source.category_id) return 'stale';
    const chunk = await index.claim(documentId, version, chunkIndex);
    if (!chunk) return 'missing';
    try {
      const embedding = await this.aiService.generateEmbeddings(chunk.text);
      if (embedding.length !== 1_024) throw new Error('Unexpected embedding dimensions');
      await this.deps.vectorStorage.upsert(chunk.vectorId, embedding, { source_id: documentId, type: 'document', text: chunk.text,
        category_id: source.category_id, tier: source.tier, status: doc.status, source_version: version, chunk_index: chunkIndex });
      await index.indexed(documentId, version, chunkIndex);
      if (chunkIndex + 1 < source.chunk_count) return 'next';
      const complete = await index.completeIfFinished(documentId, version);
      if (complete) {
        // Re-checking the durable completion before publication prevents a
        // withdrawn or superseded source from becoming publicly visible.
        await this.deps.repositories.knowledge.updateDocument(documentId, { status: 'published' });
      }
      return complete ? 'complete' : 'next';
    } catch (error) {
      // A provider acknowledgement can be lost after a successful upsert. Do
      // not reset this claim into a free retry; recovery remains explicitly uncertain.
      await index.uncertain(documentId, version, chunkIndex);
      throw error;
    }
  }

  async pendingIndexVersion(documentId: string): Promise<number | null> {
    return new KnowledgeIndexRepository(this.deps.database, this.deps.scope).latestPending(documentId);
  }

  async pendingPreparationVersion(documentId: string): Promise<number | null> {
    return new KnowledgeIndexRepository(this.deps.database, this.deps.scope).latestPreparation(documentId);
  }

  async reservePendingIndexDispatch(documentId: string, version: number): Promise<boolean> {
    return new KnowledgeIndexRepository(this.deps.database, this.deps.scope).reserveDispatch(documentId, version);
  }

  async reservePendingDocumentCleanupDispatch(documentId: string): Promise<boolean> {
    return new KnowledgeIndexRepository(this.deps.database, this.deps.scope).reserveDocumentCleanupDispatch(documentId);
  }

  /** A deferred document-vector cleanup is one bounded external batch. */
  async cleanupDocumentManifestBatch(documentId: string): Promise<'next'|'complete'> {
    const index = new KnowledgeIndexRepository(this.deps.database, this.deps.scope);
    const chunks = await index.claimDocumentCleanup(documentId);
    if (!chunks.length) return 'complete';
    try {
      await this.deps.vectorStorage.deleteByIds(chunks.map(chunk => chunk.vectorId));
      await index.completeDocumentCleanup(documentId, chunks);
      return await index.hasPendingDocumentCleanup(documentId) ? 'next' : 'complete';
    } catch (error) {
      await index.releaseDocumentCleanup(documentId, chunks);
      throw error;
    }
  }

  /** Retention-claimed article counterpart of document indexing. */
  async indexQaManifestChunk(articleId: string, version: number, chunkIndex: number): Promise<'next'|'complete'|'stale'|'missing'> {
    const index = new KnowledgeIndexRepository(this.deps.database, this.deps.scope);
    const article = await this.deps.repositories.articles.get(articleId);
    const source = await index.current(articleId, version);
    if (!article || !source || source.source_kind !== 'article') return 'missing';
    if (source.state !== 'pending' || !await index.isCurrent(articleId, version) || article.qa_type !== source.tier) return 'stale';
    const chunk = await index.claim(articleId, version, chunkIndex);
    if (!chunk) return 'missing';
    try {
      const embedding = await this.aiService.generateEmbeddings(chunk.text);
      if (embedding.length !== 1_024) throw new Error('Unexpected embedding dimensions');
      await this.deps.vectorStorage.upsert(chunk.vectorId, embedding, {
        source_id: articleId, type: 'qa', text: chunk.text, tier: source.tier, status: 'published', source_version: version, chunk_index: chunkIndex });
      await index.indexed(articleId, version, chunkIndex);
      if (chunkIndex + 1 < source.chunk_count) return 'next';
      return await index.completeIfFinished(articleId, version) ? 'complete' : 'next';
    } catch (error) { await index.uncertain(articleId, version, chunkIndex); throw error; }
  }

  async publishDocument(id: string): Promise<void> {
    const doc = await this.getDocument(id);
    if (!doc) throw new Error('Document not found');
    // Legacy direct publication embedded an arbitrary source in this HTTP
    // route. A manifest is the only admitted provider path.
    if (await new KnowledgeIndexRepository(this.deps.database, this.deps.scope).hasAny(id)) return;
    throw new Error('Legacy vector publication requires a durable manifest migration');
  }

  async unpublishDocument(id: string): Promise<void> {
    const doc = await this.getDocument(id);
    if (!doc) throw new Error('Document not found');
    const index = new KnowledgeIndexRepository(this.deps.database, this.deps.scope);
    await this.deps.repositories.knowledge.updateDocument(id, { status: 'pending' });
    if (await index.hasAny(id)) await index.withdrawAll(id);
  }

  async deleteDocument(id: string): Promise<void> {
    const doc = await this.getDocument(id);
    if (!doc) return;
    const index = new KnowledgeIndexRepository(this.deps.database, this.deps.scope);
    if (await index.hasAny(id)) await index.withdrawAll(id);
    await this.deps.repositories.knowledge.deleteDocument(id);
  }

  async markArticleAsQA(articleId: string, type: 'answer' | 'sop' | null, admission?: KnowledgeSourceAdmission): Promise<void> {
    // Legacy marks this on 'articles', so use ArticleRepository
    const commit = type ? this.admitted(admission ?? {status:'rejected',reason:'unavailable'}) : undefined;
    if (commit) await commit.start();
    const prevArticle = await this.deps.repositories.articles.get(articleId);
    if (!prevArticle) {
      if (commit) { commit.settle('unknown'); throw new KnowledgeSourceAdmissionError('Knowledge source admission unavailable'); }
      return;
    }
    
    try {
      await this.deps.repositories.tickets.withExternalWrite(prevArticle.ticket_id, async () => {
      // Re-read under the durable write claim; retention cannot start until it ends.
      const current = await this.deps.repositories.articles.get(articleId);
      if (!current) {
        if (commit) throw new KnowledgeSourceAdmissionError('Knowledge source admission unavailable');
        return;
      }
      if (type) {
        const content = current.body || '';
        if (!validKnowledgeSourceText(content)) throw new Error('Knowledge source exceeds 10 MiB');
        const index = new KnowledgeIndexRepository(this.deps.database, this.deps.scope);
        const staged = await index.begin(articleId,current.body_r2_key || `article/${articleId}`,type,null,new TextEncoder().encode(content).byteLength,'article',commit?.fence);
        try {
          await commit?.authorizeCurrent();
          const fingerprint=crypto.createHash('sha256').update(content).digest('hex');
          const put=await this.deps.attachmentStorage.putAttachment(staged.filePath,content,{httpMetadata:{contentType:'text/plain'},
            customMetadata:{tocynKnowledgeSourceFingerprint:fingerprint},onlyIf:{etagDoesNotMatch:'*'}});
          if(put?.res===null)throw new Error('Knowledge source capture conflicted');
          if(!await index.sourceCaptured(articleId,staged.version,commit?.fence,
            this.deps.repositories.articles.updateQAStateRequiredStatements(articleId,type,0)))throw new Error('Knowledge source capture was superseded');
        } catch(error) {
          try { await commit?.authorizeCurrent(); await index.sourceFailed(articleId,staged.version,commit?.fence); } catch { /* unresolved authority/result remains charged and source_pending */ }
          throw error;
        }
      } else {
        const count = current.chunk_count || 0;
        // Revoke visibility before external deletion, retaining its cleanup manifest.
        await this.deps.repositories.articles.updateQAState(articleId, null, count);
        const index = new KnowledgeIndexRepository(this.deps.database, this.deps.scope);
        if (await index.hasAny(articleId)) await index.withdrawAll(articleId);
        await this.deps.repositories.articles.updateQAState(articleId, null, 0);
      }
      },commit ? () => knowledgeSourceFenceStatements(this.deps.database,this.deps.scope,commit.fence) : undefined);
      commit?.settle('committed');
    } catch(error) { commit?.settle('unknown'); if(commit && !(error instanceof KnowledgeSourceAdmissionError))throw new KnowledgeSourceAdmissionError('Knowledge source admission unavailable'); throw error; }
  }

  async getAiSuggestion(ticketId: string): Promise<string> {
    const ticket = await this.deps.repositories.tickets.get(ticketId);
    if (!ticket) return 'No context found.';

    // The composite tenant/ticket/created-at index backs this fixed newest-five
    // read. It replaces the unbounded conversation read followed by slice().
    const articles = await this.deps.repositories.articles.listRecentAiSuggestionMessages(ticketId);
    if (!articles || articles.length === 0) return 'No context found.';

    const hydratedMessages = await Promise.all(
      articles.map(async (m: any) => {
        const bodyText = m.body_r2_key_bytes > AI_SUGGESTION_MAX_R2_KEY_BYTES
          ? '' // Explicitly reject an unbounded object key before it can reach R2.
          : await this.hydrator.hydrate(m.body, m.body_r2_key, AI_SUGGESTION_MAX_INLINE_BODY_BYTES, AI_SUGGESTION_MAX_INLINE_BODY_BYTES);
        return {
          body: bodyText,
          sender_type: m.sender_type
        };
      })
    );

    // Repository order is newest-first; present the bounded recent window to
    // the model chronologically so the final valid message is the newest one.
    const orderedMessages = hydratedMessages.reverse();

    const validMessages = orderedMessages.filter((m: any) => {
      if (!m.body) return false;
      return stripTags(m.body.substring(0, 8000)).trim().length > 0;
    });

    if (validMessages.length === 0) {
      return 'No text context found in recent messages to generate a suggestion.';
    }

    const lastValidMessage = truncateUtf8(stripTags(validMessages[validMessages.length - 1].body.substring(0, 8000)).trim(), MAX_BGE_REQUEST_BYTES);

    const chatHistory = truncateUtf8Tail(orderedMessages.map((m: any) => {
      const cleanBody = stripTags(m.body).trim();
      return `${m.sender_type === 'customer' ? 'User' : 'Agent'}: ${cleanBody}`;
    }).join('\n').replace(/</g, '&lt;').replace(/>/g, '&gt;'), MAX_STAFF_HISTORY_BYTES);

    const relevantChunks = await this.searchWithFallback(lastValidMessage, 3);
    const hasSOP = relevantChunks.some((c: any) => c.tier === 'sop');
    const systemInstruction = hasSOP ?
      'IMPORTANT: The provided context contains Standard Operating Procedures (SOPs) meant for internal use only. DO NOT expose the raw SOP to the user. Instead, read the SOP and ask the user for the required information needed to fulfill it.' : undefined;

    const boundedContext = truncateUtf8(relevantChunks.map((chunk) => chunk.content).join('\n\n'), MAX_STAFF_CONTEXT_BYTES);
    return await this.aiService.generateSuggestion({
      input: chatHistory,
      context: boundedContext ? [boundedContext] : [],
      systemInstruction
    });
  }

  async searchWithFallback(query: string, limit: number = 3, categoryId?: string): Promise<{ content: string, tier: string, score: number }[]> {
    const embedding = await this.aiService.generateEmbeddings(boundUntrustedAiText(query, MAX_BGE_REQUEST_BYTES));
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

    const current = await Promise.all(matches.map(async (r: any) => {
      const sourceId = r.metadata?.source_id;
      const version = r.metadata?.source_version;
      if (typeof sourceId !== 'string') return null;
      const type = r.metadata?.type;
      const tier = (r.metadata?.tier as string) || 'answer';
      if (type === 'document') {
        const document = await this.deps.repositories.knowledge.getDocument(sourceId);
        if (!document || document.status !== 'published' || document.tier !== tier) return null;
      } else if (type === 'qa') {
        const article = await this.deps.repositories.articles.get(sourceId);
        // Staff may use current answer and SOP material, including internal
        // articles, but an unmarked article never remains retrieval context.
        if (!article || article.qa_type !== tier) return null;
      } else return null;
      // Versioned rows are served only from the currently selected source.
      // This closes the eventual-consistency gap while stale vectors await
      // their retained cleanup claim.
      if (Number.isSafeInteger(version) && version > 0
        && !await new KnowledgeIndexRepository(this.deps.database, this.deps.scope).isCurrent(sourceId, version)) return null;
      return {
        content: stripTags(r.metadata?.text || '').trim(),
        tier,
        score: r.score as number
      };
    }));
    return current.filter((result): result is { content: string, tier: string, score: number } => result !== null);
  }
}

export class WidgetKnowledgeReader {
  constructor(
    private deps: TenantRequestDeps,
    private aiService: StatelessAiService
  ) {}

  async search(query: string, limit: number = 3, categoryId?: string): Promise<{ content: string }[]> {
    const embedding = await this.aiService.generateEmbeddings(boundUntrustedAiText(query, MAX_BGE_REQUEST_BYTES));

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

    const results: { content: string }[] = [];
    for (const match of matches) {
      const metadata = match.metadata;
      if (!metadata || typeof metadata.source_id !== 'string') continue;
      let currentText = '';
      // Vector metadata is eventually consistent. Current D1 visibility is authoritative.
      if (metadata.type === 'document') {
        const doc = await this.deps.repositories.knowledge.getDocument(metadata.source_id);
        if (!doc || doc.status !== 'published' || doc.tier !== 'answer' || (categoryId && doc.category_id !== categoryId)) continue;
        const sourceVersion = metadata.source_version;
        const indexedText = typeof metadata.text === 'string' ? metadata.text : null;
        if (Number.isSafeInteger(sourceVersion) && sourceVersion > 0 && indexedText
          && new TextEncoder().encode(indexedText).byteLength <= 512
          && await new KnowledgeIndexRepository(this.deps.database, this.deps.scope).isCurrent(metadata.source_id, sourceVersion)) {
          // Current vectors select their own bounded chunk. Hydrating a whole
          // source here would incorrectly substitute its first 16 KiB for a
          // later semantic match.
          currentText = indexedText;
        } else if (!Number.isSafeInteger(sourceVersion)) {
          // Legacy vectors retain their established revalidation path until a
          // versioned manifest replaces them.
          currentText = await new TenantArticleBodyHydrator(this.deps.attachmentStorage).hydrate(null, doc.file_path, 16000);
        } else continue;
      } else if (metadata.type === 'qa') {
        const article = await this.deps.repositories.articles.get(metadata.source_id);
        if (!article || article.is_internal || article.qa_type !== 'answer' || categoryId) continue;
        currentText = await new TenantArticleBodyHydrator(this.deps.attachmentStorage, this.deps.legacyArticleStorage).hydrate(article.body || null, article.body_r2_key || null, 16000);
      } else {
        continue;
      }
      try {
        const content = stripTags(currentText.slice(0, 16000)).trim();
        if (content) results.push({ content });
      } catch {
        // Reject a malformed result without sending it to AI or failing other answers.
      }
    }
    return results;
  }
}
