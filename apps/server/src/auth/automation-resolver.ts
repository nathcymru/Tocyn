import { D1Database } from '@cloudflare/workers-types';
import { RETENTION_TENANT_BATCH } from '../repositories/retention-admission.repository';

/**
 * Narrow pre-scope D1 boundary for CRON automation.
 * Only enumerates a maintained, one-row-per-tenant active-retention projection.
 * Does NOT construct scopes, list rules, or expose generic D1 access.
 */
export class AutomationTenantResolver {
  constructor(private db: D1Database) {}

  async getActiveTenantIds(after: string | null = null): Promise<string[]> {
    const { results } = await this.db.prepare(
      "SELECT tenant_id FROM retention_scheduler_tenants WHERE active_retention_rules>0 AND (? IS NULL OR tenant_id > ?) ORDER BY tenant_id LIMIT ?"
    ).bind(after, after, RETENTION_TENANT_BATCH).all<{ tenant_id: string }>();

    return results.map(r => r.tenant_id);
  }

  async cursor(): Promise<string | null> {
    const row = await this.db.prepare(`SELECT tenant_id FROM retention_scheduler_cursors WHERE cursor_name='tenant' LIMIT 1`).first<{tenant_id:string|null}>();
    return row?.tenant_id ?? null;
  }
  async setCursor(tenantId: string | null): Promise<void> {
    await this.db.prepare(`INSERT INTO retention_scheduler_cursors (cursor_name,tenant_id,updated_at) VALUES ('tenant',?,CURRENT_TIMESTAMP)
      ON CONFLICT(cursor_name) DO UPDATE SET tenant_id=excluded.tenant_id,updated_at=CURRENT_TIMESTAMP`).bind(tenantId).run();
  }
}
