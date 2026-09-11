import { Hono } from 'hono';
import { z } from 'zod';
import { ARTICLE_BODY_FORMATS, DEFAULT_ARTICLE_BODY_FORMAT } from '@luminatick/shared';
import type { Env } from '../bindings';
import type { AppVariables } from '../types';
import type { TenantRequestDeps } from '../middleware/tenant.middleware';
import { requestBounds } from '../middleware/request-bounds';
import { MutationInputError, readMutationJson } from './mutation-request';
import { OPERATOR_WORKSPACE_SORTS, OPERATOR_WORKSPACE_VIEWS } from '../types/operator-workspace';
import { OperatorWorkspaceError, OperatorWorkspaceService } from '../services/operator-workspace.service';
import { AttachmentReferenceError } from '../services/attachment-references';
import { LOCAL_DRAFT_RETENTION } from '../types/operator-draft-retention';
import { OperatorWorkspaceFenceError, type OperatorPresentationCredential, type OperatorWorkspaceCommit } from '../repositories/operator-workspace.repository';
import { admitOperatorWorkspace, type WorkspaceAdmission, type WorkspaceAdmissionOperation } from '../budgets/operator-workspace-admission.service';

const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const generation = z.string().uuid();
const boundedText = (maxCharacters: number, maxBytes: number) => z.string().max(maxCharacters).refine(value => new TextEncoder().encode(value).length <= maxBytes);
const ticketId = z.string().min(1).max(128);
const attachment = z.object({ storageKey: z.string().min(1).max(1024), filename: z.string().min(1).max(255) }).passthrough();
const draftInput = z.object({
  expectedGeneration: generation.nullable(), expectedRevision: revision, mode: z.enum(['public', 'internal']),
  body: boundedText(16000, 16000), bodyFormat: z.enum(ARTICLE_BODY_FORMATS).default(DEFAULT_ARTICLE_BODY_FORMAT), attachments: z.array(attachment).max(10),
  mentionedUserIds: z.array(z.string().uuid()).max(16).default([]),
}).strict().superRefine((value, ctx) => {
  if ((value.expectedRevision === 0) !== (value.expectedGeneration === null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Draft version must be empty only for a new draft' });
  }
});
const draftRebaseInput = z.object({
  expectedGeneration: generation, expectedRevision: revision.min(1),
  expectedReviewedConversationRevision: revision,
}).strict();
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
const themePreferenceInput = z.object({ expectedRevision: revision, mode: z.enum(['light', 'dark', 'system']) }).strict();
const presentationPreferenceInput = z.object({ version: z.literal(1), expectedRevision: revision,
  density: z.enum(['comfortable', 'compact']), fontScale: z.enum(['normal', 'large', 'larger']), focusMode: z.boolean(), motion: z.enum(['system', 'reduced', 'full']) }).strict();
function themeCredential(c: any): OperatorPresentationCredential {
  const payload = c.get('jwtPayload');
  if (!payload || !['admin', 'agent'].includes(payload.role) || !Number.isSafeInteger(payload.session_version ?? 0)
    || !Number.isSafeInteger(payload.exp)) throw new OperatorWorkspaceError(403, 'Operator session required');
  return { role: payload.role, sessionVersion: payload.session_version ?? 0, expiresAt: payload.exp };
}
workspace.use('*', async (c, next) => {
  c.header('Cache-Control', 'private, no-store');
  await next();
});
workspace.use('*', requestBounds(64 * 1024));
function service(c: any, admission?: OperatorWorkspaceCommit) {
  const localRetention = c.env.ENVIRONMENT === 'local' && c.env.LOCAL_BETA_ENABLED === 'true';
  return new OperatorWorkspaceService(c.get('tenantDeps') as TenantRequestDeps,
    { ...(localRetention ? { retention: LOCAL_DRAFT_RETENTION } : {}), ...(admission ? { admission } : {}) });
}
function failure(c: any, error: unknown) {
  if (error instanceof MutationInputError) return c.json({ error: error.message, code: error.code }, error.status);
  if (error instanceof OperatorWorkspaceError) return c.json({ error: error.message }, error.status);
  if (error instanceof OperatorWorkspaceFenceError) return c.json({ code: 'budget_admission_unavailable', error: 'Budget admission authority is unavailable' }, 503);
  if (error instanceof AttachmentReferenceError) return c.json({ error: 'Invalid attachment reference' }, 400);
  throw error;
}
async function admission(c: any, operation: WorkspaceAdmissionOperation, ticketId?: string): Promise<WorkspaceAdmission> {
  return admitOperatorWorkspace({ env: c.env, deps: c.get('tenantDeps') as TenantRequestDeps, payload: c.get('jwtPayload'), operation, ticketId,
    now: () => c.env.localNow?.() ?? Date.now() });
}
function admissionFailure(c: any, result: WorkspaceAdmission): Response | null {
  return result.status === 'rejected' ? c.json(result.reason === 'exhausted'
    ? { code: 'budget_exhausted', error: 'Configured budget capacity is exhausted' }
    : { code: 'budget_admission_unavailable', error: 'Budget admission authority is unavailable' }, result.reason === 'exhausted' ? 429 : 503) : null;
}
const admittedCommit = (result: WorkspaceAdmission) => result.status === 'admitted' ? result.commit : undefined;

workspace.get('/state', async c => { try { const gate = await admission(c, 'workspace.state.read'); const denied = admissionFailure(c, gate); if (denied) return denied; return c.json(await service(c, admittedCommit(gate)).getWorkspaceState()); } catch (error) { return failure(c, error); } });
workspace.put('/state', async c => {
  try {
    const parsed = stateInput.safeParse(await readMutationJson(c));
    if (!parsed.success) return c.json({ error: 'Invalid workspace state' }, 400);
    const gate = await admission(c, 'workspace.state.write', parsed.data.selectedTicketId ?? undefined); const denied = admissionFailure(c, gate); if (denied) return denied;
    return c.json(await service(c, admittedCommit(gate)).saveWorkspaceState(parsed.data));
  } catch (error) { return failure(c, error); }
});
workspace.get('/theme-preference', async c => {
  try {
    const gate = await admission(c, 'workspace.theme.read'); const denied = admissionFailure(c, gate); if (denied) return denied;
    const repository = (c.get('tenantDeps') as TenantRequestDeps).repositories.operatorWorkspace;
    const result = await repository.getThemePreference(themeCredential(c), admittedCommit(gate));
    if (!result) throw new OperatorWorkspaceError(403, 'Operator session changed');
    return c.json(result);
  } catch (error) { return failure(c, error); }
});
workspace.put('/theme-preference', async c => {
  try {
    const parsed = themePreferenceInput.safeParse(await readMutationJson(c));
    if (!parsed.success) return c.json({ error: 'Invalid theme preference' }, 400);
    const gate = await admission(c, 'workspace.theme.write'); const denied = admissionFailure(c, gate); if (denied) return denied;
    const repository = (c.get('tenantDeps') as TenantRequestDeps).repositories.operatorWorkspace;
    const credential = themeCredential(c);
    const result = await repository.saveThemePreference(parsed.data, credential, admittedCommit(gate));
    if (!result) {
      // Enabled admission already placed current session/MFA/policy in the
      // mutation batch; a null row can therefore only be an exact CAS loss.
      if (gate.status === 'disabled' && !await repository.getThemePreference(credential)) throw new OperatorWorkspaceError(403, 'Operator session changed');
      throw new OperatorWorkspaceError(409, 'Theme preference changed before it could be saved');
    }
    return c.json(result);
  } catch (error) { return failure(c, error); }
});
workspace.get('/presentation-preference', async c => {
  try {
    const gate = await admission(c, 'workspace.presentation.read'); const denied = admissionFailure(c, gate); if (denied) return denied;
    const result = await (c.get('tenantDeps') as TenantRequestDeps).repositories.operatorWorkspace.getPresentationPreference(themeCredential(c), admittedCommit(gate));
    if (!result) throw new OperatorWorkspaceError(403, 'Operator session changed');
    return c.json(result);
  } catch (error) { return failure(c, error); }
});
workspace.put('/presentation-preference', async c => {
  try {
    const parsed = presentationPreferenceInput.safeParse(await readMutationJson(c));
    if (!parsed.success) return c.json({ error: 'Invalid workspace preferences' }, 400);
    const gate = await admission(c, 'workspace.presentation.write'); const denied = admissionFailure(c, gate); if (denied) return denied;
    const repository = (c.get('tenantDeps') as TenantRequestDeps).repositories.operatorWorkspace;
    const result = await repository.savePresentationPreference({ version: parsed.data.version, revision: parsed.data.expectedRevision,
      density: parsed.data.density, fontScale: parsed.data.fontScale, focusMode: parsed.data.focusMode, motion: parsed.data.motion }, themeCredential(c), admittedCommit(gate));
    if (!result) throw new OperatorWorkspaceError(409, 'Workspace preferences changed before they could be saved');
    return c.json(result);
  } catch (error) { return failure(c, error); }
});
workspace.get('/drafts', async c => {
  const after = z.string().max(128).safeParse(c.req.query('after') ?? '');
  const limit = z.coerce.number().int().min(1).max(50).safeParse(c.req.query('limit') ?? '50');
  if (!after.success || !limit.success) return c.json({ error: 'Invalid draft page' }, 400);
  try { const gate = await admission(c, 'workspace.drafts.list'); const denied = admissionFailure(c, gate); if (denied) return denied; return c.json(await service(c, admittedCommit(gate)).listDrafts(after.data, limit.data)); } catch (error) { return failure(c, error); }
});
workspace.get('/drafts/:ticketId', async c => {
  const parsed = ticketId.safeParse(c.req.param('ticketId'));
  if (!parsed.success) return c.json({ error: 'Invalid ticket ID' }, 400);
  try { const gate = await admission(c, 'workspace.draft.read', parsed.data); const denied = admissionFailure(c, gate); if (denied) return denied; const draft = await service(c, admittedCommit(gate)).getDraft(parsed.data); return draft ? c.json(draft) : c.body(null, 204); } catch (error) { return failure(c, error); }
});
workspace.put('/drafts/:ticketId', async c => {
  try {
    const id = ticketId.safeParse(c.req.param('ticketId')); const parsed = draftInput.safeParse(await readMutationJson(c));
    if (!id.success || !parsed.success) return c.json({ error: 'Invalid draft' }, 400);
    const gate = await admission(c, 'workspace.draft.write', id.data); const denied = admissionFailure(c, gate); if (denied) return denied;
    return c.json(await service(c, admittedCommit(gate)).saveDraft({ ...parsed.data, ticketId: id.data }));
  } catch (error) { return failure(c, error); }
});
workspace.post('/drafts/:ticketId/rebase', async c => {
  try {
    const id = ticketId.safeParse(c.req.param('ticketId')); const parsed = draftRebaseInput.safeParse(await readMutationJson(c));
    if (!id.success || !parsed.success) return c.json({ error: 'Invalid draft rebase' }, 400);
    const gate = await admission(c, 'workspace.draft.rebase', id.data); const denied = admissionFailure(c, gate); if (denied) return denied;
    return c.json(await service(c, admittedCommit(gate)).rebaseDraft({ ...parsed.data, ticketId: id.data }));
  } catch (error) { return failure(c, error); }
});
workspace.delete('/drafts/:ticketId', async c => {
  const id = ticketId.safeParse(c.req.param('ticketId'));
  const parsedRevision = revision.safeParse(Number(c.req.query('revision')));
  const parsedGeneration = generation.safeParse(c.req.query('generation'));
  if (!id.success || !parsedRevision.success || parsedRevision.data === 0 || !parsedGeneration.success) return c.json({ error: 'Invalid draft version' }, 400);
  try { const gate = await admission(c, 'workspace.draft.delete', id.data); const denied = admissionFailure(c, gate); if (denied) return denied; await service(c, admittedCommit(gate)).deleteDraftIfVersion(id.data, parsedGeneration.data, parsedRevision.data); return c.body(null, 204); } catch (error) { return failure(c, error); }
});

export default workspace;
