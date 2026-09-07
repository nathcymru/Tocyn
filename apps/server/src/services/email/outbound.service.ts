import { Env } from '../../bindings';
import { Ticket, Article, Attachment, SendEmailOptions } from '../../types';
import { createSystemTenantDeps } from '../../auth/scope';
import { TenantOutboundEmailService } from './tenant-outbound.service';
import { EmailTransport, HttpResendTransport } from './transport';

export class EmailService {
  constructor(
    private env: Env,
    private tenantId: string,
    private transport: EmailTransport = new HttpResendTransport()
  ) {
    if (!tenantId || typeof tenantId !== 'string' || !tenantId.trim()) {
      throw new Error('Tenant ID required for email service operations');
    }
  }

  private getTenantOutboundService(): TenantOutboundEmailService {
    const deps = createSystemTenantDeps(this.tenantId, 'system', this.env);
    return new TenantOutboundEmailService(deps, this.env.APP_MASTER_KEY, this.transport);
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
