import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import type { BudgetCommitAuthority } from '../budgets/isolate-admission.service';
import type { VerifiedTenantScope } from '../types/tenant';
import { budgetCommitConstraint, budgetGrantOperationConstraint, budgetGrantOperationStatements } from './budget-commit-fence';

export const MAX_INBOUND_RECEIPTS_PER_TENANT = 4096;
export const MAX_INBOUND_ATTEMPTS = 3;
export type InboundReceiptState = 'processing' | 'committed' | 'rejected' | 'uncertain';
export type InboundReceipt = Readonly<{
  source_hash: string; envelope_hash: string; raw_hash: string | null; recipient: string;
  current_attempt: number; state: InboundReceiptState;
}>;
export type InboundArtifact = Readonly<{ ordinal: number; objectId: string; contentHash: string; byteSize: number }>;
export type InboundClaim = Readonly<{
  sourceHash: string; envelopeHash: string; recipient: string;
  attempt: number; token: string; authority: BudgetCommitAuthority;
}>;

/** Internal composition only. The email handler is not yet wired to this
 * primitive: raw-message admission and attachment recovery remain separate work.
 * A losing claim/finish rolls back the grant link and all supplied D1 effects. */
export class InboundEmailReceiptRepository {
  constructor(private readonly db: D1Database, private readonly scope: VerifiedTenantScope) {}

  private validate(claim: InboundClaim): void {
    const digest = /^[a-f0-9]{64}$/;
    const grant = claim.authority.grant;
    if (!this.scope.roles.includes('system') || this.scope.actorId !== 'inbound-email'
      || !digest.test(claim.sourceHash) || !digest.test(claim.envelopeHash)
      || !claim.recipient || claim.recipient.length > 320 || claim.recipient !== claim.recipient.trim().toLowerCase()
      || /[\u0000-\u0020\u007f]/.test(claim.recipient)
      || !Number.isSafeInteger(claim.attempt) || claim.attempt < 1 || claim.attempt > MAX_INBOUND_ATTEMPTS
      || !/^[a-f0-9-]{36}$/.test(claim.token)
      || claim.authority.operationId !== `inbound:${claim.sourceHash}:${claim.attempt}`
      || claim.authority.operationFingerprint !== claim.envelopeHash
      || !grant || grant.tenantId !== this.scope.tenantId
      || claim.authority.purpose !== (claim.attempt === 1 ? 'new-work' : 'recovery')) {
      throw new Error('Invalid inbound claim');
    }
  }

  async find(sourceHash: string): Promise<InboundReceipt | null> {
    if (!/^[a-f0-9]{64}$/.test(sourceHash)) throw new Error('Invalid inbound source');
    return this.db.prepare(`SELECT source_hash,envelope_hash,raw_hash,recipient,current_attempt,state
      FROM inbound_email_receipts WHERE tenant_id=? AND source_hash=?`)
      .bind(this.scope.tenantId,sourceHash).first<InboundReceipt>();
  }

  private assertion(claim: InboundClaim, predicate: string, values: unknown[]): D1PreparedStatement {
    const budget = budgetCommitConstraint(claim.authority,this.scope.tenantId,[claim.authority.purpose]);
    // Recipient routing is rechecked in the same transaction as the claim or
    // mutation: an earlier trusted resolution is not permanent mailbox authority.
    return this.db.prepare(`INSERT INTO budget_mutation_assertion(tenant_id,accepted)
      VALUES (?,CASE WHEN ${budget.sql} AND EXISTS (SELECT 1 FROM support_emails
        WHERE tenant_id=? AND normalized_email=?) AND (${predicate}) THEN 1 ELSE 0 END)
      ON CONFLICT(tenant_id) DO UPDATE SET accepted=excluded.accepted`)
      .bind(this.scope.tenantId,...budget.values,this.scope.tenantId,claim.recipient,...values);
  }

