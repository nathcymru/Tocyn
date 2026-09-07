import PostalMime from 'postal-mime';
import { TenantRequestDeps } from '../../middleware/tenant.middleware';
import { ReplyParser } from './reply-parser';

export interface InboundEmailMessage {
  from: string;
  to: string;
  subject: string;
  raw: ReadableStream;
}

export class InboundEmailService {
  constructor(private deps: TenantRequestDeps, private ctx?: ExecutionContext) {}

  async handle(message: InboundEmailMessage): Promise<void> {
    const parser = new PostalMime();
    const email = await parser.parse(message.raw);

    // Identify ticket
    let ticket = await this.deps.repositories.tickets.findBySubject(email.subject || '');

    // If not found by subject, try finding by thread headers
    if (!ticket && email.inReplyTo) {
      const ref = await this.deps.repositories.articles.findByRawEmailId(email.inReplyTo);
      if (ref) ticket = await this.deps.repositories.tickets.get(ref.ticket_id);
    }
    
    if (!ticket && email.references) {
      // References can be an array or space-separated string depending on version
      const refs = Array.isArray(email.references) ? email.references : email.references.split(/\s+/);
      for (const ref of refs.reverse()) { // Check newest first
        if (!ref) continue;
        const art = await this.deps.repositories.articles.findByRawEmailId(ref);
        if (art) ticket = await this.deps.repositories.tickets.get(art.ticket_id);
        if (ticket) break;
      }
    }
    
    const customerEmail = email.from?.address || message.from;
    const body = ReplyParser.stripHistory(email.text, email.html);

    if (!ticket) {
      // Create new ticket
      let user = await this.deps.repositories.users.findByEmail(customerEmail);
      if (!user) {
        user = await this.deps.repositories.users.create({
          email: customerEmail,
          full_name: message.from || '',
          role: 'customer',
          tenant_id: this.deps.scope.tenantId,
          mfa_enabled: false
        });
      }
      ticket = await this.deps.repositories.tickets.create({
        subject: email.subject || 'No Subject',
        customer_id: user.id,
        customer_email: user.email,
        source: 'email',
        source_email: message.to,
        status: 'open',
        priority: 'normal',
      });
    }

    // Create article
    const article = await this.deps.repositories.articles.create({
      ticket_id: ticket.id,
      sender_type: 'customer',
      sender_id: ticket.customer_id as string,
      body: body,
      raw_email_id: (email.messageId || undefined) as string | undefined,
      qa_type: 'question',
      is_internal: false,
    });

    // Update ticket timestamp
    await this.deps.repositories.tickets.touch(ticket.id);

    // Handle attachments
    if (email.attachments && email.attachments.length > 0) {
      for (const attachment of email.attachments) {
        const contentArray = typeof attachment.content === 'string'
          ? new TextEncoder().encode(attachment.content)
          : new Uint8Array(attachment.content);

        const r2Key = await this.deps.attachmentStorage.putAttachment(
          `tickets/${ticket.id}/articles/${article.id}/${attachment.filename || 'unnamed'}`,
          contentArray,
          { httpMetadata: { contentType: attachment.mimeType } }
        ).then(r => r.key);

        try {
          await this.deps.repositories.attachments.create({
            article_id: article.id,
            file_name: attachment.filename || 'unnamed',
            file_size: contentArray.byteLength,
            content_type: attachment.mimeType,
            r2_key: r2Key,
          });
        } catch (e) {
          await this.deps.attachmentStorage.deleteAttachment(r2Key);
          throw e;
        }
      }
    }
  }
}
