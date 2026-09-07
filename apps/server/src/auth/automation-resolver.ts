import { D1Database } from '@cloudflare/workers-types';

/**
 * Narrow pre-scope D1 boundary for CRON automation.
 * Only enumerates tenant IDs that have active automation rules.
 * Does NOT construct scopes, list rules, or expose generic D1 access.
 */
export class AutomationTenantResolver {
  constructor(private db: D1Database) {}

  async getActiveTenantIds(): Promise<string[]> {
    const { results } = await this.db.prepare(
      "SELECT DISTINCT tenant_id FROM automation_rules WHERE is_active = 1"
    ).all<{ tenant_id: string }>();

    return results.map(r => r.tenant_id);
  }
}
