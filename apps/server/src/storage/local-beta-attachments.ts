import { TenantAttachmentStorage } from './adapters';
import type { LocalBetaAdmissionRepository } from '../repositories/local-beta-admission.repository';
import type { VerifiedTenantScope } from '../types/tenant';

/** The pre-R2 attempt charge is durable; failed or uncertain puts are never refunded. */
export class LocalBetaAttachmentStorage extends TenantAttachmentStorage {
  constructor(scope: VerifiedTenantScope, bucket: ConstructorParameters<typeof TenantAttachmentStorage>[1], private admission: LocalBetaAdmissionRepository) { super(scope,bucket); }
  override async putAttachment(objectId: string, value: unknown, options?: unknown) {
    await this.admission.chargeUploadAttempt();
    // Never delete on an ambiguous put failure: an object may already be accepted.
    // Disposable fixture teardown removes run-owned orphan state.
    return super.putAttachment(objectId,value,options);
  }
}
