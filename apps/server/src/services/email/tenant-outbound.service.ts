import { Ticket, Article, Attachment, SendEmailOptions } from '../../types';
import { arrayBufferToBase64 } from '../../utils/encoding';
import { decryptString } from '../../utils/crypto';
import { TenantRequestDeps } from '../../middleware/tenant.middleware';
import { normalizeSupportEmail } from '../../utils/email-normalize';

export class TenantOutboundEmailService {
  constructor(private deps: TenantRequestDeps, private masterKey?: string) {}

  async getResendCredentials(): Promise<{ apiKey: string, defaultFrom: string }> {
    let apiKey = await this.deps.repositories.config.get('RESEND_API_KEY');
    let defaultFrom = await this.deps.repositories.config.get('RESEND_FROM_EMAIL');

    if (!apiKey) {
      throw new Error('Resend API Key not configured for this tenant.');
    }
    if (!this.masterKey) {
      throw new Error('Server misconfiguration: APP_MASTER_KEY is required to decrypt tenant credentials.');
    }

    try {
      apiKey = await decryptString(apiKey, this.masterKey);
    } catch (error) {
      throw new Error('Failed to decrypt RESEND_API_KEY. ' + (error instanceof Error ? error.message : String(error)));
    }

    if (!apiKey) {
      throw new Error('Resend API Key not configured. Please configure it in Email Channel settings.');
    }

    return { apiKey, defaultFrom: defaultFrom || 'support@luminatick.com' };
  }

  async send(options: SendEmailOptions): Promise<{ id: string }> {
    const creds = await this.getResendCredentials();
    const fromAddress = options.from || creds.defaultFrom;

    // Sender ownership check
    const ownedAddress = await this.deps.repositories.channels.findByEmail(fromAddress);
    if (!ownedAddress) {
      throw new Error(`Unauthorized: The from address ${fromAddress} does not belong to the active tenant.`);
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddress,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
        headers: options.headers,
        attachments: options.attachments?.map((a) => ({
          filename: a.filename,
          content: arrayBufferToBase64(a.content.buffer),
          contentType: a.contentType,
        })),
      }),
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`Failed to send email: ${error}`);
    }

    return (await res.json()) as { id: string };
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

    // For simplicity, we just use the default support email for this tenant if not using source_email
    const allEmails = await this.deps.repositories.channels.listSupportEmails();
    const defaultEmail = allEmails.find(e => e.is_default);

    if (ticket.source_email) {
      fromEmail = ticket.source_email;
    } else if (defaultEmail) {
      fromEmail = defaultEmail.email_address;
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
