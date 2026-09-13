import { RESOURCE_DIMENSIONS, type ResourceAmounts } from '@luminatick/shared';
import type { BudgetCommitAuthority } from './isolate-admission.service';
import { isolateWarmReservedEnvelope } from './isolate-grant-holder';
import { estimateDiagnosticEnvelope } from '../observability/resource-envelope';

export type SnoozeStepInput = Readonly<{ expectedGeneration: number; stepId: string; dueThrough: string; activeSnoozeSnapshot: number }>;
export function validateSnoozeStepInput(value: unknown): SnoozeStepInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(key => !['expectedGeneration','stepId','dueThrough','activeSnoozeSnapshot'].includes(key))
    || !Number.isSafeInteger(v.expectedGeneration) || (v.expectedGeneration as number) < 0
    || (v.expectedGeneration as number) >= Number.MAX_SAFE_INTEGER
    || !Number.isSafeInteger(v.activeSnoozeSnapshot) || (v.activeSnoozeSnapshot as number) < 0
    || typeof v.stepId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v.stepId)
    || typeof v.dueThrough !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v.dueThrough)
    || !Number.isFinite(Date.parse(v.dueThrough)) || new Date(v.dueThrough).toISOString() !== v.dueThrough) return null;
  return Object.freeze({ expectedGeneration: v.expectedGeneration as number, stepId: v.stepId,
    dueThrough: v.dueThrough, activeSnoozeSnapshot: v.activeSnoozeSnapshot as number });
}


export type SnoozeReadInput = Readonly<{ readId: string; purpose: 'new-work' | 'recovery' }>;
export type SnoozeDueIntent = Readonly<{ family: 'read'; input: SnoozeReadInput }>
  | Readonly<{ family: 'advance'; input: SnoozeStepInput }>;
const uuid = (value: unknown): value is string => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const identity = (value: string): boolean => value.length > 0 && new TextEncoder().encode(value).byteLength <= 160 && !/[\u0000-\u001f\u007f]/.test(value);

/** Candidate inventory, awaiting native read/write/byte clearance. Not activated. */
export function snoozeDueEnvelope(intent: SnoozeDueIntent): Readonly<ResourceAmounts> | null {
  let reads = 4096;
  if (intent.family === 'advance') {
    const input = validateSnoozeStepInput(intent.input);
    if (!input || input.activeSnoozeSnapshot === Number.MAX_SAFE_INTEGER) return null;
    const calculated = 5380n + 8n * BigInt(input.activeSnoozeSnapshot);
    if (calculated > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    reads = Number(calculated);
  } else if (intent.family !== 'read' || !uuid(intent.input.readId)
    || !['new-work','recovery'].includes(intent.input.purpose)) return null;
  // Deliberate due-only overreservation: at most four cold RPCs against the
  // bounded aggregate. These remain catalogue row dimensions, not new byte units.
  const result = { workerRequests: 2, d1RowsRead: reads, doRowsRead: 512, doRowsWritten: 512,
    d1RowsWritten: intent.family === 'advance' ? 128 : 16, d1StorageBytes: 8192,
    ...estimateDiagnosticEnvelope({ httpRequests: 0, detachedResourceCompositions: 2,
      credentialAuthRequests: 0, canonicalMutationRequests: 0 }) };
  // The complete admitted operation also contains existing two-attempt controls.
  if (!isolateWarmReservedEnvelope(result)) return null;
  return Object.freeze(result);
}

export function snapshotSnoozeDueIntent(value: SnoozeDueIntent): SnoozeDueIntent | null {
  if (!value || typeof value !== 'object') return null;
  if (value.family === 'advance') {
    const input = validateSnoozeStepInput(value.input);
    return input && snoozeDueEnvelope({ family: 'advance', input }) ? Object.freeze({ family: 'advance', input }) : null;
  }
  if (value.family !== 'read' || !value.input || !uuid(value.input.readId)
    || !['new-work','recovery'].includes(value.input.purpose)
    || Object.keys(value.input).some(key => !['readId','purpose'].includes(key))) return null;
  return Object.freeze({ family: 'read', input: Object.freeze({ readId: value.input.readId, purpose: value.input.purpose }) });
}

export async function snoozeDueFingerprint(tenantId: string, value: SnoozeDueIntent): Promise<string> {
  const intent = snapshotSnoozeDueIntent(value);
  if (!identity(tenantId) || !intent) throw new Error('Invalid snooze intent');
  const fields = intent.family === 'advance'
    ? ['snooze-due-advance-v1', tenantId, intent.input.expectedGeneration, intent.input.stepId,
      intent.input.dueThrough, intent.input.activeSnoozeSnapshot]
    : ['snooze-due-read-v1', tenantId, intent.input.readId, intent.input.purpose];
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(fields)));
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2,'0')).join('');
}

/** Check independently before repository SQL. A read grant cannot fund advance. */
export async function assertSnoozeDueAuthority(tenantId: string, value: SnoozeDueIntent,
  authority: BudgetCommitAuthority): Promise<void> {
  const intent = snapshotSnoozeDueIntent(value), grant = authority.grant;
  if (!intent || !grant) throw new Error('Invalid snooze authority');
  const business = snoozeDueEnvelope(intent), required = business && isolateWarmReservedEnvelope(business);
  const operationId = intent.family === 'advance' ? intent.input.stepId : intent.input.readId;
  const purpose = intent.family === 'advance' ? 'new-work' : intent.input.purpose;
  if (![tenantId,grant.tenantId,grant.aggregateId,grant.reservationId,grant.holderId,grant.operationId,grant.operationFingerprint]
      .every(value => typeof value === 'string' && identity(value))
    || !required || authority.purpose !== purpose || authority.snapshot.tenant_id !== tenantId
    || grant.tenantId !== tenantId || grant.operationId !== operationId || authority.operationId !== operationId
    || grant.operationFingerprint !== authority.operationFingerprint
    || Object.keys(grant.operationEnvelope).some(key => !RESOURCE_DIMENSIONS.includes(key as typeof RESOURCE_DIMENSIONS[number]))
    || Object.values(grant.operationEnvelope).some(n => !Number.isSafeInteger(n) || n < 0)
    || RESOURCE_DIMENSIONS.some(d => (grant.operationEnvelope[d] ?? 0) < (required[d] ?? 0))) throw new Error('Insufficient snooze authority');
  if (await snoozeDueFingerprint(tenantId,intent) !== authority.operationFingerprint) throw new Error('Snooze intent changed');
}
