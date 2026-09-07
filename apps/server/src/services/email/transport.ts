import { SendEmailOptions } from '../../types';
import { arrayBufferToBase64 } from '../../utils/encoding';

export interface EmailTransportCredentials {
  apiKey: string;
  defaultFrom: string;
}

export interface EmailTransport {
  send(options: SendEmailOptions, creds: EmailTransportCredentials): Promise<{ id: string }>;
}

export class HttpResendTransport implements EmailTransport {
  async send(options: SendEmailOptions, creds: EmailTransportCredentials): Promise<{ id: string }> {
    const fromAddress = options.from || creds.defaultFrom;
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
}

export class InMemoryEmailTransport implements EmailTransport {
  public sentEmails: Array<{ options: SendEmailOptions; creds: EmailTransportCredentials }> = [];

  async send(options: SendEmailOptions, creds: EmailTransportCredentials): Promise<{ id: string }> {
    this.sentEmails.push({ options, creds });
    return { id: `in-memory-${Date.now()}-${Math.random().toString(36).substring(2, 7)}` };
  }

  clear(): void {
    this.sentEmails = [];
  }
}
