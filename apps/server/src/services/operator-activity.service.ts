import type { TenantRequestDeps } from '../middleware/tenant.middleware';
import type { ActivityPresentationCredential, OperatorActivityPage, TrustedActivityAppend } from '../types/operator-activity';

/** Composition boundary for #70/#130: no route, preference, or delivery guarantee is implied. */
export class OperatorActivityService {
  constructor(private readonly deps: TenantRequestDeps) {}

  appendTrusted(input: TrustedActivityAppend) {
    return this.deps.operatorActivity.appendTrusted(input);
  }

  /** Use only from the owning canonical D1 batch; caller must examine its own batch outcome. */
  prepareTrustedAppend(input: TrustedActivityAppend) {
    return this.deps.operatorActivity.prepareTrustedAppend(input);
  }

  list(input: Readonly<{ cursor?: string | null; limit: number }>, credential: ActivityPresentationCredential): Promise<OperatorActivityPage | null> {
    return this.deps.operatorActivity.listForRecipient(input, credential);
  }

  unreadCount(credential: ActivityPresentationCredential) {
    return this.deps.operatorActivity.unreadCount(credential);
  }

  markRead(id: string, expectedRevision: number, credential: ActivityPresentationCredential) {
    return this.deps.operatorActivity.markRead(id, expectedRevision, credential);
  }

  dismiss(id: string, expectedRevision: number, credential: ActivityPresentationCredential) {
    return this.deps.operatorActivity.dismiss(id, expectedRevision, credential);
  }
}
