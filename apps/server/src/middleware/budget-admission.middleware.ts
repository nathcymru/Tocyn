import type { Context } from 'hono';
import type { D1Database } from '@cloudflare/workers-types';
import type { ResourceAmounts } from '@luminatick/shared';
import type { Env } from '../bindings';
import type { AppVariables } from '../types';
import type { VerifiedTenantScope } from '../types/tenant';
import { BUDGET_AUTHORITY_SNAPSHOT_D1_READ_BOUND, BudgetAuthorityRepository, type BudgetAuthorityPrincipal } from '../budgets/authority-repository';
import { BudgetCoordinatorService, type CurrentBudgetAuthorityGate } from '../budgets/budget-coordinator.service';
import type { ApiKeyResolution } from '../auth/api-key-resolver';

export const API_TICKET_BUDGET_POLICY = 'api-ticket-mutations-v1' as const;
export type ApiTicketBudgetOperation = 'api.ticket.create' | 'api.ticket.reply';

/**
 * This is the conservative, bounded envelope for the first active path.
 * It reserves the canonical mutation, audit receipt, current-credential check,
 * authority read, coordinator commit, and holder seed before acknowledgement.
 * It intentionally excludes attachments, providers, notifications, AI, PATCH,
 * and every non-API-key path until each has its own approved envelope.
 */
/**
 * Query-plan bound: two indexed, 129-row authority snapshots cover an initial
 * reserve and one idempotent retry after a lost holder-seed acknowledgement.
 * The remaining margin covers API-key/current-receipt reads and the bounded
 * canonical D1 mutation/replay path. This is a reservation envelope, not a
 * claim that provider D1 metering is identical to local SQLite diagnostics.
 */
const API_ADMISSION_D1_READ_BOUND = BUDGET_AUTHORITY_SNAPSHOT_D1_READ_BOUND * 2 + 512;
const API_IDEMPOTENT_RETRY_D1_READ_BOUND = 512;
export const API_TICKET_ENVELOPES: Readonly<Record<ApiTicketBudgetOperation, ResourceAmounts>> = Object.freeze({
  'api.ticket.create': Object.freeze({ workerRequests: 2, d1RowsRead: API_ADMISSION_D1_READ_BOUND + API_IDEMPOTENT_RETRY_D1_READ_BOUND,
    d1RowsWritten: 64, doRequests: 6, doRowsWritten: 6 }),
  'api.ticket.reply': Object.freeze({ workerRequests: 2, d1RowsRead: API_ADMISSION_D1_READ_BOUND + API_IDEMPOTENT_RETRY_D1_READ_BOUND,
    d1RowsWritten: 64, doRequests: 6, doRowsWritten: 6 }),
});

class ApiKeyTicketBudgetGate implements CurrentBudgetAuthorityGate {
  constructor(private readonly db: D1Database, private readonly resolution: ApiKeyResolution) {}

  async authorize(scope: VerifiedTenantScope): Promise<BudgetAuthorityPrincipal | null> {
    if (scope.tenantId !== this.resolution.tenantId || scope.actorId !== this.resolution.apiKeyId || !scope.roles.includes('integration')) return null;
    const row = await this.db.prepare(`SELECT permissions FROM api_keys WHERE tenant_id=? AND id=? AND is_active=1 LIMIT 1`)
      .bind(scope.tenantId, this.resolution.apiKeyId).first<{ permissions: string }>();
    if (!row || typeof row.permissions !== 'string' || !row.permissions.split(',').map(value => value.trim()).includes('tickets:write')) return null;
    return { kind: 'api-key', apiKeyId: this.resolution.apiKeyId, requiredPermission: 'tickets:write' };
  }
}

function mode(env: Env): 'disabled' | 'enabled' | 'invalid' {
  if (env.BUDGET_ADMISSION_POLICY === 'off') return 'disabled';
  return env.BUDGET_ADMISSION_POLICY === API_TICKET_BUDGET_POLICY ? 'enabled' : 'invalid';
}

function budgetKey(operation: ApiTicketBudgetOperation, raw: string | undefined): string {
  // Header validation happens in the mutation service before this boundary.
  return raw === undefined ? `${operation}:server:${crypto.randomUUID()}` : `${operation}:client:${raw}`;
}

/**
 * Server-owned active admission for two API-key mutation routes only. An
 * explicit configured policy enables it; malformed configuration or missing
 * authority/bindings is a 503 and never falls through to a mutation commit.
 */
export async function admitConfiguredApiTicketMutation(
  c: Context<{ Bindings: Env; Variables: AppVariables }>,
  operation: ApiTicketBudgetOperation,
  idempotencyKey: string | undefined,
): Promise<Response | null> {
  const configured = mode(c.env);
  if (configured === 'disabled') return null;
  if (configured === 'invalid' || !c.env.DB || !c.env.BUDGET_COORDINATOR_DO || !c.env.BUDGET_GRANT_HOLDER_DO) {
    return c.json({ code: 'budget_admission_unavailable', error: 'Budget admission authority is unavailable' }, 503);
  }
  const scope = c.get('tenantScope');
  const resolution = c.get('apiKeyResolution');
  if (!scope || !resolution) return c.json({ code: 'budget_admission_unavailable', error: 'Budget admission authority is unavailable' }, 503);
  try {
    const service = new BudgetCoordinatorService(
      new BudgetAuthorityRepository(c.env.DB), c.env.BUDGET_COORDINATOR_DO, c.env.BUDGET_GRANT_HOLDER_DO,
      new ApiKeyTicketBudgetGate(c.env.DB, resolution), () => c.env.localNow?.() ?? Date.now(),
    );
    const outcome = await service.reserveForVerifiedScope(scope, {
      holderId: `api-key:${resolution.apiKeyId}`,
      idempotencyKey: budgetKey(operation, idempotencyKey),
      purpose: 'new-work', envelope: API_TICKET_ENVELOPES[operation],
    });
    if (outcome.status === 'granted' || outcome.status === 'idempotent') return null;
    if (outcome.reason === 'exhausted' || outcome.reason === 'capacity-exhausted') {
      return c.json({ code: 'budget_exhausted', error: 'Configured budget capacity is exhausted' }, 429);
    }
    return c.json({ code: 'budget_admission_unavailable', error: 'Budget admission authority is unavailable' }, 503);
  } catch {
    return c.json({ code: 'budget_admission_unavailable', error: 'Budget admission authority is unavailable' }, 503);
  }
}
