import type { TenantAttachmentStorage } from '../../storage/adapters';
import type { InboundClaim, InboundEmailReceiptRepository } from '../../repositories/inbound-email-receipt.repository';
import type { VerifiedMutationAttachment } from '../../types/ticket-mutation-replay';

export type InboundAttachmentContent=Readonly<{filename:string;contentType:string;content:Uint8Array}>;

/** Already-admitted bounded content only. Persist a complete manifest before any
 * R2 write; never delete or refund on an ambiguous provider/acknowledgement error.
 * The composition records the attempt as uncertain and settles its allocation. */
export async function writeInboundAttachments(input:{storage:TenantAttachmentStorage;receipts:InboundEmailReceiptRepository;
  claim:InboundClaim;attachments:readonly InboundAttachmentContent[]}):Promise<(VerifiedMutationAttachment&{id:string})[]> {
  if(input.attachments.length>10)throw new Error('Too many inbound attachments');
  let total=0;
  const snapshot=[];
  for(const item of input.attachments){
    if(!(item.content instanceof Uint8Array)||item.content.byteLength<1||(total+=item.content.byteLength)>2_097_152
      ||!item.filename||new TextEncoder().encode(item.filename).byteLength>255||/[\u0000-\u001f\u007f]/.test(item.filename)
      ||!item.contentType||item.contentType.length>255||/[^\u0020-\u007e]/.test(item.contentType))throw new Error('Invalid inbound attachment');
    snapshot.push({filename:item.filename,contentType:item.contentType,content:item.content.slice()});
  }
  // Snapshot every byte and metadata field before the first asynchronous boundary.
  const prepared=[];
  for(const item of snapshot){
    const contentHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',item.content)),byte=>byte.toString(16).padStart(2,'0')).join('');
    prepared.push({...item,contentHash});
  }
  const manifest=await input.receipts.planArtifacts(input.claim,prepared.map(item=>({contentHash:item.contentHash,byteSize:item.content.byteLength})));
  const completed=[];
  for(const artifact of manifest){
    const item=prepared[artifact.ordinal];
    await input.receipts.beforeArtifactWrite(input.claim,artifact);
    const result=await input.storage.putAttachment(artifact.objectId,item.content,{httpMetadata:{contentType:item.contentType}});
    if(!result.res||result.key!==artifact.objectId)throw new Error('Inbound attachment outcome is uncertain');
    await input.receipts.confirmArtifact(input.claim,artifact);
    completed.push({id:crypto.randomUUID(),storageKey:artifact.objectId,filename:item.filename,size:artifact.byteSize,contentType:item.contentType});
  }
  return completed;
}
