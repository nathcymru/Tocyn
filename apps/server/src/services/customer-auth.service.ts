import { Env } from '../bindings';
import { User } from '../types';
import { EmailService } from './email/outbound.service';
import { AuthService } from './auth/auth.service';
import { EmailTransport } from './email/transport';
import { WidgetTenantResolver } from '../auth/widget-tenant-resolver';
import { UserAuthResolver } from '../auth/user-auth-resolver';
import { createSystemTenantDeps } from '../auth/scope';
import * as jose from 'jose';

export class CustomerAuthService {
  private emailService?: EmailService;
  private authService: AuthService;

  constructor(
    private env: Env,
    private tenantId?: string,
    private transport?: EmailTransport
  ) {
    this.authService = new AuthService(env);
    if (tenantId) {
      this.emailService = new EmailService(env, tenantId, transport);
    }
  }

  async resolveTenantFromWidgetKey(widgetKey: string): Promise<string | null> {
    if (!widgetKey || typeof widgetKey !== 'string' || !widgetKey.trim() || !this.env.DB) {
      return null;
    }
    const resolver = new WidgetTenantResolver(this.env.DB);
    const resolution = await resolver.resolveTenantByKey(widgetKey.trim());
    return resolution?.tenantId ?? null;
  }

  async getConfig(tenantId?: string): Promise<{ TICKET_PREFIX: string, TURNSTILE_SITE_KEY?: string }> {
    const targetTenantId = tenantId || this.tenantId;
    if (!targetTenantId) {
      return { TICKET_PREFIX: '#' };
    }
    const deps = createSystemTenantDeps(targetTenantId, 'system', this.env);

    const prefix = await deps.repositories.config.get('TICKET_PREFIX');
    const siteKey = await deps.repositories.config.get('TURNSTILE_SITE_KEY');
    return {
      TICKET_PREFIX: prefix || '#',
      TURNSTILE_SITE_KEY: siteKey || undefined,
    };
  }

  private async hashToken(token: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(token);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async requestAuth(email: string, type: 'magic_link' | 'otp' = 'magic_link', baseUrl?: string): Promise<void> {
    if (!this.tenantId || typeof this.tenantId !== 'string' || !this.tenantId.trim()) {
      throw new Error('Invalid tenant context');
    }

    const lowerEmail = email.toLowerCase().trim();

    // 1. Authoritative identity resolution & tenant boundary check
    const userResolver = new UserAuthResolver(this.env.DB);
    const existingUser = await userResolver.resolveCredentialsByEmail(lowerEmail);

    let userId: string;

    if (existingUser) {
      // Existing identity MUST belong to active tenant
      if (existingUser.tenantId !== this.tenantId) {
        throw new Error('Invalid tenant context');
      }
      if (existingUser.role !== 'customer') {
        // Non-customer role; return silently to prevent user enumeration
        return;
      }
      userId = existingUser.userId;
    } else {
      // Create shadow customer user under active tenant scope
      const deps = createSystemTenantDeps(this.tenantId, 'system', this.env);
      const createdUser = await deps.repositories.users.create({
        tenant_id: this.tenantId,
        email: lowerEmail,
        full_name: lowerEmail.split('@')[0],
        role: 'customer',
        mfa_enabled: false,
      });
      userId = createdUser.id;
    }

    // 2. Generate Token
    const randomBytes = new Uint8Array(32);
    crypto.getRandomValues(randomBytes);
    const plainToken = Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('');
    const tokenHash = await this.hashToken(plainToken);
    const tokenId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    // 3. Store Token
    await this.env.DB.prepare(
      'INSERT INTO customer_auth_tokens (id, user_id, token_hash, type, expires_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(tokenId, userId, tokenHash, type, expiresAt).run();

    // 4. Send Email via Tenant EmailService
    const emailSvc = this.emailService || new EmailService(this.env, this.tenantId, this.transport);

    if (type === 'magic_link') {
      const url = `${baseUrl || 'http://localhost:5173'}/auth/verify?token=${plainToken}`;
      await emailSvc.send({
        to: [lowerEmail],
        subject: 'Your Login Link',
        html: `<p>Hello,</p><p>Click the link below to log in to your portal:</p><p><a href="${url}">${url}</a></p><p>This link expires in 15 minutes.</p>`,
        text: `Hello,\n\nClick the link below to log in to your portal:\n${url}\n\nThis link expires in 15 minutes.`,
      });
    } else {
      const array = new Uint32Array(1);
      crypto.getRandomValues(array);
      const otp = Math.floor(100000 + (array[0] % 900000)).toString();
      const otpHash = await this.hashToken(otp);

      await this.env.DB.prepare(
        'UPDATE customer_auth_tokens SET token_hash = ? WHERE id = ?'
      ).bind(otpHash, tokenId).run();

      await emailSvc.send({
        to: [lowerEmail],
        subject: 'Your Login Code',
        html: `<p>Hello,</p><p>Your login code is: <strong>${otp}</strong></p><p>This code expires in 15 minutes.</p>`,
        text: `Hello,\n\nYour login code is: ${otp}\n\nThis code expires in 15 minutes.`,
      });
    }
  }

  async verifyAuth(plainToken: string): Promise<{ token: string, user: User } | null> {
    const tokenHash = await this.hashToken(plainToken);

    const tokenRecord = await this.env.DB.prepare(
      'SELECT * FROM customer_auth_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?'
    ).bind(tokenHash, new Date().toISOString()).first<{ user_id: string, id: string }>();

    if (!tokenRecord) {
      return null;
    }

    const user = await this.env.DB.prepare(
      'SELECT * FROM users WHERE id = ?'
    ).bind(tokenRecord.user_id).first<User>();

    if (!user) {
      return null;
    }

    await this.env.DB.prepare(
      'UPDATE customer_auth_tokens SET used_at = ? WHERE id = ?'
    ).bind(new Date().toISOString(), tokenRecord.id).run();

    await this.env.DB.prepare(
      'UPDATE users SET last_login_at = ? WHERE id = ?'
    ).bind(new Date().toISOString(), user.id).run();
    user.last_login_at = new Date().toISOString();

    const alg = "HS256";
    const secretKey = new TextEncoder().encode(this.env.JWT_SECRET);
    const userTenantId = user.tenant_id;
    if (!userTenantId || typeof userTenantId !== 'string' || !userTenantId.trim()) {
      return null;
    }
    const payload = {
      sub: user.id,
      email: user.email,
      role: 'customer',
      tenant_id: userTenantId,
    };
    const jwt = await new jose.SignJWT(payload)
      .setProtectedHeader({ alg })
      .setAudience('widget')
      .setIssuedAt()
      .setExpirationTime('7d')
      .sign(secretKey);

    return { token: jwt, user };
  }
}