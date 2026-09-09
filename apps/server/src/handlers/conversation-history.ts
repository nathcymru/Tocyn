import type { Context } from 'hono';
import type { TenantRequestDeps } from '../middleware/tenant.middleware';
import { ConversationAuditService, ConversationHistoryError } from '../services/conversation-audit.service';

export async function conversationHistory(c: Context, audience: 'api' | 'staff' | 'customer') {
  if (audience === 'api' && !c.get('apiKeyResolution')?.permissions.includes('tickets:read')) return c.json({error:'Forbidden'},403);
  try {
    return c.json(await new ConversationAuditService(c.get('tenantDeps') as TenantRequestDeps).history(c.req.param('id')!,audience,{
      limit:c.req.query('limit'),cursor:c.req.query('cursor'),
    }));
  } catch (error) {
    if (error instanceof ConversationHistoryError) return c.json({error:error.message},error.status);
    return c.json({error:'Conversation history unavailable'},503);
  }
}
