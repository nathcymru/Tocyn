import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../bindings';
import type { AppVariables } from '../types';
import type { TenantRequestDeps } from '../middleware/tenant.middleware';
import { requestBounds } from '../middleware/request-bounds';
import { MutationInputError, readMutationJson } from './mutation-request';
import { OPERATOR_WORKSPACE_SORTS, OPERATOR_WORKSPACE_VIEWS } from '../types/operator-workspace';
import { OperatorWorkspaceError, OperatorWorkspaceService } from '../services/operator-workspace.service';
import { AttachmentReferenceError } from '../services/attachment-references';

const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const generation = z.string().uuid();
const boundedText = (maxCharacters: number, maxBytes: number) => z.string().max(maxCharacters).refine(value => new TextEncoder().encode(value).length <= maxBytes);
const ticketId = z.string().min(1).max(128);
const attachment = z.object({ storageKey: z.string().min(1).max(1024), filename: z.string().min(1).max(255) }).passthrough();
const draftInput = z.object({
  expectedGeneration: generation.nullable(), expectedRevision: revision, mode: z.enum(['public', 'internal']),
  body: boundedText(16000, 16000), attachments: z.array(attachment).max(10),
}).strict().superRefine((value, ctx) => {
  if ((value.expectedRevision === 0) !== (value.expectedGeneration === null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Draft version must be empty only for a new draft' });
  }
});
const filters = z.object({
  status: z.enum(['open', 'pending', 'resolved', 'closed']).optional(), priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  assignedTo: z.string().min(1).max(128).nullable().optional(), groupId: z.string().min(1).max(128).nullable().optional(),
  filterId: z.string().min(1).max(128).nullable().optional(),
}).strict();
const stateInput = z.object({
  expectedRevision: revision, view: z.enum(OPERATOR_WORKSPACE_VIEWS), sort: z.enum(OPERATOR_WORKSPACE_SORTS), filters,
  listQuery: boundedText(512, 512), listAnchor: boundedText(512, 512), selectedTicketId: ticketId.nullable(), panel: z.enum(['conversation', 'details']),
}).strict();

const workspace = new Hono<{ Bindings: Env; Variables: AppVariables }>();
workspace.use('*', async (c, next) => {
  c.header('Cache-Control', 'private, no-store');
  await next();
});
workspace.use('*', requestBounds(64 * 1024));
function service(c: any) { return new OperatorWorkspaceService(c.get('tenantDeps') as TenantRequestDeps); }
function failure(c: any, error: unknown) {
  if (error instanceof MutationInputError) return c.json({ error: error.message, code: error.code }, error.status);
  if (error instanceof OperatorWorkspaceError) return c.json({ error: error.message }, error.status);
  if (error instanceof AttachmentReferenceError) return c.json({ error: 'Invalid attachment reference' }, 400);
  throw error;
}

workspace.get('/state', async c => { try { return c.json(await service(c).getWorkspaceState()); } catch (error) { return failure(c, error); } });
workspace.put('/state', async c => {
  try {
    const parsed = stateInput.safeParse(await readMutationJson(c));
    if (!parsed.success) return c.json({ error: 'Invalid workspace state' }, 400);
    return c.json(await service(c).saveWorkspaceState(parsed.data));
  } catch (error) { return failure(c, error); }
});
workspace.get('/drafts', async c => {
  const after = z.string().max(128).safeParse(c.req.query('after') ?? '');
  const limit = z.coerce.number().int().min(1).max(50).safeParse(c.req.query('limit') ?? '50');
  if (!after.success || !limit.success) return c.json({ error: 'Invalid draft page' }, 400);
  try { return c.json(await service(c).listDrafts(after.data, limit.data)); } catch (error) { return failure(c, error); }
});
workspace.get('/drafts/:ticketId', async c => {
  const parsed = ticketId.safeParse(c.req.param('ticketId'));
  if (!parsed.success) return c.json({ error: 'Invalid ticket ID' }, 400);
  try { const draft = await service(c).getDraft(parsed.data); return draft ? c.json(draft) : c.body(null, 204); } catch (error) { return failure(c, error); }
});
workspace.put('/drafts/:ticketId', async c => {
  try {
    const id = ticketId.safeParse(c.req.param('ticketId')); const parsed = draftInput.safeParse(await readMutationJson(c));
    if (!id.success || !parsed.success) return c.json({ error: 'Invalid draft' }, 400);
    return c.json(await service(c).saveDraft({ ...parsed.data, ticketId: id.data }));
  } catch (error) { return failure(c, error); }
});
workspace.delete('/drafts/:ticketId', async c => {
  const id = ticketId.safeParse(c.req.param('ticketId'));
  const parsedRevision = revision.safeParse(Number(c.req.query('revision')));
  const parsedGeneration = generation.safeParse(c.req.query('generation'));
  if (!id.success || !parsedRevision.success || parsedRevision.data === 0 || !parsedGeneration.success) return c.json({ error: 'Invalid draft version' }, 400);
  try { await service(c).deleteDraftIfVersion(id.data, parsedGeneration.data, parsedRevision.data); return c.body(null, 204); } catch (error) { return failure(c, error); }
});

export default workspace;
