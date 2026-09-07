import { Ticket, Article, Attachment, SendEmailOptions } from '../../types';
import { decryptString } from '../../utils/crypto';
import { TenantRequestDeps } from '../../middleware/tenant.middleware';
import { EmailTransport, HttpResendTransport } from './transport';

export class TenantOutboundEmailService {
  constructor(
    private deps: TenantRequestDeps,
    private masterKey?: string,
    private transport: EmailTransport = new HttpResendTransport()
  ) {}

  async getResendCredentials(): Promise<{ apiKey: string, defaultFrom: string }> {
    let apiKey = await this.deps.repositories.config.get('RESEND_API_KEY');
    let defaultFrom = await this.deps.repositories.config.get('RESEND_FROM_EMAIL');

    if (!apiKey || !defaultFrom) throw new Error('Email credentials not configured for this tenant');
    if (!this.masterKey) throw new Error('APP_MASTER_KEY is required for tenant email credentials');
    apiKey = await decryptString(apiKey, this.masterKey);
    return { apiKey, defaultFrom };
  }

  async send(options: SendEmailOptions): Promise<{ id: string }> {
    const creds = await this.getResendCredentials();
    const fromAddress = options.from || creds.defaultFrom;

    // Sender ownership check
    const allChannels = (await this.deps.repositories.channels.listSupportEmails()) || [];
    {
      const owned = allChannels.some(c => c.email_address.toLowerCase() === fromAddress.toLowerCase());
      if (!owned && fromAddress.toLowerCase() !== creds.defaultFrom.toLowerCase()) {
        throw new Error(`Unauthorized: The from address ${fromAddress} does not belong to the active tenant.`);
      }
    }

    return this.transport.send({ ...options, from: fromAddress }, creds);
  }

  async sendTicketReply(
    ticket: Ticket,
    article: Article,
    attachments: Attachment[] = [],
    replyToEmailId?: string
  ): Promise<void> {
    const prefixResult = await this.deps.repositories.config.get('TICKET_PREFIX');
    const prefix = prefixResult || '#';

    const ticketNoStr = ticket.ticket_no ? ticket.ticket_no.toString() : ticket.id;
    const subjectPrefix = `[${prefix}${ticketNoStr}]`;
    const subject = ticket.subject.includes(subjectPrefix) ? ticket.subject : `${subjectPrefix} ${ticket.subject}`;

    const headers: Record<string, string> = {};
    if (replyToEmailId) {
      headers['In-Reply-To'] = replyToEmailId;
      headers['References'] = replyToEmailId;
    }

    let fromEmail: string | undefined;

    const allEmails = (await this.deps.repositories.channels.listSupportEmails()) || [];
    const groupEmail = ticket.group_id ? allEmails.find(e => e.group_id === ticket.group_id) : undefined;
    const defaultEmail = allEmails.find(e => e.is_default);

    if (groupEmail) {
      fromEmail = groupEmail.email_address;
    } else if (defaultEmail) {
      fromEmail = defaultEmail.email_address;
    } else if (ticket.source_email) {
      fromEmail = ticket.source_email;
    }

    const resendAttachments = await Promise.all(
      attachments.map(async (a) => {
        const obj = await this.deps.attachmentStorage.getAttachment(a.r2_key);
        if (!obj) throw new Error(`Attachment not found: ${a.r2_key}`);
        const content = await obj.arrayBuffer();
        return {
          filename: a.file_name,
          content: new Uint8Array(content),
          contentType: a.content_type,
        };
      })
    );

    await this.send({
      from: fromEmail || undefined,
      to: [ticket.customer_email],
      subject: subject,
      html: article.body || '',
      headers: headers,
      attachments: resendAttachments,
    });
  }
}
