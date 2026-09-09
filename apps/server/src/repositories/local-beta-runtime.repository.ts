import type { D1Database } from '@cloudflare/workers-types';

/** Deployment-owned local policy reads; no request-selected run or policy authority. */
export class LocalBetaRuntimeRepository {
  constructor(private db: D1Database) {}

  async currentPolicy() {
    return this.db.prepare(`SELECT p.revision,p.state FROM local_beta_policy p
      JOIN local_beta_runs r ON r.run_id=p.run_id WHERE p.singleton=1
      AND (SELECT count(*) FROM local_beta_tenants t WHERE t.run_id=p.run_id)=2`)
      .first<{ revision: number; state: string }>();
  }

  async admitsTenant(tenantId: string): Promise<boolean> {
    const row = await this.db.prepare(`SELECT 1 FROM local_beta_tenants t
      JOIN local_beta_policy p ON p.run_id=t.run_id WHERE p.singleton=1 AND t.tenant_id=?`)
      .bind(tenantId).first();
    return !!row;
  }
}
