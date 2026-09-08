import { SendEmailOptions } from '../../types';
import { arrayBufferToBase64 } from '../../utils/encoding';

export interface EmailTransportCredentials {
  apiKey: string;
  defaultFrom: string;
}

export interface EmailTransport {
  send(options: SendEmailOptions, creds: EmailTransportCredentials): Promise<{ id: string }>;
}

export const LOCAL_AUTH_CAPTURE_RECIPIENT = 'tocyn-auth-test@example.invalid';
export const LOCAL_AUTH_CAPTURE_RECIPIENTS = Object.freeze([
  LOCAL_AUTH_CAPTURE_RECIPIENT,
  'tocyn-auth-test-a@example.invalid',
  'tocyn-auth-test-b@example.invalid',
]);
const LOCAL_AUTH_CAPTURE_RECIPIENT_SET = new Set(LOCAL_AUTH_CAPTURE_RECIPIENTS);
const LOCAL_PORTAL_ORIGINS = new Set(['http://localhost:5174', 'http://127.0.0.1:5174']);

export type LocalAuthCaptureMessage = Readonly<{
  id: string;
  createdAt: string;
  expiresAt: string;
  to: string;
  from: string;
  subject: string;
  text: string;
  loginLink?: string;
}>;

/**
 * A local-only sink. It deliberately has no provider key and never performs a
 * fetch; the local Worker entrypoint is the only code allowed to construct it.
 */
export class LocalAuthCaptureTransport implements EmailTransport {
  readonly localOnly = true;
  readonly credentials: EmailTransportCredentials = {
    apiKey: 'local-capture-no-provider-key',
    defaultFrom: 'local-auth-capture@localhost.invalid',
  };
  private messages: LocalAuthCaptureMessage[] = [];

  constructor(private readonly now: () => number = () => Date.now()) {}

  private prune(): void {
    const cutoff = this.now() - 15 * 60 * 1000;
    this.messages = this.messages.filter(message => Date.parse(message.createdAt) >= cutoff);
  }

  async send(options: SendEmailOptions, creds: EmailTransportCredentials): Promise<{ id: string }> {
    this.prune();
    const recipient = options.to.length === 1 ? options.to[0].trim().toLowerCase() : '';
    if (!LOCAL_AUTH_CAPTURE_RECIPIENT_SET.has(recipient)) {
      throw new Error(`Local auth capture accepts only ${LOCAL_AUTH_CAPTURE_RECIPIENTS.join(', ')}`);
    }
    const text = (options.text || '').slice(0, 4096);
    const candidate = text.match(/http:\/\/[^\s]+\/verify\?[^\s]+/)?.[0];
    let loginLink: string | undefined;
    if (candidate) {
      try {
        const url = new URL(candidate);
        if (LOCAL_PORTAL_ORIGINS.has(url.origin) && url.pathname === '/verify') loginLink = url.toString();
      } catch { /* Text remains available, but an invalid link is not actionable. */ }
    }
    const createdAt = new Date(this.now()).toISOString();
    const message: LocalAuthCaptureMessage = {
      id: crypto.randomUUID(),
      createdAt,
      expiresAt: new Date(this.now() + 15 * 60 * 1000).toISOString(),
      to: recipient,
      from: options.from || creds.defaultFrom,
      subject: options.subject.slice(0, 200),
      text,
      ...(loginLink ? { loginLink } : {}),
    };
    this.messages = [...this.messages, message].slice(-10);
    return { id: `local-capture-${message.id}` };
  }

  list(): LocalAuthCaptureMessage[] {
    this.prune();
    return [...this.messages];
  }

  reset(): void {
    this.messages = [];
  }
}

export function isLocalAuthCaptureTransport(transport: EmailTransport): transport is LocalAuthCaptureTransport {
  return transport instanceof LocalAuthCaptureTransport && transport.localOnly === true;
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
          content: arrayBufferToBase64(new Uint8Array(a.content).buffer),
          contentType: a.contentType,
        })),
      }),
    });

    if (!res.ok) {
      // Provider bodies can echo message content or credentials. Never propagate them.
      await res.body?.cancel();
      throw new Error(`Email provider rejected delivery (${res.status})`);
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
