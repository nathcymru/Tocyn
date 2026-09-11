import { Hono } from 'hono';
import { Env } from '../bindings';
import { authMiddleware } from '../middleware/auth.middleware';
import { mfaGuard } from '../middleware/mfa.guard';
import { roleGuard } from '../middleware/role.guard';
import { TenantKnowledgeService } from '../services/tenant-knowledge.service';
import { StatelessAiService } from '../services/ai.service';
import { tenantMiddleware, TenantRequestDeps } from '../middleware/tenant.middleware';
import { AppVariables } from '../types';
import { z } from 'zod';
import { admitHttpAi } from '../budgets/http-ai-admission.service';
import { ticketMutationAdmissionMode } from '../middleware/budget-admission.middleware';
import { admitKnowledgeSourceWrite, KNOWLEDGE_SOURCE_MAX_BYTES, KnowledgeSourceAdmissionError, type KnowledgeSourceAdmission } from '../budgets/knowledge-source-admission.service';
import { admitKnowledgeRead, type KnowledgeReadAdmission, type KnowledgeReadOperation } from '../budgets/knowledge-read-admission.service';
import { KnowledgeReadFenceError, KnowledgeReadRepository } from '../repositories/knowledge-read.repository';

const staffSuggestionFallback = "I'm sorry, I'm having trouble generating a suggestion right now. Please try again or draft a manual response.";

const knowledgeHandler = new Hono<{ Bindings: Env; Variables: AppVariables }>();
const qaMarkerSchema = z.object({ type: z.enum(['answer', 'sop']).nullable() });

/** A source is durable before this best-effort dispatch. The pending job remains
 * visible and recoverable if the workflow binding is unavailable. */
async function dispatchPendingIndex(c: any, service: TenantKnowledgeService, documentId: string, action: 'index'|'qa_index' = 'index'): Promise<void> {
  if (ticketMutationAdmissionMode(c.env) !== 'combined' || !c.env.VECTORIZE_WORKFLOW) return;
  const preparation = await service.pendingPreparationVersion(documentId);
  const version = preparation ?? await service.pendingIndexVersion(documentId);
  if (version === null) return;
  if (!await service.reservePendingIndexDispatch(documentId, version)) return;
  try { await c.env.VECTORIZE_WORKFLOW.create({ params: { tenantId: c.get('tenantDeps').scope.tenantId, action: preparation === null ? action : 'prepare', documentId, version } }); }
  catch { /* durable job remains pending; do not misreport source capture as indexed */ }
}

async function dispatchPendingDocumentCleanup(c: any, service: TenantKnowledgeService, documentId: string): Promise<void> {
  if (ticketMutationAdmissionMode(c.env) !== 'combined' || !c.env.VECTORIZE_WORKFLOW) return;
  if (!await service.reservePendingDocumentCleanupDispatch(documentId)) return;
  try { await c.env.VECTORIZE_WORKFLOW.create({ params: { tenantId: c.get('tenantDeps').scope.tenantId, action: 'cleanup', documentId } }); }
  catch { /* the durable cleanup target remains recoverable */ }
}

async function admitSourceOrResponse(c: any, sourceBytes: number, sourceKind: 'document'|'article'|'qa'): Promise<Response | KnowledgeSourceAdmission> {
  const deps = c.get('tenantDeps') as TenantRequestDeps;
  const outcome = await admitKnowledgeSourceWrite({ env: c.env, deps, payload: c.get('jwtPayload'), sourceBytes, sourceKind,
    now: () => c.env.localNow?.() ?? Date.now() });
  if (outcome.status === 'admitted' || outcome.status === 'disabled') return outcome;
  return outcome.reason === 'exhausted'
    ? c.json({ code: 'budget_exhausted', error: 'Configured budget capacity is exhausted' }, 429)
    : c.json({ code: 'budget_admission_unavailable', error: 'Budget admission authority is unavailable' }, 503);
}

