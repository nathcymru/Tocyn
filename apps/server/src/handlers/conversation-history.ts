import type { Context } from 'hono';
import type { TenantRequestDeps } from '../middleware/tenant.middleware';
import { ConversationAuditService, ConversationHistoryError, type ConversationHistoryPage } from '../services/conversation-audit.service';
export type { ConversationHistoryPage } from '../services/conversation-audit.service';

/** Validate before a metered API read can reserve capacity. */
export function conversationHistoryPage(input: ConversationHistoryPage): ConversationHistoryPage {
  const limit = input.limit === undefined ? 50 : Number(input.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 ||
    (input.cursor !== undefined && !/^[a-f0-9-]{36}$/i.test(input.cursor))) throw new ConversationHistoryError(400,'Invalid history page');
  return input;
}

export async function conversationHistory(c: Context, audience: 'api' | 'staff' | 'customer', page?: ConversationHistoryPage) {
  if (audience === 'api' && !c.get('apiKeyResolution')?.permissions.includes('tickets:read')) return c.json({error:'Forbidden'},403);
  try {
    const options = conversationHistoryPage(page ?? {
      limit:c.req.query('limit'),cursor:c.req.query('cursor'),
    });
    return c.json(await new ConversationAuditService(c.get('tenantDeps') as TenantRequestDeps).history(c.req.param('id')!,audience,options));
  } catch (error) {
    if (error instanceof ConversationHistoryError) return c.json({error:error.message},error.status);
    return c.json({error:'Conversation history unavailable'},503);
  }
}