  /** Claim before parsing or storage. Recovery requires the exact previous
   * attempt to expire; it cannot replace a terminal receipt or a live worker. */
  async begin(claim: InboundClaim): Promise<void> {
    this.validate(claim);
    const tenant = this.scope.tenantId;
    const statements: D1PreparedStatement[] = [];
    if (claim.attempt === 1) {
      statements.push(this.assertion(claim,`NOT EXISTS (SELECT 1 FROM inbound_email_receipts
        WHERE tenant_id=? AND source_hash=?) AND (SELECT count(*) FROM
        (SELECT source_hash FROM inbound_email_receipts WHERE tenant_id=? LIMIT ?)) < ?`,
      [tenant,claim.sourceHash,tenant,MAX_INBOUND_RECEIPTS_PER_TENANT,MAX_INBOUND_RECEIPTS_PER_TENANT]));
      statements.push(this.db.prepare(`INSERT INTO inbound_email_receipts
        (tenant_id,source_hash,envelope_hash,recipient,current_attempt,state) VALUES (?,?,?,?,1,'processing')`)
        .bind(tenant,claim.sourceHash,claim.envelopeHash,claim.recipient));
    } else {
      statements.push(this.assertion(claim,`EXISTS (SELECT 1 FROM inbound_email_receipts r
        JOIN inbound_email_attempts a ON a.tenant_id=r.tenant_id AND a.source_hash=r.source_hash AND a.attempt=r.current_attempt
        WHERE r.tenant_id=? AND r.source_hash=? AND r.envelope_hash=? AND r.recipient=? AND r.current_attempt=?
          AND r.state IN ('processing','uncertain') AND a.state IN ('processing','uncertain')
          AND a.expires_at <= (CAST(strftime('%s','now') AS INTEGER)*1000+CAST(substr(strftime('%f','now'),4,3) AS INTEGER)))`,
      [tenant,claim.sourceHash,claim.envelopeHash,claim.recipient,claim.attempt-1]));
      statements.push(this.db.prepare(`UPDATE inbound_email_attempts SET state='uncertain',finished_at=unixepoch()
        WHERE tenant_id=? AND source_hash=? AND attempt=?`).bind(tenant,claim.sourceHash,claim.attempt-1));
      statements.push(this.db.prepare(`UPDATE inbound_email_receipts SET current_attempt=?,state='processing'
        WHERE tenant_id=? AND source_hash=?`).bind(claim.attempt,tenant,claim.sourceHash));
    }
    statements.push(...budgetGrantOperationStatements(this.db,this.scope,claim.authority));
    const grant = claim.authority.grant!;
    statements.push(this.db.prepare(`INSERT INTO inbound_email_attempts
      (tenant_id,source_hash,attempt,token,expires_at,state,reservation_id,holder_id,operation_id,operation_fingerprint)
      VALUES (?,?,?,?,?,'processing',?,?,?,?)`).bind(tenant,claim.sourceHash,claim.attempt,claim.token,
      claim.authority.expiresAt,grant.reservationId,grant.holderId,claim.authority.operationId,claim.envelopeHash));
    await this.db.batch(statements);
  }

  private continuation(claim: InboundClaim): { sql: string; values: unknown[] } {
    const tenant = this.scope.tenantId, grant = claim.authority.grant!;
    const link = budgetGrantOperationConstraint(this.scope,claim.authority);
    return { sql:`${link.sql} AND EXISTS (SELECT 1 FROM inbound_email_receipts r
      JOIN inbound_email_attempts a ON a.tenant_id=r.tenant_id AND a.source_hash=r.source_hash AND a.attempt=r.current_attempt
      WHERE r.tenant_id=? AND r.source_hash=? AND r.envelope_hash=? AND r.recipient=? AND r.current_attempt=?
        AND r.state='processing' AND a.state='processing' AND a.token=? AND a.reservation_id=? AND a.holder_id=?
        AND a.operation_id=? AND a.operation_fingerprint=? AND a.expires_at=?)`,
      values:[...link.values,tenant,claim.sourceHash,claim.envelopeHash,claim.recipient,claim.attempt,claim.token,
        grant.reservationId,grant.holderId,claim.authority.operationId,claim.envelopeHash,claim.authority.expiresAt] };
  }

  /** Bind bounded raw content before MIME/business effects. Recovery of the same
   * envelope may never replace an already-observed message with different bytes. */
  async prepare(claim: InboundClaim, rawHash: string): Promise<void> {
    this.validate(claim);
    if (!/^[a-f0-9]{64}$/.test(rawHash)) throw new Error('Invalid inbound content digest');
    const current = this.continuation(claim);
    await this.db.batch([
      this.assertion(claim,`${current.sql} AND EXISTS (SELECT 1 FROM inbound_email_receipts
        WHERE tenant_id=? AND source_hash=? AND (raw_hash IS NULL OR raw_hash=?))`,
      [...current.values,this.scope.tenantId,claim.sourceHash,rawHash]),
      this.db.prepare('UPDATE inbound_email_receipts SET raw_hash=? WHERE tenant_id=? AND source_hash=?')
        .bind(rawHash,this.scope.tenantId,claim.sourceHash),
      this.db.prepare('UPDATE inbound_email_attempts SET raw_hash=? WHERE tenant_id=? AND source_hash=? AND attempt=?')
        .bind(rawHash,this.scope.tenantId,claim.sourceHash,claim.attempt),
    ]);
  }

