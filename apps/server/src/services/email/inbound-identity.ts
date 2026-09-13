import type { VerifiedTenantScope } from '../../types/tenant';
import { MAX_INBOUND_RAW_BYTES } from './inbound-raw';

export type InboundEnvelope = Readonly<{ from: string; to: string; subject: string; messageId: string; rawSize: number }>;
export type InboundIdentity = InboundEnvelope & Readonly<{ sourceHash: string; envelopeHash: string }>;
const encoder = new TextEncoder();
async function digest(parts: readonly unknown[]): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(JSON.stringify(parts)))),
    byte=>byte.toString(16).padStart(2,'0')).join('');
}

/** This is an idempotency source, never sender authentication. Trusted gateway
 * verification and tenant-recipient resolution must precede this helper. Missing
 * stable IDs are rejected rather than replaced with a random replayable identity.
 * The admitted reader subsequently binds actual raw bytes to the receipt. */
export async function inboundIdentity(scope: VerifiedTenantScope, input: InboundEnvelope): Promise<InboundIdentity> {
  if (!scope.roles.includes('system') || scope.actorId !== 'inbound-email') throw new Error('Invalid inbound scope');
  if (!Number.isSafeInteger(input.rawSize) || input.rawSize < 1 || input.rawSize > MAX_INBOUND_RAW_BYTES) throw new Error('Invalid inbound size');
  const address=(value:string):string=>{
    if (typeof value !== 'string' || value.length > 320) throw new Error('Invalid inbound address');
    const normalized=value.trim().toLowerCase();
    if (!/^[^\s@<>\u0000-\u001f\u007f]+@[^\s@<>\u0000-\u001f\u007f]+$/.test(normalized)) throw new Error('Invalid inbound address');
    return normalized;
  };
  const from=address(input.from),to=address(input.to);
  // Conservative supported header contract; retain ID case and exclude folding,
  // lists and control characters. This deliberately is not a complete RFC parser.
  if (typeof input.messageId !== 'string' || input.messageId.length > 256
    || !/^<[^\s<>@\u0000-\u001f\u007f-\uffff]+@[^\s<>@\u0000-\u001f\u007f-\uffff]+>$/.test(input.messageId)) throw new Error('Missing or unsupported inbound message identity');
  if (typeof input.subject !== 'string' || input.subject.length > 2048
    || encoder.encode(input.subject).byteLength > 2048 || /[\r\n\u0000]/.test(input.subject)) throw new Error('Invalid inbound subject');
  const sourceHash=await digest(['inbound-source-v1',scope.tenantId,from,to,input.messageId]);
  const envelopeHash=await digest(['inbound-envelope-v1',sourceHash,input.subject,input.rawSize]);
  return {from,to,subject:input.subject,messageId:input.messageId,rawSize:input.rawSize,sourceHash,envelopeHash};
}