async function admitReadOrResponse(c:any,operation:KnowledgeReadOperation,documentId?:string):Promise<Response|Exclude<KnowledgeReadAdmission,{status:'rejected'}>>{
  const outcome=await admitKnowledgeRead({env:c.env,deps:c.get('tenantDeps'),payload:c.get('jwtPayload'),operation,documentId,
    now:()=>c.env.localNow?.()??Date.now()});
  if(outcome.status==='admitted'||outcome.status==='disabled')return outcome;
  return outcome.reason==='exhausted'
    ?c.json({code:'budget_exhausted',error:'Configured budget capacity is exhausted'},429)
    :c.json({code:'budget_admission_unavailable',error:'Budget admission authority is unavailable'},503);
}

knowledgeHandler.onError((error, c) => {
  if (error instanceof KnowledgeSourceAdmissionError || error instanceof KnowledgeReadFenceError) {
    return c.json({ code: 'budget_admission_unavailable', error: 'Budget admission authority is unavailable' }, 503);
  }
  if (error.message === 'Maximum tag stripping depth exceeded: possible malicious input') {
    return c.json({ error: 'Content exceeds supported markup depth' }, 422);
  }
  return c.json({ error: 'Unable to process knowledge request' }, 500);
});

knowledgeHandler.use('*', authMiddleware, mfaGuard, roleGuard(['agent', 'admin']), tenantMiddleware);

// Article Endpoints
knowledgeHandler.get('/articles', async (c) => {
  const deps = c.get('tenantDeps') as TenantRequestDeps;
  const admission=await admitReadOrResponse(c,'knowledge.article.list');
  if(admission instanceof Response)return admission;
  const aiService = new StatelessAiService(c.env.AI, deps.emitResourceOperation);
  const service = new TenantKnowledgeService(deps, aiService);
  let docs;
  if(admission.status==='disabled')docs=await service.listDocuments();
  else try{
    docs=await new KnowledgeReadRepository(deps.database,deps.scope).list(await admission.commit.start());
    admission.commit.settle('committed');
  }catch(error){admission.commit.settle('unknown');throw error;}
  return c.json(docs);
});

knowledgeHandler.get('/articles/:id', async (c) => {
  const id = c.req.param('id');
  const deps = c.get('tenantDeps') as TenantRequestDeps;
  const admission=await admitReadOrResponse(c,'knowledge.article.detail',id);
  if(admission instanceof Response)return admission;
  const aiService = new StatelessAiService(c.env.AI, deps.emitResourceOperation);
  const service = new TenantKnowledgeService(deps, aiService);
  let doc;
  if(admission.status==='disabled')doc=await service.getDocument(id);
  else try{
    doc=await new KnowledgeReadRepository(deps.database,deps.scope).detail(id,await admission.commit.start());
    admission.commit.settle('committed');
  }catch(error){admission.commit.settle('unknown');throw error;}
  if (!doc) {
    return c.json({ error: 'Document not found' }, 404);
  }
  return c.json(doc);
});

knowledgeHandler.delete('/articles/:id', async (c) => {
  const id = c.req.param('id');
  const deps = c.get('tenantDeps') as TenantRequestDeps;
  const aiService = new StatelessAiService(c.env.AI, deps.emitResourceOperation);
  const service = new TenantKnowledgeService(deps, aiService);
  await service.deleteDocument(id);
  await dispatchPendingDocumentCleanup(c, service, id);
  return c.json({ success: true });
});

// For backward compatibility or if used by other components
knowledgeHandler.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const deps = c.get('tenantDeps') as TenantRequestDeps;
  const aiService = new StatelessAiService(c.env.AI, deps.emitResourceOperation);
  const service = new TenantKnowledgeService(deps, aiService);
  await service.deleteDocument(id);
  await dispatchPendingDocumentCleanup(c, service, id);
  return c.json({ success: true });
});

knowledgeHandler.post('/articles/:id/qa', async (c) => {
  const id = c.req.param('id');
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid QA marker type' }, 400);
  }
  const parsed = qaMarkerSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Invalid QA marker type' }, 400);
  const { type } = parsed.data;
  const deps = c.get('tenantDeps') as TenantRequestDeps;
  let sourceAdmission: KnowledgeSourceAdmission | undefined;
  if (type) {
    const admission = await admitSourceOrResponse(c, KNOWLEDGE_SOURCE_MAX_BYTES, 'qa');
    if (admission instanceof Response) return admission;
    sourceAdmission = admission;
  }
  const aiService = new StatelessAiService(c.env.AI, deps.emitResourceOperation);
  const service = new TenantKnowledgeService(deps, aiService);
  await service.markArticleAsQA(id, type, sourceAdmission);
  if (type) await dispatchPendingIndex(c, service, id, 'qa_index');
  return type ? c.json({ success: true, indexing: 'pending' }, 202) : c.json({ success: true });
});

