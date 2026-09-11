import { Env } from '../bindings';
import { D1Database } from '@cloudflare/workers-types';
import { observeD1 } from '../repositories/observed-d1';
import type { ResourceOperationEmitter } from '../observability/resource-operation';

export interface UserAuthResolution {
  tenantId: string;
  userId: string;
  role: string;
  passwordHash: string | null;
  email?: string;
  fullName?: string;
  mfaEnabled: boolean;
  sessionVersion: number;
}

export class UserAuthResolver {
  static fromEnvironment(env: Env, emit?: ResourceOperationEmitter): UserAuthResolver {
    return new UserAuthResolver(observeD1(env.DB, emit));
  }

  constructor(private db: D1Database) {}

  async resolveCredentialsByEmail(email: string): Promise<UserAuthResolution | null> {
    if (!email || typeof email !== "string") return null;
    const canonicalEmail = email.toLowerCase().trim();
    if (!canonicalEmail) return null;

    const user = await this.db
      .prepare("SELECT tenant_id, id, role, password_hash, session_version, mfa_enabled FROM users WHERE lower(trim(email)) = ?")
      .bind(canonicalEmail)
      .first<{
        tenant_id: string;
        id: string;
        role: string;
        password_hash: string | null;
        mfa_enabled: number | boolean;
        session_version: number;
      }>();

    if (!user) return null;

    return {
      tenantId: user.tenant_id,
      userId: user.id,
      role: user.role,
      passwordHash: user.password_hash,
      mfaEnabled: !!user.mfa_enabled,
      sessionVersion: user.session_version ?? 0,
    };
  }

  async resolveUserById(tenantId: string, userId: string): Promise<UserAuthResolution | null> {
    if (!tenantId || !userId) return null;

    const user = await this.db
      .prepare("SELECT tenant_id, id, role, password_hash, session_version, mfa_enabled, email, full_name FROM users WHERE tenant_id = ? AND id = ?")
      .bind(tenantId, userId)
      .first<{
        tenant_id: string;
        id: string;
        email: string;
        full_name: string;
        role: string;
        password_hash: string | null;
        mfa_enabled: number | boolean;
        session_version: number;
      }>();

    if (!user) return null;

    return {
      tenantId: user.tenant_id,
      userId: user.id,
      email: user.email,
      fullName: user.full_name,
      role: user.role,
      passwordHash: user.password_hash,
      mfaEnabled: !!user.mfa_enabled,
      sessionVersion: user.session_version ?? 0,
    };
  }
}
