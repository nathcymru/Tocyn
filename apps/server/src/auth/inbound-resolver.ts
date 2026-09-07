import { D1Database } from '@cloudflare/workers-types';
import { normalizeSupportEmail } from '../utils/email-normalize';

export interface InboundTenantResolution {
  tenantId: string;
}

export class InboundTenantResolver {
  constructor(private db: D1Database) {}

  async resolveRecipient(emailAddress: string): Promise<InboundTenantResolution | null> {
    const normalized = normalizeSupportEmail(emailAddress);
    const result = await this.db.prepare(
      "SELECT tenant_id FROM support_emails WHERE normalized_email = ? LIMIT 1"
    ).bind(normalized).first<{ tenant_id: string }>();

    if (!result) {
      return null;
    }

    return { tenantId: result.tenant_id };
  }
}
