import { D1Database } from '@cloudflare/workers-types';

export interface ApiKeyResolution {
  tenantId: string;
  apiKeyId: string;
  name: string;
  permissions: string[];
}

/**
 * Narrow pre-scope D1 boundary for API key authentication.
 * Accepts only D1 and exposes a single lookup operation.
 * Does NOT construct VerifiedTenantScope, list keys, mutate keys,
 * or expose generic raw-D1 access.
 */
export class ApiAuthResolver {
  constructor(private db: D1Database) {}

  async resolveKey(apiKeyRaw: string): Promise<ApiKeyResolution | null> {
    const PREFIX = 'lt_';
    if (!apiKeyRaw.startsWith(PREFIX)) {
      return null;
    }

    const keyHash = await this.hashKey(apiKeyRaw);

    const result = await this.db.prepare(
      "SELECT tenant_id, id, name, permissions FROM api_keys WHERE key_hash = ? AND is_active = 1 LIMIT 1"
    ).bind(keyHash).first<{ tenant_id: string; id: string; name: string; permissions?: string }>();

    if (!result) {
      return null;
    }

    const permissions = (result.permissions ?? '')
      .split(',')
      .map(p => p.trim())
      .filter(Boolean);

    return {
      tenantId: result.tenant_id,
      apiKeyId: result.id,
      name: result.name,
      permissions,
    };
  }

  private async hashKey(apiKey: string): Promise<string> {
    const msgUint8 = new TextEncoder().encode(apiKey);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
}
