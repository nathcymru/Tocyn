import type { Context } from 'hono';
import type { Env } from '../bindings';
import type { TenantRequestDeps } from '../middleware/tenant.middleware';
import type { AppVariables, JWTPayload } from '../types';
import { ConversationAuditService, ConversationHistoryError, type ConversationHistoryPage } from '../services/conversation-audit.service';
import { admitHttpTicketRead } from '../budgets/http-ticket-read-admission.service';
export type { ConversationHistoryPage } from '../services/conversation-audit.service';

/** Validate before a metered API read can reserve capacity. */
export function conversationHistoryPage(input: ConversationHistoryPage): ConversationHistoryPage {
  const limit = input.limit === undefined ? 50 : Number(input.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 ||
    (input.cursor !== undefined && !/^[a-f0-9-]{36}$/i.test(input.cursor))) throw new ConversationHistoryError(400,'Invalid history page');
  return input;
}

export async function conversationHistory(c: Context<{ Bindings: Env; Variables: AppVariables }>, audience: 'api' | 'staff' | 'customer', page?: ConversationHistoryPage) {
  if (audience === 'api' && !c.get('apiKeyResolution')?.permissions.includes('tickets:read')) return c.json({error:'Forbidden'},403);
  try {
    const options = conversationHistoryPage(page ?? {
      limit:c.req.query('limit'),cursor:c.req.query('cursor'),
    });
    const deps = c.get('tenantDeps') as TenantRequestDeps;
    const ticketId = c.req.param('id')!;
    if (audience === 'staff' || audience === 'customer') {
      const admission = await admitHttpTicketRead({ env: c.env, deps, payload: c.get('jwtPayload') as JWTPayload,
        operation: audience === 'staff' ? 'dashboard.ticket.history' : 'portal.ticket.history', ticketId, page: options,
        now: () => c.env.localNow?.() ?? Date.now() });
      if (admission.status === 'rejected') return c.json(admission.reason === 'exhausted'
        ? { code: 'budget_exhausted', error: 'Configured budget capacity is exhausted' }
        : { code: 'budget_admission_unavailable', error: 'Budget admission authority is unavailable' }, admission.reason === 'exhausted' ? 429 : 503);
    }
    return c.json(await new ConversationAuditService(deps).history(ticketId,audience,options));
  } catch (error) {
    if (error instanceof ConversationHistoryError) return c.json({error:error.message},error.status);
    return c.json({error:'Conversation history unavailable'},503);
  }
}
