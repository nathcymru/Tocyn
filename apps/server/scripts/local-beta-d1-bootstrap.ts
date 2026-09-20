/** Private, pre-serve bootstrap for a fresh run-owned local D1 database.
 * This does not create budget authority or enable any Worker binding. */
import { validateBetaInitialization, type BetaInitialization } from '../src/types/local-beta';

export async function initializeFreshLocalBetaPolicy(db: D1Database, input: BetaInitialization): Promise<void> {
  const policy = validateBetaInitialization(input);
  const { limits } = policy;
  // D1 batch is transactional. Keep the fresh-store and invitation assertions in
  // that batch so a missing/wrong-tenant principal leaves no partial policy.
  const statements = [
    db.prepare(`INSERT INTO local_beta_assertion(singleton,accepted)
      VALUES(1,CASE WHEN NOT EXISTS(SELECT 1 FROM local_beta_runs)
        AND NOT EXISTS(SELECT 1 FROM local_beta_policy) THEN 1 ELSE 0 END)
      ON CONFLICT(singleton) DO UPDATE SET accepted=excluded.accepted`),
    ...policy.invitations.map(invitation => {
      const table = invitation.kind === 'api-key' ? 'api_keys' : 'users';
      const role = invitation.kind === 'customer' ? "AND role='customer'"
        : invitation.kind === 'staff' ? "AND role IN ('admin','agent')" : 'AND is_active=1';
      return db.prepare(`INSERT INTO local_beta_assertion(singleton,accepted)
        VALUES(1,CASE WHEN EXISTS(SELECT 1 FROM ${table} WHERE tenant_id=? AND id=? ${role}) THEN 1 ELSE 0 END)
        ON CONFLICT(singleton) DO UPDATE SET accepted=excluded.accepted`)
        .bind(invitation.tenantId, invitation.id);
    }),
    db.prepare('INSERT INTO local_beta_runs(run_id,ticket_limit,mutation_limit,recovery_reserve,upload_limit) VALUES (?,?,?,?,?)')
      .bind(policy.runId, limits.ticketLimit, limits.mutationLimit, limits.recoveryReserve, limits.uploadLimit),
    ...policy.tenants.map(tenant => db.prepare('INSERT INTO local_beta_tenants(run_id,tenant_id) VALUES (?,?)').bind(policy.runId, tenant)),
    ...policy.invitations.map(invitation => db.prepare('INSERT INTO local_beta_invitations(run_id,tenant_id,principal_kind,principal_id) VALUES (?,?,?,?)')
      .bind(policy.runId, invitation.tenantId, invitation.kind, invitation.id)),
    db.prepare("INSERT INTO local_beta_policy(singleton,run_id,revision,state) VALUES(1,?,1,'running')").bind(policy.runId),
    db.prepare("INSERT INTO local_beta_operator_receipts(revision,action,run_id,prior_run_id,prior_tickets,prior_mutations,prior_upload_attempts) VALUES(1,'initialize',?,NULL,0,0,0)")
      .bind(policy.runId),
    // This row is only a batch guard. Clear it atomically so the first
    // admitted write still exercises the cold assertion INSERT path.
    db.prepare('DELETE FROM local_beta_assertion WHERE singleton=1'),
  ];
  await db.batch(statements);
}
