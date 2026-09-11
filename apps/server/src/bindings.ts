import type { LocalBetaDiagnostics } from './services/local-beta-diagnostics';
import type { EmailTransport } from './services/email/transport';

export interface Env {
  VECTORIZE_WORKFLOW: any; // Type 'Workflow' missing in older workers-types
  DB: D1Database;
  ATTACHMENTS_BUCKET: R2Bucket;
  NOTIFICATION_DO: DurableObjectNamespace;
  /** Internal budget authority; only explicitly configured mutation boundaries may call it. */
  BUDGET_COORDINATOR_DO: DurableObjectNamespace;
  /** Server deployment policy selects a bounded ticket-mutation admission boundary. */
  BUDGET_ADMISSION_POLICY?: string;
  /** Server-derived durable warm-grant holder; never directly addressed by a client. */
  BUDGET_GRANT_HOLDER_DO: DurableObjectNamespace;
  VECTOR_INDEX: VectorizeIndex;
  AI: any; // Using any for simplicity as Vectorize types are often experimental
  RESEND_API_KEY: string;
  RESEND_FROM_EMAIL: string;
  JWT_SECRET: string;
  MFA_ENCRYPTION_KEY: string;
  APP_MASTER_KEY: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  ENVIRONMENT?: string;
  /** Isolated synthetic observability evidence only; production remains gated by #42. */
  OBSERVABILITY_MODE?: 'off' | 'isolated-evidence';
  /** Explicit guarded local-only beta profile; malformed values fail closed. */
  LOCAL_BETA_ENABLED?: string;
  /** Temporary loopback origin for an isolated local runtime rehearsal; never deployed. */
  LOCAL_RUNTIME_ORIGIN?: string;
  INBOUND_EMAIL_AUTH_VERIFIED?: string;
  PORTAL_URL?: string;
  DASHBOARD_URL?: string;
  CORS_ORIGINS?: string;
  DISABLE_RATE_LIMIT?: string;
  OUTBOUND_EMAIL_RECIPIENT_ALLOWLIST?: string;
  /** Injected solely by src/local-index.ts; never a Worker binding or secret. */
  emailTransport?: EmailTransport;
  /** Per-local-runtime bounded metadata; never a provider binding. */
  betaDiagnostics?: LocalBetaDiagnostics;
  /** Construction-time local clock; never a Worker binding, request control, or secret. */
  localNow?: () => number;
}
