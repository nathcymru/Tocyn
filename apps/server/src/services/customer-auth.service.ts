import { localBetaEnabled, authorizeLocalBeta } from '../middleware/local-beta';
import { BetaAdmissionError } from '../types/local-beta';
import { LOCAL_AUTH_CAPTURE_RECIPIENTS } from './email/transport';
import { Env } from '../bindings';
import { User } from '../types';
import { EmailService } from './email/outbound.service';
import { EmailTransport } from './email/transport';
import { UserAuthResolver } from '../auth/user-auth-resolver';
import { TenantRequestDeps } from '../middleware/tenant.middleware';
import * as jose from 'jose';

export class CustomerAuthService {
  private emailService?: EmailService;

  constructor(
    private env: Env,
    private deps?: TenantRequestDeps,
    private transport?: EmailTransport,
    private identityResolver?: Pick<UserAuthResolver, 'resolveCredentialsByEmail'>,
    private now: () => number = () => Date.now(),
  ) {
    if (deps) {
      this.emailService = new EmailService(env, deps, transport);
    }
  }

  async getConfig(): Promise<{ TICKET_PREFIX: string, TURNSTILE_SITE_KEY?: string }> {
    if (!this.deps) {
      return { TICKET_PREFIX: '#' };
    }

    const prefix = await this.deps.repositories.config.get('TICKET_PREFIX');
    const siteKey = await this.deps.repositories.config.get('TURNSTILE_SITE_KEY');
    // A stale local D1 setting must not cause the development portal to load a
    // third-party Turnstile widget. Authentication itself fails closed below.
    if (this.env.ENVIRONMENT === 'local') return { TICKET_PREFIX: prefix || '#' };
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

  async requestAuth(email: string, type: 'magic_link' | 'otp' = 'magic_link', baseUrl?: string): Promise<{ challengeId?: string }> {
    if (!this.deps || !this.deps.scope.tenantId) {
      throw new Error('Invalid tenant context');
    }

    const lowerEmail = email.toLowerCase().trim();

    // 1. Authoritative identity resolution & tenant boundary check
    if (!this.identityResolver) throw new Error('Identity resolver required');
    const existingUser = await this.identityResolver.resolveCredentialsByEmail(lowerEmail);

    if (localBetaEnabled(this.env)) {
      const generic = { challengeId: type === 'otp' ? crypto.randomUUID() : undefined };
      if (!existingUser || existingUser.tenantId !== this.deps.scope.tenantId || existingUser.role !== 'customer' || !LOCAL_AUTH_CAPTURE_RECIPIENTS.includes(lowerEmail)) return generic;
      try { await authorizeLocalBeta(this.env, this.deps.scope, { kind: 'customer', id: existingUser.userId }); }
      catch (error) { if (error instanceof BetaAdmissionError && error.code === 'beta_not_invited') return generic; throw error; }
    }

    let userId: string;

    if (existingUser) {
      // Existing identity MUST belong to active tenant
      if (existingUser.tenantId !== this.deps.scope.tenantId) {
        throw new Error('Invalid tenant context');
      }
      if (existingUser.role !== 'customer') {
        // Non-customer role; return silently to prevent user enumeration
        return { challengeId: type === 'otp' ? crypto.randomUUID() : undefined };
      }
      userId = existingUser.userId;
    } else {
      // Create shadow customer user under active tenant scope
      const createdUser = await this.deps.repositories.users.create({
        tenant_id: this.deps.scope.tenantId,
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
    const requestedAt = this.now();
    const expiresAt = new Date(requestedAt + 15 * 60 * 1000).toISOString();

    // 3. Store Token securely via repository
    if (type === 'magic_link') await this.deps.repositories.users.storeCustomerAuthToken(userId, tokenId, tokenHash, type, expiresAt);

    // 4. Send Email via Tenant EmailService
    const emailSvc = this.emailService || new EmailService(this.env, this.deps, this.transport);

    if (type === 'magic_link') {
      const portalBase = await this.deps.repositories.config.get('PORTAL_URL') || this.env.PORTAL_URL;
      if (!portalBase) throw new Error('Portal URL not configured');
      const urlObj = new URL('/verify', portalBase);
      if (urlObj.protocol !== 'https:' && !(urlObj.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(urlObj.hostname))) throw new Error('Invalid portal URL');
      urlObj.searchParams.set('token', plainToken);
      const widgetKey = await this.deps.repositories.config.get('widget.public_key');
      if (!widgetKey) throw new Error('Widget key not configured');
      urlObj.searchParams.set('key', widgetKey);
      const url = urlObj.toString();
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
      const otpHash = await this.hashToken(`${tokenId}\0${otp}`);

      await this.deps.repositories.users.storeCustomerAuthToken(userId, tokenId, otpHash, type, expiresAt);

      await emailSvc.send({
        to: [lowerEmail],
        subject: 'Your Login Code',
        html: `<p>Hello,</p><p>Your login code is: <strong>${otp}</strong></p><p>This code expires in 15 minutes.</p>`,
        text: `Hello,\n\nYour login code is: ${otp}\n\nThis code expires in 15 minutes.`,
      });
    }
    return { challengeId: type === 'otp' ? tokenId : undefined };
  }

  async verifyAuth(plainToken: string, challengeId?: string): Promise<{ token: string, user: User } | null> {
    if (!this.deps || !this.deps.scope.tenantId) {
      return null;
    }

    if (challengeId ? !/^[0-9a-f-]{36}$/.test(challengeId) || !/^\d{6}$/.test(plainToken) : !/^[0-9a-f]{64}$/.test(plainToken)) return null;
    const tokenHash = await this.hashToken(challengeId ? `${challengeId}\0${plainToken}` : plainToken);
    const verifiedAt = this.now();
    const now = new Date(verifiedAt).toISOString();

    if (localBetaEnabled(this.env)) {
      const candidateId = await this.deps.repositories.users.findCustomerAuthTokenUser(tokenHash, challengeId);
      if (!candidateId) return null;
      try { await authorizeLocalBeta(this.env, this.deps.scope, { kind: 'customer', id: candidateId }); }
      catch (error) { if (error instanceof BetaAdmissionError && error.code === 'beta_not_invited') return null; throw error; }
    }
    // Use isolated verification
    const user = await this.deps.repositories.users.verifyAndConsumeCustomerAuthToken(tokenHash, now, challengeId);

    if (!user) {
      return null;
    }

    const alg = "HS256";
    const secretKey = new TextEncoder().encode(this.env.JWT_SECRET);
    const userTenantId = user.tenant_id;
    if (!userTenantId || typeof userTenantId !== 'string' || !userTenantId.trim()) {
      return null;
    }
    const payload = {
      session_version: user.session_version ?? 0,
      sub: user.id,
      email: user.email,
      role: 'customer',
      tenant_id: userTenantId,
    };
    const issuedAt = Math.floor(verifiedAt / 1000);
    const jwt = await new jose.SignJWT(payload)
      .setProtectedHeader({ alg })
      .setAudience('widget')
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + 7 * 24 * 60 * 60)
      .sign(secretKey);

    return { token: jwt, user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role, tenant_id: user.tenant_id } as User };
  }
}