knowledgeHandler.get('/articles/:id/content', async (c) => {
  const id = c.req.param('id');
  const deps = c.get('tenantDeps') as TenantRequestDeps;
  const admission=await admitReadOrResponse(c,'knowledge.article.content',id);
  if(admission instanceof Response)return admission;
  const aiService = new StatelessAiService(c.env.AI, deps.emitResourceOperation);
  const service = new TenantKnowledgeService(deps, aiService);
  try {
    let content:string;
    if(admission.status==='disabled')content=await service.getArticleContent(id);
    else{
      const source=await new KnowledgeReadRepository(deps.database,deps.scope).contentSource(id,await admission.commit.start());
      if(!source)throw new Error('Document not found');
      await admission.commit.authorizeCurrent();
      const object=await deps.attachmentStorage.getAttachment(source.filePath);
      if(!object)throw new Error('File not found in storage');
      if((source.versioned&&object.size!==source.sourceBytes)||(!source.versioned&&object.size>source.sourceBytes))
        throw new KnowledgeReadFenceError('authority_changed');
      content=await object.text();
      admission.commit.settle('committed');
    }
    return c.json({ content });
  } catch (error: any) {
    if(admission.status==='admitted')admission.commit.settle('unknown');
    if(error instanceof KnowledgeReadFenceError)return c.json({code:'budget_admission_unavailable',error:'Budget admission authority is unavailable'},503);
    return c.json({ error: error.message }, 404);
  }
});

// File upload (keep at root or move to /articles/upload)
knowledgeHandler.post('/', async (c) => {
  const body = await c.req.parseBody();
  const file = body['file'] as File;

  if (!file) {
    return c.json({ error: 'No file provided' }, 400);
  }

  const title = (body['title'] as string) || file.name;

  const deps = c.get('tenantDeps') as TenantRequestDeps;
  const aiService = new StatelessAiService(c.env.AI, deps.emitResourceOperation);
  const service = new TenantKnowledgeService(deps, aiService);
  const content = new Uint8Array(await file.arrayBuffer());
  if (content.byteLength > KNOWLEDGE_SOURCE_MAX_BYTES) return c.json({ error: 'Knowledge source exceeds 10 MiB' }, 422);
  const admission = await admitSourceOrResponse(c, content.byteLength, 'document');
  if (admission instanceof Response) return admission;
  const docId = await service.uploadAndProcess(title, file.name, content, file.type, undefined, undefined, admission);
  await dispatchPendingIndex(c, service, docId);

  return c.json({ id: docId, indexing: 'pending' }, 202);
});

// AI Suggestions
knowledgeHandler.get('/tickets/:id/ai-suggest', async (c) => {
  const id = c.req.param('id');
  const deps = c.get('tenantDeps') as TenantRequestDeps;
  const admission = await admitHttpAi({ env: c.env, deps, payload: c.get('jwtPayload'), operation: 'dashboard.ticket.ai-suggest', targetId: id,
    now: () => c.env.localNow?.() ?? Date.now() });
  // Do not disclose budget state to staff callers. In particular, a rejected
  // grant must not read a ticket, hydrate an R2 body, or retrieve private SOPs.
  if (admission.status !== 'admitted') return c.json({ suggestion: staffSuggestionFallback });
  const aiService = new StatelessAiService(c.env.AI, deps.emitResourceOperation);
  const service = new TenantKnowledgeService(deps, aiService);
  try {
    const suggestion = await service.getAiSuggestion(id);
    return c.json({ suggestion });
  } catch (error) {
    // Preserve the explicit malformed-markup response while keeping a charged
    // provider/storage failure to its single admitted attempt.
    if (error instanceof Error && error.message === 'Maximum tag stripping depth exceeded: possible malicious input') throw error;
    return c.json({ suggestion: staffSuggestionFallback });
  }
});