  /** Persist the entire bounded manifest before any external write. A planned
   * artifact means the R2 outcome may be unknown, never that no object exists. */
  async planArtifacts(claim: InboundClaim, inputs: readonly { contentHash: string; byteSize: number }[]): Promise<readonly InboundArtifact[]> {
    this.validate(claim);
    if (inputs.length > 10 || inputs.some(item => !/^[a-f0-9]{64}$/.test(item.contentHash)
      || !Number.isSafeInteger(item.byteSize) || item.byteSize < 1 || item.byteSize > 2_097_152)
      || inputs.reduce((total,item)=>total+item.byteSize,0) > 2_097_152) throw new Error('Invalid inbound attachment manifest');
    const tenant = this.scope.tenantId, current = this.continuation(claim);
    const artifacts = inputs.map((item,ordinal)=>({ ...item,ordinal,
      objectId:`inbound/${claim.sourceHash}/${claim.attempt}/${ordinal}-${item.contentHash}` }));
    await this.db.batch([
      this.assertion(claim,`${current.sql} AND EXISTS (SELECT 1 FROM inbound_email_attempts
        WHERE tenant_id=? AND source_hash=? AND attempt=? AND raw_hash IS NOT NULL AND manifest_ready=0)`,
      [...current.values,tenant,claim.sourceHash,claim.attempt]),
      ...artifacts.map(item=>this.db.prepare(`INSERT INTO inbound_email_artifacts
        (tenant_id,source_hash,attempt,ordinal,object_id,content_hash,byte_size,state) VALUES (?,?,?,?,?,?,?,'planned')`)
        .bind(tenant,claim.sourceHash,claim.attempt,item.ordinal,item.objectId,item.contentHash,item.byteSize)),
      this.db.prepare('UPDATE inbound_email_attempts SET manifest_ready=1 WHERE tenant_id=? AND source_hash=? AND attempt=?')
        .bind(tenant,claim.sourceHash,claim.attempt),
    ]);
    return artifacts;
  }

  /** Call only after a successful provider response for these exact bytes.
   * A stale acknowledgement cannot make a replacement attempt committable. */
  async confirmArtifact(claim: InboundClaim, artifact: InboundArtifact): Promise<void> {
    this.validate(claim);
    const tenant = this.scope.tenantId, current = this.continuation(claim);
    await this.db.batch([
      this.assertion(claim,`${current.sql} AND EXISTS (SELECT 1 FROM inbound_email_artifacts
        WHERE tenant_id=? AND source_hash=? AND attempt=? AND ordinal=? AND object_id=? AND content_hash=? AND byte_size=?)`,
      [...current.values,tenant,claim.sourceHash,claim.attempt,artifact.ordinal,artifact.objectId,artifact.contentHash,artifact.byteSize]),
      this.db.prepare("UPDATE inbound_email_artifacts SET state='stored' WHERE tenant_id=? AND source_hash=? AND attempt=? AND ordinal=?")
        .bind(tenant,claim.sourceHash,claim.attempt,artifact.ordinal),
    ]);
  }

  /** Effects are prepared by trusted inbound composition, never request SQL.
   * Uncertain outcomes retain their charged attempt and may only recover later.
   * This fences relational effects; it does not assert an atomic R2 transaction. */
  async finish(claim: InboundClaim, state: Exclude<InboundReceiptState,'processing'>,
    effects: readonly D1PreparedStatement[] = []): Promise<void> {
    this.validate(claim);
    if (!['committed','rejected','uncertain'].includes(state) || effects.length > 64
      || (state !== 'committed' && effects.length)) throw new Error('Invalid inbound completion');
    const tenant = this.scope.tenantId, current = this.continuation(claim);
    const assertion = this.assertion(claim,`${current.sql} AND (? <> 'committed' OR EXISTS
      (SELECT 1 FROM inbound_email_receipts r JOIN inbound_email_attempts a
        ON a.tenant_id=r.tenant_id AND a.source_hash=r.source_hash AND a.attempt=r.current_attempt
        WHERE r.tenant_id=? AND r.source_hash=? AND r.raw_hash IS NOT NULL AND a.raw_hash=r.raw_hash AND a.manifest_ready=1
        AND NOT EXISTS (SELECT 1 FROM inbound_email_artifacts f WHERE f.tenant_id=r.tenant_id
          AND f.source_hash=r.source_hash AND f.attempt=r.current_attempt AND f.state<>'stored')))`,
    [...current.values,state,tenant,claim.sourceHash]);
    await this.db.batch([assertion,...effects,
      this.db.prepare(`UPDATE inbound_email_attempts SET state=?,finished_at=unixepoch()
        WHERE tenant_id=? AND source_hash=? AND attempt=?`).bind(state,tenant,claim.sourceHash,claim.attempt),
      this.db.prepare(`UPDATE inbound_email_receipts SET state=? WHERE tenant_id=? AND source_hash=?`).bind(state,tenant,claim.sourceHash),
    ]);
  }
}
