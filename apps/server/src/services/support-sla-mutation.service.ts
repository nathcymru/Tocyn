import type { D1Database, DurableObjectNamespace } from '@cloudflare/workers-types';
import type { ResourceAmounts } from '@luminatick/shared';
import type { VerifiedTenantScope } from '../types/tenant';
import type { BudgetAuthorityRepository } from '../repositories/budget-authority.repository';
import { SessionBudgetAuthorityRepository, type SessionBudgetCredential } from '../repositories/session-budget-authority.repository';
import { SessionBudgetAdmissionService } from '../budgets/session-admission.service';
import type { BudgetCommitAuthority } from '../budgets/isolate-admission.service';
import { SupportSlaMutationRepository, supportSlaFenceStatements, supportSlaReceiptStatement } from '../repositories/support-sla-mutation.repository';
import type { PreparedSupportSlaMutation, SupportSlaMutationAttempt, SupportSlaMutationInput, SupportSlaMutationNamespace, SupportSlaMutationOutcome } from '../types/support-sla-mutation';
import { TicketMutationError, canonicalMutationJson } from './ticket-mutation-replay.service';

const unavailable = () => new TicketMutationError(503,'support_sla_mutation_unavailable','Support-state or SLA mutation unavailable; retry with the same key');
const denied = () => new TicketMutationError(403,'support_sla_mutation_denied','Support-state or SLA mutation is not authorized');
const conflict = () => new TicketMutationError(409,'idempotency_conflict','Idempotency key was already used with a different payload');
const invalid = () => new TicketMutationError(400,'invalid_mutation','Invalid support-state or SLA mutation');
async function digest(value: string) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))), byte=>byte.toString(16).padStart(2,'0')).join(''); }
function frozen<T>(value: T): T { return Object.freeze(structuredClone(value)); }

type Attempt = SupportSlaMutationAttempt & { authority?: BudgetCommitAuthority; started: boolean; keyed: boolean };

