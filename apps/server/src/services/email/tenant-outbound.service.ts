import { Ticket, Article, Attachment, SendEmailOptions } from '../../types';
import { decryptString } from '../../utils/crypto';
import { TenantRequestDeps } from '../../middleware/tenant.middleware';
import { EmailTransport, HttpResendTransport, isLocalAuthCaptureTransport } from './transport';
import { estimateProviderEmailRequestBytes, MAX_TICKET_EMAIL_ATTACHMENTS, OutboundEmailPreparationError } from './request-envelope';

export class TenantOutboundEmailService {
  constructor(
    private deps: TenantRequestDeps,
    private masterKey?: string,
    private transport: EmailTransport = new HttpResendTransport(),
    private environment?: string,
    private recipientAllowlist?: string
  ) {}

  private assertIsolatedRecipientAllowlist(recipients: string[]): void {
    if (!['preview', 'beta'].includes(this.environment || '')) return;
    const allowed = new Set((this.recipientAllowlist || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean));
    if (allowed.size === 0) throw new Error('Outbound email is disabled until an isolated recipient allowlist is configured');
    for (const recipient of recipients) {
      if (!allowed.has(recipient.trim().toLowerCase())) throw new Error('Outbound email recipient is not in the isolated allowlist');
    }
  }

  async getResendCredentials(): Promise<{ apiKey: string, defaultFrom: string }> {
    let apiKey = await this.deps.repositories.config.get('RESEND_API_KEY');
    let defaultFrom = await this.deps.repositories.config.get('RESEND_FROM_EMAIL');

    if (!apiKey || !defaultFrom) throw new Error('Email credentials not configured for this tenant');
    if (!this.masterKey) throw new Error('APP_MASTER_KEY is required for tenant email credentials');
    apiKey = await decryptString(apiKey, this.masterKey);
    return { apiKey, defaultFrom };
  }

  private async getTransportCredentials(): Promise<{ apiKey: string, defaultFrom: string }> {
    if (isLocalAuthCaptureTransport(this.transport)) {
      if (this.environment !== 'local') throw new Error('Local auth capture transport is only valid in the local runtime');
      return this.transport.credentials;
    }
    if (this.environment === 'local') throw new Error('Local runtime refuses external email transport without the local capture adapter');
    return this.getResendCredentials();
  }

  private async prepareSend(options: SendEmailOptions) {
    this.assertIsolatedRecipientAllowlist(options.to);
    const creds = await this.getTransportCredentials();
    const fromAddress = options.from || creds.defaultFrom;
    if (fromAddress.toLowerCase() !== creds.defaultFrom.toLowerCase() &&
        !await this.deps.repositories.channels.findByEmail(fromAddress)) {
      throw new Error('Unauthorized: The from address does not belong to the active tenant.');
    }
    return { options: { ...options, from: fromAddress }, creds };
  }

  async send(options: SendEmailOptions): Promise<{ id: string }> {
    const prepared = await this.prepareSend(options);
    return this.transport.send(prepared.options, prepared.creds);
  }

  async sendTicketReply(
    ticket: Ticket,
    article: Article,
    attachments: Attachment[] = [],
    replyToEmailId?: string
  ): Promise<void> {
    if (attachments.length > MAX_TICKET_EMAIL_ATTACHMENTS) throw new OutboundEmailPreparationError();
    const savedAttachments = attachments.map(attachment => ({ ...attachment }));
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

    const selectedSender = await this.deps.repositories.channels.findReplySender(ticket.group_id);
    const fromEmail = selectedSender?.email_address || ticket.source_email || undefined;
    const prepared = await this.prepareSend({ from: fromEmail, to: [ticket.customer_email],
      subject, html: article.body || '', headers });
    // Validate the complete submitted message before any attachment body reads.
    // Keep the shared ticket capability unchanged; an oversized email fails whole.
    estimateProviderEmailRequestBytes(prepared.options, savedAttachments.map(a => ({
      filename: a.file_name, contentType: a.content_type, size: a.file_size,
    })));

    // Read one object at a time. The transport still retains/encodes the full
    // accepted payload, so this alone does not establish isolate memory safety.
    const resendAttachments: NonNullable<SendEmailOptions['attachments']> = [];
    for (const a of savedAttachments) {
      const obj = await this.deps.attachmentStorage.getAttachment(a.r2_key);
      if (!obj) throw new Error('Attachment unavailable for outbound email');
      if (obj.size !== a.file_size || obj.httpMetadata?.contentType !== a.content_type) {
        await obj.body?.cancel();
        throw new OutboundEmailPreparationError();
      }
      const content = await obj.arrayBuffer();
      if (content.byteLength !== a.file_size) throw new OutboundEmailPreparationError();
      resendAttachments.push({ filename: a.file_name, content: new Uint8Array(content), contentType: a.content_type });
    }

    await this.transport.send({ ...prepared.options, attachments: resendAttachments }, prepared.creds);
  }
}
