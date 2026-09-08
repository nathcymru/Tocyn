import { Env } from '../../bindings';
import { Ticket, Article, Attachment, SendEmailOptions } from '../../types';
import { TenantRequestDeps } from '../../middleware/tenant.middleware';
import { TenantOutboundEmailService } from './tenant-outbound.service';
import { EmailTransport, HttpResendTransport } from './transport';

export class EmailService {
  constructor(
    private env: Env,
    private deps: TenantRequestDeps,
    private transport: EmailTransport = new HttpResendTransport()
  ) {
    if (!deps || !deps.scope.tenantId) {
      throw new Error('Tenant ID required for email service operations');
    }
  }

  private getTenantOutboundService(): TenantOutboundEmailService {
    return new TenantOutboundEmailService(
      this.deps,
      this.env.APP_MASTER_KEY,
      this.transport,
      this.env.ENVIRONMENT,
      this.env.OUTBOUND_EMAIL_RECIPIENT_ALLOWLIST
    );
  }

  async getResendCredentials(): Promise<{ apiKey: string, defaultFrom: string }> {
    return this.getTenantOutboundService().getResendCredentials();
  }

  async send(options: SendEmailOptions): Promise<{ id: string }> {
    return this.getTenantOutboundService().send(options);
  }

  async sendTicketReply(
    ticket: Ticket,
    article: Article,
    attachments: Attachment[] = [],
    replyToEmailId?: string
  ): Promise<void> {
    return this.getTenantOutboundService().sendTicketReply(ticket, article, attachments, replyToEmailId);
  }
}
