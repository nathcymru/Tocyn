import type { EmailTransport } from './services/email/transport';

export interface Env {
  VECTORIZE_WORKFLOW: any; // Type 'Workflow' missing in older workers-types
  DB: D1Database;
  ATTACHMENTS_BUCKET: R2Bucket;
  NOTIFICATION_DO: DurableObjectNamespace;
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
  INBOUND_EMAIL_AUTH_VERIFIED?: string;
  PORTAL_URL?: string;
  DASHBOARD_URL?: string;
  CORS_ORIGINS?: string;
  DISABLE_RATE_LIMIT?: string;
  OUTBOUND_EMAIL_RECIPIENT_ALLOWLIST?: string;
  /** Injected solely by src/local-index.ts; never a Worker binding or secret. */
  emailTransport?: EmailTransport;
}