// Zod schemas for new endpoints - using snake_case to match frontend
const categorySchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name is too long'),
  parent_id: z.string().uuid().optional().nullable(),
});

const articleSchema = z.object({
  title: z.string().min(1, 'Title is required').max(255, 'Title is too long'),
  content: z.string().min(1, 'Content is required'),
  category_id: z.string().uuid().optional().nullable(),
  tier: z.enum(['answer', 'sop']).optional(),
});

// Category endpoints
knowledgeHandler.get('/categories', async (c) => {
  const deps = c.get('tenantDeps') as TenantRequestDeps;
  const aiService = new StatelessAiService(c.env.AI, deps.emitResourceOperation);
  const service = new TenantKnowledgeService(deps, aiService);
  const categories = await service.getCategories();
  return c.json(categories);
});

knowledgeHandler.post('/categories', async (c) => {
  const body = await c.req.json();
  const result = categorySchema.safeParse(body);
  if (!result.success) {
    return c.json({ error: result.error.errors[0].message }, 400);
  }

  const { name, parent_id } = result.data;
  const deps = c.get('tenantDeps') as TenantRequestDeps;
  const aiService = new StatelessAiService(c.env.AI, deps.emitResourceOperation);
  const service = new TenantKnowledgeService(deps, aiService);
  const id = await service.createCategory(name, parent_id || undefined);
  return c.json({ id });
});

knowledgeHandler.delete('/categories/:id', async (c) => {
  const id = c.req.param('id');
  const deps = c.get('tenantDeps') as TenantRequestDeps;
  const aiService = new StatelessAiService(c.env.AI, deps.emitResourceOperation);
  const service = new TenantKnowledgeService(deps, aiService);
  try {
    await service.deleteCategory(id);
    return c.json({ success: true });
  } catch (error: any) {
    if (error.message?.includes('contains articles')) {
      return c.json({ error: error.message }, 400);
    }
    throw error;
  }
});

// Created articles (Markdown editor)
knowledgeHandler.post('/articles', async (c) => {
  const body = await c.req.json();
  const result = articleSchema.safeParse(body);
  if (!result.success) {
    return c.json({ error: result.error.errors[0].message }, 400);
  }

  const { title, content, category_id, tier } = result.data;
  const sourceBytes = new TextEncoder().encode(content).byteLength;
  if (sourceBytes > KNOWLEDGE_SOURCE_MAX_BYTES) return c.json({ error: 'Knowledge source exceeds 10 MiB' }, 422);
  const deps = c.get('tenantDeps') as TenantRequestDeps;
  const admission = await admitSourceOrResponse(c, sourceBytes, 'article');
  if (admission instanceof Response) return admission;
  const aiService = new StatelessAiService(c.env.AI, deps.emitResourceOperation);
  const service = new TenantKnowledgeService(deps, aiService);
  const id = await service.createArticle(title, content, category_id || null, tier, admission);
  await dispatchPendingIndex(c, service, id);
  return c.json({ id, indexing: 'pending' }, 202);
});

knowledgeHandler.put('/articles/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const result = articleSchema.safeParse(body);
  if (!result.success) {
    return c.json({ error: result.error.errors[0].message }, 400);
  }

  const { title, content, category_id, tier } = result.data;
  const sourceBytes = new TextEncoder().encode(content).byteLength;
  if (sourceBytes > KNOWLEDGE_SOURCE_MAX_BYTES) return c.json({ error: 'Knowledge source exceeds 10 MiB' }, 422);
  const deps = c.get('tenantDeps') as TenantRequestDeps;
  const admission = await admitSourceOrResponse(c, sourceBytes, 'article');
  if (admission instanceof Response) return admission;
  const aiService = new StatelessAiService(c.env.AI, deps.emitResourceOperation);
  const service = new TenantKnowledgeService(deps, aiService);
  await service.updateArticle(id, title, content, category_id || null, tier, admission);
  await dispatchPendingIndex(c, service, id);
  return c.json({ success: true, indexing: 'pending' }, 202);
});

export default knowledgeHandler;
