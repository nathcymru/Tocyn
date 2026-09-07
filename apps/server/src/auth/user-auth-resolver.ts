import { D1Database } from '@cloudflare/workers-types';

export interface UserAuthResolution {
  tenantId: string;
  userId: string;
  role: string;
  passwordHash: string | null;
  mfaEnabled: boolean;
}

export class UserAuthResolver {
  constructor(private db: D1Database) {}

  async resolveCredentialsByEmail(email: string): Promise<UserAuthResolution | null> {
    if (!email || typeof email !== "string") return null;
    const canonicalEmail = email.toLowerCase().trim();
    if (!canonicalEmail) return null;

    const user = await this.db
      .prepare("SELECT tenant_id, id, role, password_hash, mfa_enabled FROM users WHERE lower(trim(email)) = ?")
      .bind(canonicalEmail)
      .first<{
        tenant_id: string;
        id: string;
        role: string;
        password_hash: string | null;
        mfa_enabled: number | boolean;
      }>();

    if (!user) return null;

    return {
      tenantId: user.tenant_id,
      userId: user.id,
      role: user.role,
      passwordHash: user.password_hash,
      mfaEnabled: !!user.mfa_enabled,
    };
  }
}