/** Adds the admission and immutable-receipt boundary around one existing D1 batch. */
export class SupportSlaMutationService {
  private readonly receipts: SupportSlaMutationRepository;
  private readonly sessions: SessionBudgetAuthorityRepository;
  private readonly attempts = new WeakMap<PreparedSupportSlaMutation, Attempt>();
  constructor(private readonly db: D1Database, private readonly scope: VerifiedTenantScope, private readonly credential: SessionBudgetCredential,
    private readonly budget: { service: SessionBudgetAdmissionService; repository: BudgetAuthorityRepository; namespace: DurableObjectNamespace; business: ResourceAmounts; now?: () => number }) {
    this.receipts = new SupportSlaMutationRepository(db,scope); this.sessions = new SessionBudgetAuthorityRepository(db,scope);
  }
  private now() { return this.budget.now?.() ?? Date.now(); }
  private async authorize(requirements: Attempt['requirements']) { if (!await this.sessions.authorize(this.credential,requirements,this.now())) throw denied(); }
  async prepare(input: SupportSlaMutationInput, key?: string): Promise<PreparedSupportSlaMutation> {
    if (key !== undefined && !/^[A-Za-z0-9._~-]{1,128}$/.test(key)) throw invalid();
    const serialized = canonicalMutationJson({ operation: input.operation, ticketId: input.ticketId, payload: input.payload });
    if (new TextEncoder().encode(serialized).byteLength > 128 * 1024) throw new TicketMutationError(413,'payload_too_large','Payload too large');
    const requirements: { capability?: SupportSlaMutationInput['capability']; ticket?: { id: string; groupId: string | null } } = {
      ...(input.capability ? { capability: input.capability } : {}),
    };
    // Verify the current session and requested general capability before even
    // reading a ticket to construct the group-qualified fence.
    await this.authorize(requirements);
    if (input.ticketId) {
      const ticket = await this.db.prepare('SELECT group_id FROM tickets WHERE tenant_id=? AND id=? LIMIT 1').bind(this.scope.tenantId,input.ticketId).first<{group_id:string|null}>();
      if (!ticket) throw denied(); requirements.ticket = { id:input.ticketId,groupId:ticket.group_id };
    }
    await this.authorize(requirements);
    const payloadHash = await digest(`support-sla-mutation-v1\n${serialized}`);
    const namespace: SupportSlaMutationNamespace = { principalId:this.credential.actorId, operation:input.operation,
      keyHash:await digest(key ?? `server:${crypto.randomUUID()}`), payloadHash, ...(input.ticketId ? { ticketId: input.ticketId } : {}) };
    const receipt = await this.receipts.findActive(namespace);
    if (receipt && receipt.payload_hash !== payloadHash) throw conflict();
    if (receipt?.lifecycle === 'gone' || (receipt && !receipt.response_snapshot)) throw unavailable();
    const prepared = Object.freeze({ replay: receipt?.response_snapshot ? { status: receipt.response_status, body: JSON.parse(receipt.response_snapshot) } as SupportSlaMutationOutcome : null });
    this.attempts.set(prepared,{input:frozen(input),namespace:frozen(namespace),requirements:frozen(requirements),
      intent:frozen({operationId:namespace.keyHash,operationFingerprint:payloadHash,workScopeKey:`${input.operation}:${await digest(input.ticketId ?? 'tenant')}`}),started:false,keyed:key!==undefined});
    return prepared;
  }
  admissionIntent(prepared: PreparedSupportSlaMutation) { const attempt=this.attempts.get(prepared); if (!attempt || prepared.replay) throw unavailable(); return attempt.intent; }
  async admit(prepared: PreparedSupportSlaMutation) {
    const attempt=this.attempts.get(prepared); if(!attempt) throw unavailable();
    const receipt=await this.receipts.findActive(attempt.namespace);
    if (receipt) { if(receipt.payload_hash!==attempt.namespace.payloadHash) throw conflict(); if(!receipt.response_snapshot) throw unavailable(); return {status:'replayed' as const,outcome:{ status: receipt.response_status, body: JSON.parse(receipt.response_snapshot) } as SupportSlaMutationOutcome}; }
    const result=await this.budget.service.admit({repository:this.budget.repository,sessions:this.sessions,namespace:this.budget.namespace,scope:this.scope,credential:this.credential,requirements:attempt.requirements,intent:attempt.intent,business:this.budget.business,now:()=>this.now()});
    attempt.authority=result.status==='rejected'?undefined:result.commitAuthority;
    return result;
  }
  async commit<T>(prepared: PreparedSupportSlaMutation, responseStatus: 200 | 201, snapshot: string, snapshotValues: unknown[],
    execute: (database: D1Database)=>Promise<T>, requirePreviousChange = false, receiptAfterBusinessIndex?: number,
    decodeWinner: (body: unknown) => T = body => body as T): Promise<T> {
    const attempt=this.attempts.get(prepared); if(!attempt || prepared.replay || attempt.started || !attempt.authority || this.now()>=attempt.authority.expiresAt) throw unavailable();
    await this.authorize(attempt.requirements); attempt.started=true;
    const original=this.db, prefix=supportSlaFenceStatements(original,this.scope,{credential:this.credential,requirements:attempt.requirements,authority:attempt.authority,namespace:attempt.namespace});
    const proxy=new Proxy(original,{get:(target,property)=> property==='batch' ? async (business: any[]) => {
      const at=receiptAfterBusinessIndex ?? business.length;
      if (!Number.isSafeInteger(at) || at<0 || at>business.length) throw unavailable();
      const receipt=supportSlaReceiptStatement(target,this.scope,attempt.namespace,responseStatus,snapshot,snapshotValues,requirePreviousChange);
      const results=await target.batch([...prefix,...business.slice(0,at),receipt,...business.slice(at)]);
      const start=prefix.length;
      return [...results.slice(start,start+at),...results.slice(start+at+1,start+business.length+1)];
    } : typeof Reflect.get(target,property)==='function' ? Reflect.get(target,property).bind(target) : Reflect.get(target,property)}) as D1Database;
    try { return await execute(proxy); }
    catch (error) {
      await this.authorize(attempt.requirements); const winner=await this.receipts.findActive(attempt.namespace);
      if (winner?.response_snapshot) return decodeWinner(JSON.parse(winner.response_snapshot));
      throw error;
    }
  }
  keyed(prepared: PreparedSupportSlaMutation) { return this.attempts.get(prepared)?.keyed === true; }
}
